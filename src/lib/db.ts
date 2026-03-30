import "server-only";

import { Generated, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

type TimestampColumn = Date;

interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  session_token_hash: string | null;
  session_expires_at: TimestampColumn | null;
  created_at: Generated<TimestampColumn>;
  updated_at: Generated<TimestampColumn>;
}

interface Database {
  users: UsersTable;
}

declare global {
  var __simpleLanguageLearningPool: Pool | undefined;
  var __simpleLanguageLearningDb: Kysely<Database> | undefined;
  var __simpleLanguageLearningUsersInit: Promise<void> | undefined;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const pool =
  globalThis.__simpleLanguageLearningPool ??
  new Pool({
    host: getRequiredEnv("POSTGRES_HOST"),
    user: getRequiredEnv("POSTGRES_USER"),
    password: getRequiredEnv("POSTGRES_PASSWORD"),
    database: getRequiredEnv("POSTGRES_DB"),
    port: Number(process.env.POSTGRES_PORT ?? 5432),
  });

const db =
  globalThis.__simpleLanguageLearningDb ??
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

if (!globalThis.__simpleLanguageLearningPool) {
  globalThis.__simpleLanguageLearningPool = pool;
}

if (!globalThis.__simpleLanguageLearningDb) {
  globalThis.__simpleLanguageLearningDb = db;
}

export async function ensureUsersTable(): Promise<void> {
  globalThis.__simpleLanguageLearningUsersInit ??= db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "integer", (column) =>
      column.generatedAlwaysAsIdentity().primaryKey(),
    )
    .addColumn("email", "varchar(320)", (column) => column.notNull())
    .addColumn("password_hash", "text", (column) => column.notNull())
    .addColumn("session_token_hash", "varchar(64)")
    .addColumn("session_expires_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("users_email_key", ["email"])
    .addUniqueConstraint("users_session_token_hash_key", ["session_token_hash"])
    .execute()
    .then(() => undefined);

  await globalThis.__simpleLanguageLearningUsersInit;
}

export async function initializeDatabase(): Promise<void> {
  await ensureUsersTable();
}

export { db };
