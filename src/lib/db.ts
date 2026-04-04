import "server-only";

import { Generated, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

type TimestampColumn = Date;

interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  learning_language: string;
  known_language: string;
  session_token_hash: string | null;
  session_expires_at: TimestampColumn | null;
  created_at: Generated<TimestampColumn>;
  updated_at: Generated<TimestampColumn>;
}

interface WordsTable {
  id: Generated<number>;
  language: string;
  word: string;
}

interface WordLinksTable {
  from_id: number;
  to_id: number;
  count: number;
}

interface UserLearningTable {
  id: Generated<number>;
  user_id: number;
  word_id: number;
  attempted_at: TimestampColumn;
  is_correct: boolean;
}

interface SentenceTranslationsTable {
  id: Generated<number>;
  topic: string;
  learning_language: string;
  raw_sentence: string;
  source_text: string | null;
  created_at: Generated<TimestampColumn>;
}

interface SentenceAudioTable {
  id: Generated<number>;
  sentence_translation_id: number;
  audio_mp3: Buffer;
  created_at: Generated<TimestampColumn>;
}

interface Database {
  users: UsersTable;
  words: WordsTable;
  word_links: WordLinksTable;
  user_learning: UserLearningTable;
  sentence_translations: SentenceTranslationsTable;
  sentence_audio: SentenceAudioTable;
}

declare global {
  var __simpleLanguageLearningPool: Pool | undefined;
  var __simpleLanguageLearningDb: Kysely<Database> | undefined;
  var __simpleLanguageLearningUsersInit: Promise<void> | undefined;
  var __simpleLanguageLearningLearningInit: Promise<void> | undefined;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getPool(): Pool {
  globalThis.__simpleLanguageLearningPool ??= new Pool({
    host: getRequiredEnv("POSTGRES_HOST"),
    user: getRequiredEnv("POSTGRES_USER"),
    password: getRequiredEnv("POSTGRES_PASSWORD"),
    database: getRequiredEnv("POSTGRES_DB"),
    port: Number(process.env.POSTGRES_PORT ?? 5432),
  });

  return globalThis.__simpleLanguageLearningPool;
}

export function getDb(): Kysely<Database> {
  globalThis.__simpleLanguageLearningDb ??= new Kysely<Database>({
    dialect: new PostgresDialect({ pool: getPool() }),
  });

  return globalThis.__simpleLanguageLearningDb;
}

export async function ensureUsersTable(): Promise<void> {
  const db = getDb();

  globalThis.__simpleLanguageLearningUsersInit ??= db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "integer", (column) =>
      column.generatedAlwaysAsIdentity().primaryKey(),
    )
    .addColumn("email", "varchar(320)", (column) => column.notNull())
    .addColumn("password_hash", "text", (column) => column.notNull())
    .addColumn("learning_language", "varchar(12)", (column) => column.notNull().defaultTo("es"))
    .addColumn("known_language", "varchar(12)", (column) => column.notNull().defaultTo("en"))
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
    .then(async () => {
      await sql`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS learning_language varchar(12) NOT NULL DEFAULT 'es'
      `.execute(db);
      await sql`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS known_language varchar(12) NOT NULL DEFAULT 'en'
      `.execute(db);
    })
    .then(() => undefined);

  await globalThis.__simpleLanguageLearningUsersInit;
}

export async function ensureLearningTables(): Promise<void> {
  const db = getDb();

  globalThis.__simpleLanguageLearningLearningInit ??= (async () => {
    await db.schema
      .createTable("words")
      .ifNotExists()
      .addColumn("id", "integer", (column) =>
        column.generatedAlwaysAsIdentity().primaryKey(),
      )
      .addColumn("language", "varchar(12)", (column) => column.notNull())
      .addColumn("word", "text", (column) => column.notNull())
      .addUniqueConstraint("words_language_word_key", ["language", "word"])
      .execute();

    await db.schema
      .createTable("word_links")
      .ifNotExists()
      .addColumn("from_id", "integer", (column) =>
        column.references("words.id").onDelete("cascade").notNull(),
      )
      .addColumn("to_id", "integer", (column) =>
        column.references("words.id").onDelete("cascade").notNull(),
      )
      .addColumn("count", "integer", (column) => column.notNull().defaultTo(1))
      .addPrimaryKeyConstraint("word_links_pkey", ["from_id", "to_id"])
      .execute();

    await sql`
      ALTER TABLE word_links
      ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1
    `.execute(db);

    await db.schema
      .createTable("user_learning")
      .ifNotExists()
      .addColumn("id", "integer", (column) =>
        column.generatedAlwaysAsIdentity().primaryKey(),
      )
      .addColumn("user_id", "integer", (column) =>
        column.references("users.id").onDelete("cascade").notNull(),
      )
      .addColumn("word_id", "integer", (column) =>
        column.references("words.id").onDelete("cascade").notNull(),
      )
      .addColumn("attempted_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("is_correct", "boolean", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("sentence_translations")
      .ifNotExists()
      .addColumn("id", "integer", (column) =>
        column.generatedAlwaysAsIdentity().primaryKey(),
      )
      .addColumn("topic", "text", (column) => column.notNull())
      .addColumn("learning_language", "varchar(12)", (column) => column.notNull().defaultTo("es"))
      .addColumn("raw_sentence", "text", (column) => column.notNull())
      .addColumn("source_text", "text")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .execute();

    await sql`
      ALTER TABLE sentence_translations
      ADD COLUMN IF NOT EXISTS learning_language varchar(12) NOT NULL DEFAULT 'es'
    `.execute(db);

    await sql`
      ALTER TABLE sentence_translations
      ADD COLUMN IF NOT EXISTS source_text text
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'sentence_translations'
            AND column_name = 'spanish_text'
        ) THEN
          UPDATE sentence_translations
          SET source_text = spanish_text
          WHERE source_text IS NULL
            AND spanish_text IS NOT NULL;
        END IF;
      END $$;
    `.execute(db);

    await sql`
      ALTER TABLE sentence_translations
      DROP COLUMN IF EXISTS spanish_text
    `.execute(db);

    await db.schema
      .createTable("sentence_audio")
      .ifNotExists()
      .addColumn("id", "integer", (column) =>
        column.generatedAlwaysAsIdentity().primaryKey(),
      )
      .addColumn("sentence_translation_id", "integer", (column) =>
        column.references("sentence_translations.id").onDelete("cascade").notNull(),
      )
      .addColumn("audio_mp3", "bytea", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addUniqueConstraint("sentence_audio_sentence_translation_id_key", ["sentence_translation_id"])
      .execute();
  })();

  await globalThis.__simpleLanguageLearningLearningInit;
}

export async function initializeDatabase(): Promise<void> {
  await ensureUsersTable();
  await ensureLearningTables();
}
