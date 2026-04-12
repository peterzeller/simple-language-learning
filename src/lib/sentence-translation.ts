import "server-only";

import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { sql } from "kysely";

import { ensureLearningTables, getDb } from "@/lib/db";
import { LANGUAGE_LABELS, type SupportedLearningLanguage, isSupportedLearningLanguage } from "@/lib/language-settings";
import {
  getUserWordKnowledgeTable,
  normalizeWord,
  storeTranslationPairs,
} from "@/lib/learning";
import {
  parseBilingualSentence,
  type AlignedBilingualSegment,
} from "@/lib/parse-bilingual-sentence";
import {
  estimateResponsesApiCostUsd,
  recordOpenAiCallCost,
  resolveOpenAiAccess,
} from "@/lib/openai-usage";

export interface SentenceWordToken {
  kind: "word";
  source: string;
  target: string;
  wordId: number;
  isKnown: boolean;
  revealByDefault: boolean;
  isQuestion: boolean;
}

export interface SentenceTextToken {
  kind: "text";
  text: string;
}

export type SentenceToken = SentenceWordToken | SentenceTextToken;

export interface SentenceQuestion {
  tokenIndex: number;
  options: string[];
  correctAnswer: string;
}

export interface SentenceExercise {
  sentenceId: number;
  storyTitle: string;
  storySuggestions: StorySuggestion[];
  randomStories: RandomStoryLink[];
  tokens: SentenceToken[];
  questions: SentenceQuestion[];
}

export interface StorySuggestion {
  headline: string;
  prompt: string;
}

export interface RandomStoryLink {
  sentenceId: number;
  title: string;
}

export interface SentenceWordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

const TRANSLATION_MODULE_VERSION = 6;

interface SavedSentenceRow {
  id: number;
  title: string | null;
  topic: string;
  learningLanguage: string;
  rawSentence: string;
  sourceText: string;
  translationSegments: string;
}
interface StoredTranslationPayload {
  version: number;
  segments: AlignedBilingualSegment[];
}

function asSupportedLanguage(language: string): SupportedLearningLanguage {
  if (isSupportedLearningLanguage(language)) {
    return language;
  }

  return "es";
}

async function saveGeneratedSentence(input: {
  topic: string;
  title: string | null;
  learningLanguage: string;
  rawSentence: string;
  sourceText: string;
  translationSegments: AlignedBilingualSegment[];
  translationVersion: number;
}): Promise<number> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .insertInto("sentence_translations")
    .values({
      topic: input.topic,
      title: input.title,
      learning_language: input.learningLanguage,
      raw_sentence: input.rawSentence,
      translation_segments: JSON.stringify({
        version: input.translationVersion,
        segments: input.translationSegments,
      }),
      translation_version: input.translationVersion,
      source_text: input.sourceText,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return row.id;
}

async function getRandomSavedSentence(learningLanguage: string): Promise<SavedSentenceRow | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select(["id", "title", "topic", "learning_language", "raw_sentence", "source_text", "translation_segments"])
    .where("learning_language", "=", learningLanguage)
    .where("source_text", "is not", null)
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    learningLanguage: row.learning_language,
    rawSentence: row.raw_sentence,
    sourceText: row.source_text ?? "",
    translationSegments: row.translation_segments,
  };
}

async function getSavedSentenceById(input: {
  sentenceId: number;
  learningLanguage: string;
}): Promise<SavedSentenceRow | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select(["id", "title", "topic", "learning_language", "raw_sentence", "source_text", "translation_segments"])
    .where("id", "=", input.sentenceId)
    .where("learning_language", "=", input.learningLanguage)
    .where("source_text", "is not", null)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    learningLanguage: row.learning_language,
    rawSentence: row.raw_sentence,
    sourceText: row.source_text ?? "",
    translationSegments: row.translation_segments,
  };
}

