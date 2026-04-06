import "server-only";

import OpenAI from "openai";
import { sql } from "kysely";

import { ensureLearningTables, getDb } from "@/lib/db";
import { LANGUAGE_LABELS, type SupportedLearningLanguage, isSupportedLearningLanguage } from "@/lib/language-settings";
import {
  getUserWordKnowledgeTable,
  normalizeWord,
  storeTranslationPairs,
} from "@/lib/learning";
import { parseBilingualSentence } from "@/lib/parse-bilingual-sentence";

export interface SentenceToken {
  source: string;
  target: string;
  wordId: number;
  isKnown: boolean;
  revealByDefault: boolean;
  isQuestion: boolean;
}

export interface SentenceQuestion {
  tokenIndex: number;
  options: string[];
  correctAnswer: string;
}

export interface SentenceExercise {
  sentenceId: number;
  tokens: SentenceToken[];
  questions: SentenceQuestion[];
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPEN_AI_KEY;

  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

function asSupportedLanguage(language: string): SupportedLearningLanguage {
  if (isSupportedLearningLanguage(language)) {
    return language;
  }

  return "es";
}

async function saveGeneratedSentence(input: {
  topic: string;
  learningLanguage: string;
  rawSentence: string;
  sourceText: string;
}): Promise<number> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .insertInto("sentence_translations")
    .values({
      topic: input.topic,
      learning_language: input.learningLanguage,
      raw_sentence: input.rawSentence,
      source_text: input.sourceText,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return row.id;
}

async function getRandomSavedSentence(learningLanguage: string): Promise<{ id: number; rawSentence: string } | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select(["id", "raw_sentence"])
    .where("learning_language", "=", learningLanguage)
    .where("source_text", "is not", null)
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return { id: row.id, rawSentence: row.raw_sentence };
}

async function getSavedSentenceById(input: {
  sentenceId: number;
  learningLanguage: string;
}): Promise<{ id: number; rawSentence: string } | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select(["id", "raw_sentence"])
    .where("id", "=", input.sentenceId)
    .where("learning_language", "=", input.learningLanguage)
    .where("source_text", "is not", null)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return { id: row.id, rawSentence: row.raw_sentence };
}

async function requestOpenAiJson<T>(input: {
  client: OpenAI;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  useWebSearch: boolean;
  verbosity?: "low" | "medium" | "high";
}): Promise<T | null> {
  const response = await input.client.responses.create({
    model: "gpt-5.4-mini",
    input: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    ...(input.useWebSearch ? { tools: [{ type: "web_search_preview" }] } : {}),
    text: {
      ...(input.verbosity ? { verbosity: input.verbosity } : {}),
      format: {
        type: "json_schema",
        name: input.schemaName,
        schema: input.schema,
        strict: true,
      },
    },
  });

  const outputText = response.output_text;

  if (!outputText?.trim()) {
    return null;
  }

  try {
    return JSON.parse(outputText) as T;
  } catch {
    return null;
  }
}

