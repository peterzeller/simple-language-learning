import "server-only";

import { getKnownWordIdsForUser, normalizeWord, storeTranslationPairs } from "@/lib/learning";

export interface SentenceToken {
  source: string;
  target: string;
  wordId: number;
  isKnown: boolean;
  isQuestion: boolean;
}

export interface SentenceQuestion {
  tokenIndex: number;
  options: string[];
  correctAnswer: string;
}

export interface SentenceExercise {
  tokens: SentenceToken[];
  questions: SentenceQuestion[];
}

// parses a sentence that is expected to have format
// "(source|target) (source|target) ...", for example:
// "or source(target), and it returns an array of { source, target } pairs."
function parseBilingualSentence(sentence: string): Array<{ source: string; target: string }> {
  let inParentheses = false;
  let afterBar = false;
  let currentBeforeParentheses = "";
  let currentSource = "";
  let currentTarget = "";
  const result: Array<{ source: string; target: string }> = [];

  for (const char of sentence) {
    if (char === "(") {
      inParentheses = true;
      currentSource = "";
      currentTarget = "";
    } else if (char === ")") {
      if (inParentheses) {
        if (currentTarget) {
          result.push({ source: currentBeforeParentheses + currentSource, target: currentTarget.trim() });
        } else {
          // only one part in parentheses, treat it as the translation of the previous word
          result.push({ source: currentBeforeParentheses, target: currentSource });
        }
        inParentheses = false;
        currentBeforeParentheses = "";
        currentSource = "";
        currentTarget = "";
      } else {
        currentBeforeParentheses += char;
      }
    } else if (inParentheses) {
      if (char === "|") {
        afterBar = true;
        continue;
      }
      if (afterBar) {
        currentTarget += char;
      } else {
        currentSource += char;
      }
    } else {
      currentBeforeParentheses += char;
    }
  }
  if (currentBeforeParentheses) {
    result.push({ source: currentBeforeParentheses, target: "" });
  }
  return result;
}

async function generateFromOpenAI(topic: string): Promise<string | null> {
  const apiKey = process.env.OPEN_AI_KEY;

  if (!apiKey) {
    console.warn("Missing OpenAI API key, falling back to default sentence.");
    return null;
  }

  const prompt = `Generate a text in Spanish about the topic "${topic}". The text should include also the word-for-word translation for each word in the Spanish original, for example: ¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?. Use Spanish as first language and English as second language. Return JSON only with key \"sentence\".`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "sentence_response",
            schema: {
              type: "object",
              properties: {
                sentence: { type: "string" },
              },
              required: ["sentence"],
              additionalProperties: false,
            },
          },
        },
      }),
      cache: "no-store",
    });


    if (!response.ok) {
      console.warn("OpenAI API request failed, falling back to default sentence.");
      return null;
    }

    const json = await response.json();


    let sentence: string = ""
    for (const outputItem of json.output) {
      for (const item of outputItem.content) {
        if (item.type !== "output_text") {
          continue;
        }
        const textJ = JSON.parse(item.text);
        sentence += textJ.sentence;
      }
    }

    return sentence
  } catch (e) {
    console.error("Error generating sentence from OpenAI:", e);
    return null;
  }
}

function fallbackSentence(topic: string): string {
  const normalized = topic.trim().toLowerCase();

  if (normalized === "travel") {
    return "(Me|I) (gusta|like) (viajar|to travel) (en|in) (tren|train).";
  }

  if (normalized === "food") {
    return "(Nosotros|We) (comemos|eat) (sopa|soup) (cada|every) (noche|night).";
  }

  return "¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?";
}

function getRandomQuestionIndexes(length: number): number[] {
  const indexes = Array.from({ length }, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes.slice(0, Math.min(2, length));
}

export async function createSentenceExercise(input: {
  topic: string;
  userId: number;
}): Promise<SentenceExercise> {
  const aiSentence = await generateFromOpenAI(input.topic);
  const sentence = aiSentence ?? fallbackSentence(input.topic);
  const pairs = parseBilingualSentence(sentence);

  if (pairs.length === 0) {
    throw new Error(`Could not generate a valid bilingual sentence from '${sentence}'`);
  }

  const wordIdMap = await storeTranslationPairs(
    pairs.map((pair) => ({
      sourceWord: pair.source,
      targetWord: pair.target,
      sourceLanguage: "es",
      targetLanguage: "en",
    })),
  );

  const knownWordIds = await getKnownWordIdsForUser(input.userId);
  const tokens: SentenceToken[] = pairs.map((pair) => {
    const wordId = wordIdMap.get(normalizeWord(pair.source));

    if (!wordId) {
      throw new Error("Missing word id for generated sentence token.");
    }

    return {
      source: pair.source,
      target: pair.target,
      wordId,
      isKnown: knownWordIds.has(wordId),
      isQuestion: false,
    };
  });

  const questionIndexes = getRandomQuestionIndexes(tokens.length);
  for (const index of questionIndexes) {
    tokens[index].isQuestion = true;
  }
  const optionPool = Array.from(new Set(tokens.map((token) => token.target)));

  const questions = questionIndexes.map((tokenIndex) => {
    const correctAnswer = tokens[tokenIndex].target;
    const wrongAnswers = optionPool.filter((option) => option !== correctAnswer).slice(0, 3);
    const options = [correctAnswer, ...wrongAnswers];

    for (let index = options.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
    }

    return {
      tokenIndex,
      options,
      correctAnswer,
    };
  });

  return { tokens, questions };
}