async function saveStorySuggestions(input: {
  sentenceId: number;
  suggestions: StorySuggestion[];
}): Promise<void> {
  if (input.suggestions.length === 0) {
    return;
  }

  await ensureLearningTables();
  const db = getDb();
  await db
    .insertInto("sentence_story_suggestions")
    .values(
      input.suggestions.map((suggestion) => ({
        sentence_translation_id: input.sentenceId,
        headline: suggestion.headline,
        prompt: suggestion.prompt,
      })),
    )
    .execute();
}

async function getStorySuggestions(sentenceId: number): Promise<StorySuggestion[]> {
  await ensureLearningTables();
  const db = getDb();
  const rows = await db
    .selectFrom("sentence_story_suggestions")
    .select(["headline", "prompt"])
    .where("sentence_translation_id", "=", sentenceId)
    .orderBy("id asc")
    .limit(2)
    .execute();

  return rows.map((row) => ({ headline: row.headline, prompt: row.prompt }));
}

async function getRandomStoryLinks(input: {
  learningLanguage: string;
  excludeSentenceId: number;
}): Promise<RandomStoryLink[]> {
  await ensureLearningTables();
  const db = getDb();
  const rows = await db
    .selectFrom("sentence_translations")
    .select(["id", "title", "topic"])
    .where("learning_language", "=", input.learningLanguage)
    .where("id", "!=", input.excludeSentenceId)
    .orderBy(sql`RANDOM()`)
    .limit(2)
    .execute();

  if (rows.length < 2) {
    const existingIds = new Set(rows.map((row) => row.id));
    const needed = 2 - rows.length;
    const fallbackRows = await db
      .selectFrom("sentence_translations")
      .select(["id", "title", "topic"])
      .where("learning_language", "=", input.learningLanguage)
      .where("id", "not in", Array.from(existingIds).length ? Array.from(existingIds) : [-1])
      .orderBy(sql`RANDOM()`)
      .limit(needed)
      .execute();
    rows.push(...fallbackRows);
  }

  return rows.map((row) => ({
    sentenceId: row.id,
    title: row.title?.trim() || row.topic.trim() || `Story ${row.id}`,
  })).slice(0, 2);
}

