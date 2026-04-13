import "server-only";

import OpenAI from "openai";
import { sql } from "kysely";

import { ensureLearningTables, ensureUsersTable, getDb } from "@/lib/db";

interface ResolvedOpenAiAccess {
  client: OpenAI;
  apiKeyId: number;
  keySource: "system" | "user";
}

export class OpenAiBudgetExceededError extends Error {
  constructor(public readonly userId: number) {
    super("Monthly OpenAI budget exceeded for this user.");
    this.name = "OpenAiBudgetExceededError";
  }
}

const MODEL_PRICING_PER_1M_TOKENS: Record<string, { input: number; output: number; cachedInput?: number }> = {
  "gpt-5.4-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
};

function parseUsd(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getCurrentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function resolveOpenAiAccess(userId: number): Promise<ResolvedOpenAiAccess | null> {
  await ensureUsersTable();
  await ensureLearningTables();
  const db = getDb();

  const user = await db
    .selectFrom("users")
    .select(["id", "openai_monthly_limit_usd", "openai_api_key", "openai_api_key_monthly_limit_usd"])
    .where("id", "=", userId)
    .executeTakeFirst();

  if (!user) {
    return null;
  }

  const hasOwnApiKey = Boolean(user.openai_api_key?.trim());
  const apiKey = hasOwnApiKey ? user.openai_api_key!.trim() : (process.env.OPEN_AI_KEY ?? "").trim();

  if (!apiKey) {
    return null;
  }

  const modelLimitUsd = hasOwnApiKey
    ? parseUsd(user.openai_api_key_monthly_limit_usd)
    : parseUsd(user.openai_monthly_limit_usd);

  const existingKey = hasOwnApiKey
    ? await db
      .selectFrom("openai_api_keys")
      .select(["id"])
      .where("user_id", "=", user.id)
      .where("key_source", "=", "user")
      .executeTakeFirst()
    : await db
      .selectFrom("openai_api_keys")
      .select(["id"])
      .where("user_id", "is", null)
      .where("key_source", "=", "system")
      .executeTakeFirst();

  const keyRow = existingKey ?? await db
    .insertInto("openai_api_keys")
    .values({
      user_id: hasOwnApiKey ? user.id : null,
      key_source: hasOwnApiKey ? "user" : "system",
      api_key: apiKey,
      updated_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  if (existingKey) {
    await db
      .updateTable("openai_api_keys")
      .set({ api_key: apiKey, updated_at: new Date() })
      .where("id", "=", existingKey.id)
      .executeTakeFirst();
  }

  const monthStart = getCurrentMonthStart();
  const spentRow = await db
    .selectFrom("openai_api_call_costs")
    .select((expressionBuilder) => expressionBuilder.fn.coalesce(
      expressionBuilder.fn.sum<number>("cost_usd"),
      sql<number>`0`,
    ).as("spent"),
    )
    .where("user_id", "=", user.id)
    .where("created_at", ">=", monthStart)
    .executeTakeFirstOrThrow();

  const spentThisMonth = Number(spentRow.spent ?? 0);

  if (modelLimitUsd - spentThisMonth <= 0) {
    throw new OpenAiBudgetExceededError(user.id);
  }

  return {
    client: new OpenAI({ apiKey }),
    apiKeyId: keyRow.id,
    keySource: hasOwnApiKey ? "user" : "system",
  };
}

export async function recordOpenAiCallCost(input: {
  userId: number;
  apiKeyId: number;
  model: string;
  costUsd: number;
}): Promise<void> {
  if (!(input.costUsd > 0)) {
    return;
  }

  await ensureLearningTables();
  const db = getDb();

  await db
    .insertInto("openai_api_call_costs")
    .values({
      user_id: input.userId,
      api_key_id: input.apiKeyId,
      model: input.model,
      cost_usd: input.costUsd.toFixed(6),
    })
    .executeTakeFirst();
}

export function estimateResponsesApiCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number {
  const pricing = MODEL_PRICING_PER_1M_TOKENS[input.model];
  if (!pricing) {
    return 0;
  }

  const inputCost = (input.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (input.outputTokens / 1_000_000) * pricing.output;
  const cachedInputCost = ((input.cachedInputTokens ?? 0) / 1_000_000) * (pricing.cachedInput ?? pricing.input);

  return inputCost + outputCost + cachedInputCost;
}