async function generateFromOpenAI(input: {
  topic: string;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<{ rawSentence: string; sourceText: string; sourceTextAudioPromise: Promise<Buffer | null> } | null> {
  const client = getOpenAiClient();

  if (!client) {
    console.warn("Missing OpenAI API key, falling back to default sentence.");
    return null;
  }

  const learningLanguage = asSupportedLanguage(input.learningLanguage);
  const knownLanguage = asSupportedLanguage(input.knownLanguage);
  const learningLanguageLabel = LANGUAGE_LABELS[learningLanguage];
  const knownLanguageLabel = LANGUAGE_LABELS[knownLanguage];

  const generationSystemPrompt = [
    `Respond to the user's prompt in ${learningLanguageLabel}.`,
    "You must understand prompts and instructions even when users write in a different language.",
    "If the user asks a question, answer helpfully.",
    `If the user gives instructions, follow them while keeping the response in ${learningLanguageLabel}.`,
    "Do not ask the user follow-up questions, clarifying questions, or any interactive prompts.",
    "Treat this as a non-interactive, single-turn session and provide a complete response in one go.",
    "If the user only gives a topic, create either a story or a dialogue around that topic with invented names when relevant.",
    "Prefer rich narratives with momentum and scene changes instead of shallow summaries.",
    "Include at least one surprising detail, twist, or little-known fact to keep the story interesting.",
    "Target 300-800 words unless the user explicitly asks for a different length.",
    "Keep language learner-friendly: mostly high-frequency vocabulary with occasional useful stretch words.",
    "If the requested language is Korean, write Korean using Latin characters (Revised Romanization style) and do not use Hangul.",
    `Output valid JSON only with a single key named \"sourceText\" that contains the ${learningLanguageLabel} response.`,
  ].join(" ");

  try {
    const firstResponse = await requestOpenAiJson<{ sourceText: string }>({
      client,
      systemPrompt: generationSystemPrompt,
      userPrompt: input.topic,
      schemaName: "source_text_response",
      schema: {
        type: "object",
        properties: {
          sourceText: { type: "string" },
        },
        required: ["sourceText"],
        additionalProperties: false,
      },
      useWebSearch: true,
      verbosity: "high",
    });

    const sourceText = firstResponse?.sourceText?.trim();

    if (!sourceText) {
      console.warn("OpenAI generation step failed, falling back to default sentence.");
      return null;
    }
    const sourceTextAudioPromise = generateSpeechFromOpenAI(sourceText);

    const translationSystemPrompt = [
      `Convert ${learningLanguageLabel} text into bilingual token format.`,
      `Each token must be in this format: (${learningLanguageLabel}|${knownLanguageLabel}).`,
      `Use honest, literal ${knownLanguageLabel} translations; do not smooth grammar for naturalness.`,
      "Do not merge tokens. Keep token order and punctuation aligned to the source text.",
      "Output valid JSON only with a single key named \"sentence\".",
    ].join(" ");

    const secondResponse = await requestOpenAiJson<{ sentence: string }>({
      client,
      systemPrompt: translationSystemPrompt,
      userPrompt: sourceText,
      schemaName: "bilingual_sentence_response",
      schema: {
        type: "object",
        properties: {
          sentence: { type: "string" },
        },
        required: ["sentence"],
        additionalProperties: false,
      },
      useWebSearch: false,
    });

    const sentence = secondResponse?.sentence?.trim();

    if (!sentence) {
      console.warn("OpenAI translation step failed, falling back to default sentence.");
      return null;
    }

    if (parseBilingualSentence(sentence).length === 0) {
      console.warn("OpenAI returned an invalid bilingual format, falling back to default sentence.");
      return null;
    }

    return { rawSentence: sentence, sourceText, sourceTextAudioPromise };
  } catch (e) {
    console.error("Error generating sentence from OpenAI:", e);
    return null;
  }
}

const inFlightSpeechGenerationByText = new Map<string, Promise<Buffer | null>>();

async function requestSpeechFromOpenAI(text: string): Promise<Buffer | null> {
  const client = getOpenAiClient();

  if (!client) {
    return null;
  }

  try {
    const speechResponse = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      format: "mp3",
      input: text,
    });

    const arrayBuffer = await speechResponse.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return null;
    }

    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Error generating TTS audio from OpenAI:", error);
    return null;
  }
}

function generateSpeechFromOpenAI(text: string): Promise<Buffer | null> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return Promise.resolve(null);
  }

  const inFlightGeneration = inFlightSpeechGenerationByText.get(normalizedText);

  if (inFlightGeneration) {
    return inFlightGeneration;
  }

  const generationPromise = requestSpeechFromOpenAI(normalizedText);
  inFlightSpeechGenerationByText.set(normalizedText, generationPromise);
  generationPromise.finally(() => {
    if (inFlightSpeechGenerationByText.get(normalizedText) === generationPromise) {
      inFlightSpeechGenerationByText.delete(normalizedText);
    }
  }).catch(() => undefined);

  return generationPromise;
}

function asAudioBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("\\x")) {
    return Buffer.from(trimmed.slice(2), "hex");
  }

  return Buffer.from(trimmed, "base64");
}

function detectAudioMimeType(audio: Buffer): string {
  if (audio.length >= 3 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    return "audio/mpeg";
  }

  if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }

  if (
    audio.length >= 12
    && audio.subarray(0, 4).toString("ascii") === "RIFF"
    && audio.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return "audio/wav";
  }

  if (audio.length >= 4 && audio.subarray(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }

  if (audio.length >= 8 && audio.subarray(4, 8).toString("ascii") === "ftyp") {
    return "audio/mp4";
  }

  console.warn("Unknown audio format signature while building data URL.", {
    headerHex: audio.subarray(0, 16).toString("hex"),
    byteLength: audio.length,
  });
  return "audio/mpeg";
}

function toAudioDataUrl(value: Buffer | Uint8Array | string): string {
  const audioBuffer = asAudioBuffer(value);
  const mimeType = detectAudioMimeType(audioBuffer);
  const encoded = audioBuffer.toString("base64");

  return `data:${mimeType};base64,${encoded}`;
}

