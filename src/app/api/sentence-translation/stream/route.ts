import { getCurrentUser } from "@/lib/auth";
import {
  buildDraftSegmentsFromDb,
  createSentenceExerciseFromRawSentence,
  createSentenceExerciseFromRandomSentence,
  generateSourceTextFromPromptStream,
  saveGeneratedSentence,
  type SentenceStreamingPayload,
} from "@/lib/sentence-translation";
import { LANGUAGE_LABELS, isSupportedLearningLanguage } from "@/lib/language-settings";
import { alignBilingualPairsWithOriginalText, parseBilingualSentence } from "@/lib/parse-bilingual-sentence";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

function normalizeTopic(value: unknown): string {
  if (typeof value !== "string") {
    return "Random story";
  }

  return value.trim() || "Random story";
}

function createSseEvent(payload: SentenceStreamingPayload): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPEN_AI_KEY;
  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

async function translateSourceTextToBilingualWithJson(input: {
  sourceText: string;
  learningLanguage: string;
  knownLanguage: string;
}) {
  const client = getOpenAiClient();
  if (!client) {
    return null;
  }

  const learningLanguage = isSupportedLearningLanguage(input.learningLanguage) ? input.learningLanguage : "es";
  const knownLanguage = isSupportedLearningLanguage(input.knownLanguage) ? input.knownLanguage : "en";
  const learningLanguageLabel = LANGUAGE_LABELS[learningLanguage];
  const knownLanguageLabel = LANGUAGE_LABELS[knownLanguage];

  const translationSystemPrompt = [
    `Convert ${learningLanguageLabel} text into bilingual token format.`,
    `Each token must be in this format: (${learningLanguageLabel}|${knownLanguageLabel}).`,
    `Use honest, literal ${knownLanguageLabel} translations; do not smooth grammar for naturalness.`,
    "Do not merge tokens. Keep token order and punctuation aligned to the source text.",
    'Output valid JSON only with a single key named "sentence".',
  ].join(" ");

  const response = await client.responses.create({
    model: "gpt-5.4-mini",
    input: [
      { role: "system", content: translationSystemPrompt },
      { role: "user", content: input.sourceText },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "bilingual_sentence_response",
        schema: {
          type: "object",
          properties: {
            sentence: { type: "string" },
          },
          required: ["sentence"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  });

  const sentence = response.output_text?.trim();

  if (!sentence) {
    return null;
  }

  try {
    return JSON.parse(sentence) as { sentence: string };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const mode = body?.mode === "random" ? "random" : "prompt";
  const topic = normalizeTopic(body?.topic);

  if (mode === "random") {
    const exercise = await createSentenceExerciseFromRandomSentence({
      topic,
      userId: user.id,
      learningLanguage: user.learningLanguage,
      knownLanguage: user.knownLanguage,
    });

    return Response.json({ events: [{ type: "final_exercise", exercise }] });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const push = (payload: SentenceStreamingPayload) => {
        controller.enqueue(encoder.encode(createSseEvent(payload)));
      };

      void (async () => {
        try {
          const streamed = await generateSourceTextFromPromptStream({
            topic,
            learningLanguage: user.learningLanguage,
            onDelta: (delta) => {
              push({ type: "source_delta", delta });
            },
          });

          if (!streamed) {
            const fallbackExercise = await createSentenceExerciseFromRandomSentence({
              topic,
              userId: user.id,
              learningLanguage: user.learningLanguage,
              knownLanguage: user.knownLanguage,
            });
            push({ type: "final_exercise", exercise: fallbackExercise });
            controller.close();
            return;
          }

          const draftSegments = await buildDraftSegmentsFromDb({
            sourceText: streamed.sourceText,
            learningLanguage: user.learningLanguage,
            knownLanguage: user.knownLanguage,
          });

          const draftExercise = await createSentenceExerciseFromRawSentence({
            sentenceId: 0,
            segments: draftSegments,
            userId: user.id,
            learningLanguage: user.learningLanguage,
            knownLanguage: user.knownLanguage,
          });

          push({
            type: "draft_exercise",
            sourceText: streamed.sourceText,
            exercise: {
              ...draftExercise,
              questions: [],
              tokens: draftExercise.tokens.map((token) => token.kind === "word"
                ? { ...token, isQuestion: false }
                : token),
            },
          });

          const translated = await translateSourceTextToBilingualWithJson({
            sourceText: streamed.sourceText,
            learningLanguage: user.learningLanguage,
            knownLanguage: user.knownLanguage,
          });

          if (!translated?.sentence) {
            push({ type: "error", message: "Could not translate generated text." });
            controller.close();
            return;
          }

          const finalSegments = alignBilingualPairsWithOriginalText(
            streamed.sourceText,
            parseBilingualSentence(translated.sentence),
          );

          const sentenceId = await saveGeneratedSentence({
            topic,
            learningLanguage: user.learningLanguage,
            rawSentence: translated.sentence,
            sourceText: streamed.sourceText,
            translationSegments: finalSegments,
            translationVersion: 2,
          });

          const finalExercise = await createSentenceExerciseFromRawSentence({
            sentenceId,
            segments: finalSegments,
            userId: user.id,
            learningLanguage: user.learningLanguage,
            knownLanguage: user.knownLanguage,
          });

          push({ type: "final_exercise", exercise: finalExercise });
          controller.close();
        } catch (error) {
          console.error("sentence stream failed", error);
          push({ type: "error", message: "Failed to stream sentence." });
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