async function requestOpenAiJson<T>(input: {
  client: OpenAI;
  userId: number;
  apiKeyId: number;
  keySource: "system" | "user";
  source: string;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  useWebSearch: boolean;
  verbosity?: "low" | "medium" | "high";
  model?: string;
}): Promise<T | null> {
  const model = input.model ?? "gpt-5.4-mini";
  const startedAt = Date.now();
  try {
    const response = await input.client.responses.create({
      model,
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
    const usage = response.usage;
    const estimatedCost = estimateResponsesApiCostUsd({
      model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
    });

    await recordOpenAiCallCost({
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      model,
      costUsd: estimatedCost,
    });
    logOpenAiCall({
      operation: `responses.create:${model}`,
      source: input.source,
      userId: input.userId,
      keySource: input.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: estimatedCost,
    });

    if (!outputText?.trim()) {
      return null;
    }

    return JSON.parse(outputText) as T;
  } catch (error) {
    logOpenAiCall({
      operation: `responses.create:${model}`,
      source: input.source,
      userId: input.userId,
      keySource: input.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: 0,
    });
    console.error("OpenAI responses.create failed.", { error });
    return null;
  }
}

async function translateSourceTextToBilingual(input: {
  client: OpenAI;
  userId: number;
  apiKeyId: number;
  keySource: "system" | "user";
  source: string;
  sourceText: string;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<{ rawSentence: string; translationSegments: AlignedBilingualSegment[] } | null> {
  const learningLanguage = asSupportedLanguage(input.learningLanguage);
  const knownLanguage = asSupportedLanguage(input.knownLanguage);
  const learningLanguageLabel = LANGUAGE_LABELS[learningLanguage];
  const knownLanguageLabel = LANGUAGE_LABELS[knownLanguage];

  const translationSystemPrompt = [
    `Convert ${learningLanguageLabel} text into bilingual token format.`,
    `Each single word must be in this format: ⦅${learningLanguageLabel}‖${knownLanguageLabel}⦆.`,
    `Use honest, literal ${knownLanguageLabel} translations; do not smooth grammar for naturalness.`,
    "Do not merge words, translate each word individually. Keep punctuation and spacing outside the translated words.",
    "Example input: ¡Hola! ¿Cómo estás? Compré algunas frutas: plátanos, manzanas y naranjas.",
    "Example output: ¡⦅Hola‖Hello⦆! ¿⦅Cómo‖How⦆ ⦅estás‖are you⦆? ⦅Compré‖I bought⦆ ⦅algunas‖some⦆ ⦅frutas‖fruits⦆: ⦅plátanos‖bananas⦆, ⦅manzanas‖apples⦆ y ⦅naranjas‖oranges⦆.",
    "Output valid JSON only with a single key named \"sentence\".",
  ].join(" ");

  const secondResponse = await requestOpenAiJson<{ sentence: string }>({
    client: input.client,
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    keySource: input.keySource,
    source: input.source,
    systemPrompt: translationSystemPrompt,
    userPrompt: input.sourceText,
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
    return null;
  }

  const translationSegments = parseBilingualSentence(sentence);

  if (translationSegments.length === 0) {
    return null;
  }

  return {
    rawSentence: sentence,
    translationSegments,
  };
}

async function generateFromOpenAI(input: {
  topic: string;
  userId: number;
  storyId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<{
  title: string | null;
  storySuggestions: StorySuggestion[];
  rawSentence: string;
  sourceText: string;
  sourceTextAudioPromise: Promise<Buffer | null>;
  translationSegments: AlignedBilingualSegment[];
} | null> {
  const access = await resolveOpenAiAccess(input.userId);
  const client = access?.client;
  if (!client || !access) {
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
      userId: input.userId,
      apiKeyId: access.apiKeyId,
      keySource: access.keySource,
      source: `generate-story-${input.storyId}`,
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

    const metadataResponse = await requestOpenAiJson<{
      title: string;
      suggestions: Array<{ headline: string; prompt: string }>;
    }>({
      client,
      userId: input.userId,
      apiKeyId: access.apiKeyId,
      keySource: access.keySource,
      source: `story-metadata-${input.storyId}`,
      systemPrompt: [
        `Create metadata for a ${learningLanguageLabel} learning story.`,
        `Return JSON with "title" and exactly 2 "suggestions".`,
        `Each suggestion must have a short "headline" between 1 and 10 words.`,
        `Each suggestion must have a longer "prompt" between 5 and 200 words.`,
        `Write title, headline, and prompt in ${knownLanguageLabel}.`,
      ].join(" "),
      userPrompt: sourceText,
      schemaName: "story_metadata_response",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          suggestions: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                headline: { type: "string" },
                prompt: { type: "string" },
              },
              required: ["headline", "prompt"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "suggestions"],
        additionalProperties: false,
      },
      useWebSearch: false,
    });

    const title = metadataResponse?.title?.trim();
    const storySuggestions = (metadataResponse?.suggestions ?? [])
      .map((suggestion) => ({
        headline: suggestion.headline.trim(),
        prompt: suggestion.prompt.trim(),
      }))
      .filter((suggestion) => suggestion.headline && suggestion.prompt)
      .slice(0, 2);
    const sourceTextAudioPromise = generateSpeechFromOpenAI({
      userId: input.userId,
      source: `tts-story-${input.storyId}`,
      sourceText,
    });

    const translationResponse = await translateSourceTextToBilingual({
      client,
      userId: input.userId,
      apiKeyId: access.apiKeyId,
      keySource: access.keySource,
      source: `translate-story-${input.storyId}`,
      sourceText,
      learningLanguage: input.learningLanguage,
      knownLanguage: input.knownLanguage,
    });

    if (!translationResponse) {
      console.warn("OpenAI translation step failed, falling back to default sentence.");
      return null;
    }

    return {
      title: title || null,
      storySuggestions,
      rawSentence: translationResponse.rawSentence,
      sourceText,
      sourceTextAudioPromise,
      translationSegments: translationResponse.translationSegments,
    };
  } catch (error) {
    console.error("Error generating sentence from OpenAI:", error);
    return null;
  }
}

const inFlightSpeechGenerationByText = new Map<string, {
  expiresAt: number;
  promise: Promise<Buffer | null>;
}>();
const TTS_IN_FLIGHT_TTL_MS = 5 * 60 * 1000;
const MALE_TTS_VOICES = ["ash", "echo", "verse", "cedar"] as const;
const FEMALE_TTS_VOICES = ["alloy", "coral", "sage", "shimmer", "marin"] as const;
const TTS_SYSTEM_PROMPT = [
  "Narrate like an engaging storyteller giving a short talk.",
  "Use warm energy, expressive pacing, and clear articulation.",
  "Emphasize vivid words naturally and keep the tone lively but authentic.",
].join(" ");

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

function pickRandomTtsVoice(): string {
  const voicePool = Math.random() < 0.5 ? MALE_TTS_VOICES : FEMALE_TTS_VOICES;
  return randomItem(voicePool);
}

function logOpenAiCall(input: {
  operation: string;
  source: string;
  userId: number;
  keySource: "system" | "user";
  durationMs: number;
  costUsd: number;
}): void {
  console.info("[OpenAI call]", {
    operation: input.operation,
    source: input.source,
    userId: input.userId,
    keySource: input.keySource,
    durationMs: input.durationMs,
    costUsd: Number(input.costUsd.toFixed(6)),
  });
}

async function requestSpeechFromOpenAI(input: {
  userId: number;
  source: string;
  sourceText: string;
}): Promise<Buffer | null> {
  const access = await resolveOpenAiAccess(input.userId);
  const client = access?.client;

  if (!client || !access) {
    return null;
  }

  const startedAt = Date.now();
  try {
    const speechResponse = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: pickRandomTtsVoice(),
      instructions: TTS_SYSTEM_PROMPT,
      format: "mp3",
      input: input.sourceText,
    });

    const estimatedCost = input.sourceText.length * (12 / 1_000_000);
    await recordOpenAiCallCost({
      userId: input.userId,
      apiKeyId: access.apiKeyId,
      model: "gpt-4o-mini-tts",
      costUsd: estimatedCost,
    });
    logOpenAiCall({
      operation: "audio.speech.create:gpt-4o-mini-tts",
      source: input.source,
      userId: input.userId,
      keySource: access.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: estimatedCost,
    });

    const arrayBuffer = await speechResponse.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return null;
    }

    return Buffer.from(arrayBuffer);
  } catch (error) {
    logOpenAiCall({
      operation: "audio.speech.create:gpt-4o-mini-tts",
      source: input.source,
      userId: input.userId,
      keySource: access.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: 0,
    });
    console.error("Error generating TTS audio from OpenAI:", error);
    return null;
  }
}

function generateSpeechFromOpenAI(input: {
  userId: number;
  source: string;
  sourceText: string;
}): Promise<Buffer | null> {
  const normalizedText = input.sourceText.trim();

  if (!normalizedText) {
    return Promise.resolve(null);
  }

  const now = Date.now();
  const inFlightGeneration = inFlightSpeechGenerationByText.get(normalizedText);

  if (inFlightGeneration && inFlightGeneration.expiresAt > now) {
    return inFlightGeneration.promise;
  }

  if (inFlightGeneration) {
    inFlightSpeechGenerationByText.delete(normalizedText);
  }

  const generationPromise = requestSpeechFromOpenAI({
    userId: input.userId,
    source: input.source,
    sourceText: normalizedText,
  });
  const expiresAt = now + TTS_IN_FLIGHT_TTL_MS;
  inFlightSpeechGenerationByText.set(normalizedText, {
    expiresAt,
    promise: generationPromise,
  });
  const evictionTimer = setTimeout(() => {
    const activeGeneration = inFlightSpeechGenerationByText.get(normalizedText);
    if (activeGeneration?.promise === generationPromise) {
      inFlightSpeechGenerationByText.delete(normalizedText);
    }
  }, TTS_IN_FLIGHT_TTL_MS);

  evictionTimer.unref();
  void generationPromise.finally(() => {
    clearTimeout(evictionTimer);
    const activeGeneration = inFlightSpeechGenerationByText.get(normalizedText);
    if (activeGeneration?.promise === generationPromise) {
      inFlightSpeechGenerationByText.delete(normalizedText);
    }
  });

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

function fallbackStoryTitle(topic: string): string {
  const normalizedTopic = topic.trim();
  return normalizedTopic ? `Story: ${normalizedTopic}` : "Untitled story";
}

function fallbackStorySuggestions(topic: string): StorySuggestion[] {
  const normalizedTopic = topic.trim() || "daily life";
  return [
    {
      headline: "A hidden clue",
      prompt: `Write a follow-up story connected to ${normalizedTopic}. Add one hidden clue in the first half and reveal it at the end.`,
    },
    {
      headline: "Different point of view",
      prompt: `Retell the next chapter about ${normalizedTopic} from another character's perspective. Include conflict, dialogue, and a meaningful ending.`,
    },
  ];
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

function buildFallbackSegments(topic: string, learningLanguage: string): AlignedBilingualSegment[] {
  const sentence = fallbackSentence(topic, learningLanguage);
  return parseBilingualSentence(sentence);
}

function parseStoredSegments(serialized: string): StoredTranslationPayload | null {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const version = (parsed as { version?: unknown }).version;
    const segments = (parsed as { segments?: unknown }).segments;
    if (!Number.isInteger(version) || !Array.isArray(segments)) {
      return null;
    }

    const filteredSegments = segments.filter((item) => typeof item === "string" || (
      typeof item === "object"
      && item !== null
      && typeof (item as { original?: unknown }).original === "string"
      && typeof (item as { translation?: unknown }).translation === "string"
    )) as AlignedBilingualSegment[];
    return { version: Number(version), segments: filteredSegments };
  } catch (error) {
    console.warn("Failed to parse stored translation segments.", { error, serialized });
    return null;
  }
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
  storyTitle: string;
  segments: AlignedBilingualSegment[];
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const pairs = input.segments.filter((segment): segment is { original: string; translation: string } =>
    typeof segment !== "string");

  if (pairs.length === 0) {
    throw new Error("Could not generate a valid bilingual sentence.");
  }

  const wordIdMap = await storeTranslationPairs(
    pairs.map((pair) => ({
      sourceWord: pair.original,
      targetWord: pair.translation,
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
  const tokens: SentenceToken[] = input.segments.map((segment) => {
    if (typeof segment === "string") {
      return { kind: "text", text: segment };
    }

    const wordId = wordIdMap.get(normalizeWord(segment.original));

    if (!wordId) {
      throw new Error("Missing word id for generated sentence token.");
    }

    const score = scoreByWordId.get(wordId);

    return {
      kind: "word",
      source: segment.original,
      target: segment.translation,
      wordId,
      isKnown: knownWordIds.has(wordId),
      revealByDefault: score === undefined || score === 0,
      isQuestion: false,
    };
  });

  const wordTokenIndexes = tokens
    .map((token, index) => (token.kind === "word" ? index : -1))
    .filter((index) => index >= 0);
  const wordTokens = wordTokenIndexes.map((index) => tokens[index]).filter((token): token is SentenceWordToken => token.kind === "word");

  const questionIndexes = getQuestionIndexesByKnowledgeScore({
    tokens: wordTokens,
    scoreByWordId,
  });
  for (const wordIndex of questionIndexes) {
    const tokenIndex = wordTokenIndexes[wordIndex];
    const token = tokens[tokenIndex];
    if (token?.kind === "word") {
      token.isQuestion = true;
    }
  }
  const optionPool = Array.from(new Set(wordTokens.map((token) => token.target)));

  const questions = questionIndexes.map((wordIndex) => {
    const tokenIndex = wordTokenIndexes[wordIndex];
    const token = tokens[tokenIndex];

    if (!token || token.kind !== "word") {
      throw new Error("Question generation failed due to invalid token type.");
    }

    const correctAnswer = token.target;
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

  const [storySuggestions, randomStories] = await Promise.all([
    getStorySuggestions(input.sentenceId),
    getRandomStoryLinks({
      learningLanguage: input.learningLanguage,
      excludeSentenceId: input.sentenceId,
    }),
  ]);
  const fallbackSuggestions = fallbackStorySuggestions(input.storyTitle);
  const resolvedSuggestions = storySuggestions.length >= 2
    ? storySuggestions.slice(0, 2)
    : [
      ...storySuggestions,
      ...fallbackSuggestions.slice(0, 2 - storySuggestions.length),
    ];

  return {
    sentenceId: input.sentenceId,
    storyTitle: input.storyTitle,
    storySuggestions: resolvedSuggestions,
    randomStories,
    tokens,
    questions,
  };
}

async function warmSentenceAudioCache(input: {
  sentenceId: number;
  userId: number;
  sourceText?: string;
  preGeneratedAudio?: Promise<Buffer | null>;
}): Promise<void> {
  try {
    await getOrCreateSentenceAudio({
      sentenceId: input.sentenceId,
      userId: input.userId,
      sourceText: input.sourceText,
      preGeneratedAudio: input.preGeneratedAudio,
    });
  } catch (error) {
    console.warn("Failed to warm sentence audio cache:", error);
  }
}

async function refreshSentenceSegmentsIfNeeded(input: {
  userId: number;
  storyId: number;
  sentence: SavedSentenceRow;
  knownLanguage: string;
}): Promise<AlignedBilingualSegment[] | null> {
  const existingSegments = parseStoredSegments(input.sentence.translationSegments);
  if (existingSegments?.version === TRANSLATION_MODULE_VERSION && existingSegments.segments.length) {
    return existingSegments.segments;
  }

  const sourceText = input.sentence.sourceText.trim();
  if (!sourceText) {
    return existingSegments?.segments ?? null;
  }

  const access = await resolveOpenAiAccess(input.userId);
  const client = access?.client;
  if (!client || !access) {
    return existingSegments?.segments ?? null;
  }

  const updated = await translateSourceTextToBilingual({
    client,
    userId: input.userId,
    apiKeyId: access.apiKeyId,
    keySource: access.keySource,
    source: `translate-story-${input.storyId}`,
    sourceText,
    learningLanguage: input.sentence.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  if (!updated) {
    return existingSegments?.segments ?? null;
  }

  await ensureLearningTables();
  const db = getDb();
  await db
    .updateTable("sentence_translations")
    .set({
      raw_sentence: updated.rawSentence,
      translation_segments: JSON.stringify({
        version: TRANSLATION_MODULE_VERSION,
        segments: updated.translationSegments,
      }),
      translation_version: TRANSLATION_MODULE_VERSION,
    })
    .where("id", "=", input.sentence.id)
    .executeTakeFirst();

  return updated.translationSegments;
}

export async function createSentenceExerciseFromPrompt(input: {
  topic: string;
  userId: number;
  learningLanguage: string;
  knownLanguage: string;
}): Promise<SentenceExercise> {
  const provisionalStoryId = Date.now();
  const aiSentence = await generateFromOpenAI({ ...input, storyId: provisionalStoryId });
  const storyTitle = aiSentence?.title?.trim() || fallbackStoryTitle(input.topic);
  const rawSentence = aiSentence?.rawSentence ?? fallbackSentence(input.topic, input.learningLanguage);
  const sourceText = aiSentence?.sourceText ?? fallbackSourceSentence(input.topic, input.learningLanguage);
  const translationSegments = aiSentence?.translationSegments ?? buildFallbackSegments(input.topic, input.learningLanguage);
  const storySuggestions = aiSentence?.storySuggestions?.length
    ? aiSentence.storySuggestions
    : fallbackStorySuggestions(input.topic);
  const sourceTextAudioPromise = aiSentence?.sourceTextAudioPromise ?? generateSpeechFromOpenAI({
    userId: input.userId,
    source: `tts-story-${provisionalStoryId}`,
    sourceText,
  });
  const sentenceId = await saveGeneratedSentence({
    topic: input.topic,
    title: storyTitle,
    learningLanguage: input.learningLanguage,
    rawSentence,
    sourceText,
    translationSegments,
    translationVersion: TRANSLATION_MODULE_VERSION,
  });
  await saveStorySuggestions({
    sentenceId,
    suggestions: storySuggestions.slice(0, 2),
  });

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId,
    storyTitle,
    segments: translationSegments,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({
    sentenceId,
    userId: input.userId,
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

  const translationSegments = await refreshSentenceSegmentsIfNeeded({
    userId: input.userId,
    storyId: savedSentence.id,
    sentence: savedSentence,
    knownLanguage: input.knownLanguage,
  });
  if (!translationSegments?.length) {
    return createSentenceExerciseFromPrompt(input);
  }

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId: savedSentence.id,
    storyTitle: savedSentence.title?.trim() || savedSentence.topic.trim() || `Story ${savedSentence.id}`,
    segments: translationSegments,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({ sentenceId: savedSentence.id, userId: input.userId });

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

  const translationSegments = await refreshSentenceSegmentsIfNeeded({
    userId: input.userId,
    storyId: savedSentence.id,
    sentence: savedSentence,
    knownLanguage: input.knownLanguage,
  });
  if (!translationSegments?.length) {
    return createSentenceExerciseFromRandomSentence(input);
  }

  const exercise = await createSentenceExerciseFromRawSentence({
    sentenceId: savedSentence.id,
    storyTitle: savedSentence.title?.trim() || savedSentence.topic.trim() || `Story ${savedSentence.id}`,
    segments: translationSegments,
    userId: input.userId,
    learningLanguage: input.learningLanguage,
    knownLanguage: input.knownLanguage,
  });

  void warmSentenceAudioCache({ sentenceId: savedSentence.id, userId: input.userId });

  return exercise;
}

export async function getOrCreateSentenceAudio(input: {
  sentenceId: number;
  userId: number;
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
    : await generateSpeechFromOpenAI({
      userId: input.userId,
      source: `tts-story-${input.sentenceId}`,
      sourceText,
    });

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
  userId: number;
}): Promise<string | null> {
  const audio = await getOrCreateSentenceAudio(input);

  if (!audio) {
    return null;
  }

  return toAudioDataUrl(audio.audio);
}

function isValidSentenceWordTimestamp(value: unknown): value is SentenceWordTimestamp {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.word === "string"
    && typeof candidate.startSeconds === "number"
    && Number.isFinite(candidate.startSeconds)
    && candidate.startSeconds >= 0
    && typeof candidate.endSeconds === "number"
    && Number.isFinite(candidate.endSeconds)
    && candidate.endSeconds >= candidate.startSeconds
  );
}

function parseSentenceWordTimestamps(value: string): SentenceWordTimestamp[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return null;
    }

    const words = parsed.filter(isValidSentenceWordTimestamp);

    if (words.length === 0) {
      return null;
    }

    return words;
  } catch {
    return null;
  }
}

async function transcribeAudioWords(input: {
  userId: number;
  sentenceId: number;
  audio: Buffer;
}): Promise<SentenceWordTimestamp[] | null> {
  const access = await resolveOpenAiAccess(input.userId);
  const client = access?.client;

  if (!client || !access) {
    return null;
  }

  const startedAt = Date.now();
  try {
    const transcription = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      file: await toFile(input.audio, `sentence-${input.sentenceId}.mp3`, {
        type: "audio/mpeg",
      }),
    });

    logOpenAiCall({
      operation: "audio.transcriptions.create:gpt-4o-transcribe",
      source: `transcript-story-${input.sentenceId}`,
      userId: input.userId,
      keySource: access.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: 0,
    });

    const words = (transcription.words ?? [])
      .map((word) => ({
        word: word.word.trim(),
        startSeconds: word.start,
        endSeconds: word.end,
      }))
      .filter((word) =>
        word.word.length > 0
        && Number.isFinite(word.startSeconds)
        && Number.isFinite(word.endSeconds)
        && word.startSeconds >= 0
        && word.endSeconds >= word.startSeconds,
      );

    return words.length > 0 ? words : null;
  } catch (error) {
    logOpenAiCall({
      operation: "audio.transcriptions.create:gpt-4o-transcribe",
      source: `transcript-story-${input.sentenceId}`,
      userId: input.userId,
      keySource: access.keySource,
      durationMs: Date.now() - startedAt,
      costUsd: 0,
    });
    console.error("Error generating transcription from OpenAI:", error);
    return null;
  }
}

export async function getOrCreateSentenceWordTimestamps(input: {
  sentenceId: number;
  userId: number;
}): Promise<SentenceWordTimestamp[]> {
  await ensureLearningTables();
  const db = getDb();

  const existingTranscript = await db
    .selectFrom("sentence_audio_transcripts")
    .select("transcript_json")
    .where("sentence_translation_id", "=", input.sentenceId)
    .executeTakeFirst();

  if (existingTranscript) {
    const parsed = parseSentenceWordTimestamps(existingTranscript.transcript_json);
    if (parsed) {
      return parsed;
    }
  }

  const audio = await getOrCreateSentenceAudio({
    sentenceId: input.sentenceId,
    userId: input.userId,
  });

  if (!audio) {
    return [];
  }

  const words = await transcribeAudioWords({
    userId: input.userId,
    sentenceId: input.sentenceId,
    audio: audio.audio,
  });

  if (!words?.length) {
    return [];
  }

  await db
    .insertInto("sentence_audio_transcripts")
    .values({
      sentence_translation_id: input.sentenceId,
      transcript_json: JSON.stringify(words),
    })
    .onConflict((oc) => oc.column("sentence_translation_id").doUpdateSet({
      transcript_json: JSON.stringify(words),
    }))
    .execute();

  return words;
}

export async function fillMissingSentenceTitlesAtStartup(): Promise<void> {
  await ensureLearningTables();
  const db = getDb();
  const user = await db.selectFrom("users").select("id").orderBy("id asc").limit(1).executeTakeFirst();

  if (!user) {
    return;
  }

  const access = await resolveOpenAiAccess(user.id);
  if (!access) {
    return;
  }

  const untitledRows = await db
    .selectFrom("sentence_translations")
    .select(["id", "topic", "source_text"])
    .where((eb) => eb.or([
      eb("title", "is", null),
      eb("title", "=", ""),
    ]))
    .where("source_text", "is not", null)
    .orderBy("id asc")
    .limit(20)
    .execute();

  for (const row of untitledRows) {
    const sourceText = row.source_text?.trim();
    if (!sourceText) {
      continue;
    }

    const response = await requestOpenAiJson<{ title: string }>({
      client: access.client,
      userId: user.id,
      apiKeyId: access.apiKeyId,
      keySource: access.keySource,
      source: `backfill-title-${row.id}`,
      systemPrompt: "Create one short title for the provided story text. Output JSON with key \"title\".",
      userPrompt: sourceText,
      schemaName: "story_title_response",
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      useWebSearch: false,
    });

    const title = response?.title?.trim() || fallbackStoryTitle(row.topic);
    await db
      .updateTable("sentence_translations")
      .set({ title })
      .where("id", "=", row.id)
      .executeTakeFirst();
  }
}