function fallbackSourceSentence(topic: string, learningLanguage: string): string {
  const normalized = topic.trim().toLowerCase();

  if (learningLanguage === "ko") {
    if (normalized === "travel") return "Naneun gicha yeohaengeul joahae.";
    if (normalized === "food") return "Urineun maeil bam supeureul meogeoyo.";
    return "Neo ju-mareul jal bonaenna?";
  }

  if (learningLanguage === "de") {
    if (normalized === "travel") return "Ich reise gern mit dem Zug.";
    if (normalized === "food") return "Wir essen jeden Abend Suppe.";
    return "Wie war dein Wochenende?";
  }

  if (learningLanguage === "en") {
    if (normalized === "travel") return "I like traveling by train.";
    if (normalized === "food") return "We eat soup every night.";
    return "How was your weekend?";
  }

  if (normalized === "travel") return "Me gusta viajar en tren.";
  if (normalized === "food") return "Nosotros comemos sopa cada noche.";
  return "¿Cómo estuvo tu fin de semana?";
}

function fallbackSentence(topic: string, learningLanguage: string): string {
  const normalized = topic.trim().toLowerCase();

  if (learningLanguage === "ko") {
    if (normalized === "travel") {
      return "(Naneun|I) (gicha|train) (yeohaengeul|travel) (joahae|like).";
    }

    if (normalized === "food") {
      return "(Urineun|We) (maeil|every day) (bam|night) (supeureul|soup) (meogeoyo|eat).";
    }

    return "(Neo|You) (ju-mareul|weekend) (jal|well) (bonaenna|spent)?";
  }

  if (normalized === "travel") {
    return "(Me|I) (gusta|like) (viajar|to travel) (en|in) (tren|train).";
  }

  if (normalized === "food") {
    return "(Nosotros|We) (comemos|eat) (sopa|soup) (cada|every) (noche|night).";
  }

  return "¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?";
}

function getQuestionIndexesByKnowledgeScore(input: {
  tokens: Array<{ wordId: number }>;
  scoreByWordId: Map<number, number>;
}): number[] {
  const questionCount = Math.max(1, Math.ceil(input.tokens.length * 0.1));
  const chosenIndexes = new Set<number>();

  while (
    chosenIndexes.size < questionCount
    && chosenIndexes.size < input.tokens.length
  ) {
    const candidates = input.tokens
      .map((token, index) => ({ index, token }))
      .filter(({ index }) => !chosenIndexes.has(index));

    const weights = candidates.map(({ token }) => {
      const score = input.scoreByWordId.get(token.wordId);
      const normalizedScore = score === undefined ? 0 : Math.max(0, Math.min(1, score));

      return (1 - normalizedScore) + 0.05;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
      break;
    }

    let random = Math.random() * totalWeight;
    let selectedIndex = candidates[candidates.length - 1]?.index;
    for (let index = 0; index < candidates.length; index += 1) {
      random -= weights[index];

      if (random <= 0) {
        selectedIndex = candidates[index].index;
        break;
      }
    }

    if (selectedIndex !== undefined) {
      chosenIndexes.add(selectedIndex);
    }
  }

  return Array.from(chosenIndexes);
}

async function createSentenceExerciseFromRawSentence(input: {
  sentenceId: number;
  sentence: string;
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const pairs = parseBilingualSentence(input.sentence);

  if (pairs.length === 0) {
    throw new Error(`Could not generate a valid bilingual sentence from '${input.sentence}'`);
  }

  const wordIdMap = await storeTranslationPairs(
    pairs.map((pair) => ({
      sourceWord: pair.source,
      targetWord: pair.target,
      sourceLanguage: input.learningLanguage,
      targetLanguage: input.knownLanguage,
    })),
  );

  const wordKnowledgeTable = await getUserWordKnowledgeTable(input.userId);
  const knownWordIds = new Set(
    wordKnowledgeTable
      .filter((row) => row.knowledgeScore > 0)
      .map((row) => row.wordId),
  );
  const scoreByWordId = new Map(
    wordKnowledgeTable.map((row) => [row.wordId, row.knowledgeScore]),
  );
  const tokens: SentenceToken[] = pairs.map((pair) => {
    const wordId = wordIdMap.get(normalizeWord(pair.source));

    if (!wordId) {
      throw new Error("Missing word id for generated sentence token.");
    }

    const score = scoreByWordId.get(wordId);

    return {
      source: pair.source,
      target: pair.target,
      wordId,
      isKnown: knownWordIds.has(wordId),
      revealByDefault: score === undefined || score === 0,
      isQuestion: false,
    };
  });

  const questionIndexes = getQuestionIndexesByKnowledgeScore({
    tokens,
    scoreByWordId,
  });
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

  return { sentenceId: input.sentenceId, tokens, questions };
}

async function warmSentenceAudioCache(input: {
  sentenceId: number;
  sourceText?: string;
  preGeneratedAudio?: Promise<Buffer | null>;
}): Promise<void> {
  try {
    await getOrCreateSentenceAudio({
      sentenceId: input.sentenceId,
      sourceText: input.sourceText,
      preGeneratedAudio: input.preGeneratedAudio,
    });
  } catch (error) {
    console.warn("Failed to warm sentence audio cache:", error);
  }
}

export async function createSentenceExerciseFromPrompt(input: {
  topic: string;
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const aiSentence = await generateFromOpenAI(input);
  const rawSentence = aiSentence?.rawSentence ?? fallbackSentence(input.topic, input.learningLanguage);
  const sourceText = aiSentence?.sourceText ?? fallbackSourceSentence(input.topic, input.learningLanguage);
  const sourceTextAudioPromise = aiSentence?.sourceTextAudioPromise ?? generateSpeechFromOpenAI(sourceText);
  const sentenceId = await saveGeneratedSentence({
    topic: input.topic,
    learningLanguage: input.learningLanguage,
    rawSentence,
    sourceText,
  });

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId,
    sentence: rawSentence,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({
    sentenceId,
    sourceText,
    preGeneratedAudio: sourceTextAudioPromise,
  });

  return exercise;
}

export async function createSentenceExerciseFromRandomSentence(input: {
  topic: string;
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const savedSentence = await getRandomSavedSentence(input.learningLanguage);

  if (!savedSentence) {
    return createSentenceExerciseFromPrompt(input);
  }

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId: savedSentence.id,
    sentence: savedSentence.rawSentence,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({ sentenceId: savedSentence.id });

  return exercise;
}

export async function createSentenceExerciseFromSentenceId(input: {
  sentenceId: number;
  topic: string;
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const savedSentence = await getSavedSentenceById({
    sentenceId: input.sentenceId,
    learningLanguage: input.learningLanguage,
  });

  if (!savedSentence) {
    return createSentenceExerciseFromRandomSentence(input);
  }

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId: savedSentence.id,
    sentence: savedSentence.rawSentence,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({ sentenceId: savedSentence.id });

  return exercise;
}

export async function getOrCreateSentenceAudio(input: {
  sentenceId: number;
  sourceText?: string;
  preGeneratedAudio?: Promise<Buffer | null>;
}): Promise<{ audio: Buffer; mimeType: string } | null> {
  await ensureLearningTables();
  const db = getDb();

  const existingAudio = await db
    .selectFrom("sentence_audio")
    .select("audio_mp3")
    .where("sentence_translation_id", "=", input.sentenceId)
    .executeTakeFirst();

  if (existingAudio) {
    const audioBuffer = asAudioBuffer(existingAudio.audio_mp3);

    return {
      audio: audioBuffer,
      mimeType: detectAudioMimeType(audioBuffer),
    };
  }

  const sourceTextFromInput = input.sourceText?.trim();
  let sourceText = sourceTextFromInput;

  if (!sourceText) {
    const sentenceRow = await db
      .selectFrom("sentence_translations")
      .select("source_text")
      .where("id", "=", input.sentenceId)
      .executeTakeFirst();
    sourceText = sentenceRow?.source_text?.trim();
  }

  if (!sourceText) {
    return null;
  }

  const ttsAudio = input.preGeneratedAudio
    ? await input.preGeneratedAudio
    : await generateSpeechFromOpenAI(sourceText);

  if (!ttsAudio) {
    return null;
  }

  await db
    .insertInto("sentence_audio")
    .values({
      sentence_translation_id: input.sentenceId,
      audio_mp3: ttsAudio,
    })
    .onConflict((oc) => oc.column("sentence_translation_id").doNothing())
    .execute();

  const audioRow = await db
    .selectFrom("sentence_audio")
    .select("audio_mp3")
    .where("sentence_translation_id", "=", input.sentenceId)
    .executeTakeFirst();

  if (!audioRow) {
    return null;
  }

  const audioBuffer = asAudioBuffer(audioRow.audio_mp3);

  return {
    audio: audioBuffer,
    mimeType: detectAudioMimeType(audioBuffer),
  };
}

export async function getOrCreateSentenceAudioDataUrl(input: {
  sentenceId: number;
}): Promise<string | null> {
  const audio = await getOrCreateSentenceAudio(input);

  if (!audio) {
    return null;
  }

  return toAudioDataUrl(audio.audio);
}
