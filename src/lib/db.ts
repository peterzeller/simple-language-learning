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

interface WordsTable {
  id: Generated<number>;
  language: string;
  word: string;
}

interface WordLinksTable {
  from_id: number;
  to_id: number;
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
  raw_sentence: string;
  created_at: Generated<TimestampColumn>;
}

interface Database {
  users: UsersTable;
  words: WordsTable;
  word_links: WordLinksTable;
  user_learning: UserLearningTable;
  sentence_translations: SentenceTranslationsTable;
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

    await sql`
      UPDATE words
      SET word = lower(trim(regexp_replace(word, '[[:punct:]]+', '', 'g')));
    `.execute(db);

    await db.schema
      .createTable("word_links")
      .ifNotExists()
      .addColumn("from_id", "integer", (column) =>
        column.references("words.id").onDelete("cascade").notNull(),
      )
      .addColumn("to_id", "integer", (column) =>
        column.references("words.id").onDelete("cascade").notNull(),
      )
      .addPrimaryKeyConstraint("word_links_pkey", ["from_id", "to_id"])
      .execute();

    await sql`
      DROP TABLE IF EXISTS word_links_migrated;

      CREATE TEMP TABLE word_links_migrated AS
      WITH normalized_words AS (
        SELECT
          id,
          language,
          lower(trim(regexp_replace(word, '[[:punct:]]+', '', 'g'))) AS normalized_word
        FROM words
      ),
      canonical_words AS (
        SELECT
          language,
          normalized_word,
          MIN(id) AS keep_id
        FROM normalized_words
        GROUP BY language, normalized_word
      )
      SELECT DISTINCT
        from_canonical.keep_id AS from_id,
        to_canonical.keep_id AS to_id
      FROM word_links AS links
      JOIN normalized_words AS from_words ON from_words.id = links.from_id
      JOIN normalized_words AS to_words ON to_words.id = links.to_id
      JOIN canonical_words AS from_canonical
        ON from_canonical.language = from_words.language
        AND from_canonical.normalized_word = from_words.normalized_word
      JOIN canonical_words AS to_canonical
        ON to_canonical.language = to_words.language
        AND to_canonical.normalized_word = to_words.normalized_word;

      TRUNCATE TABLE word_links;

      INSERT INTO word_links (from_id, to_id)
      SELECT from_id, to_id
      FROM word_links_migrated;

      DROP TABLE word_links_migrated;
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

    await sql`
      WITH normalized_words AS (
        SELECT
          id,
          language,
          lower(trim(regexp_replace(word, '[[:punct:]]+', '', 'g'))) AS normalized_word
        FROM words
      ),
      canonical_words AS (
        SELECT
          language,
          normalized_word,
          MIN(id) AS keep_id
        FROM normalized_words
        GROUP BY language, normalized_word
      ),
      words_dedup_map AS (
        SELECT normalized_words.id AS duplicate_id, canonical_words.keep_id
        FROM normalized_words
        JOIN canonical_words
          ON canonical_words.language = normalized_words.language
          AND canonical_words.normalized_word = normalized_words.normalized_word
        WHERE normalized_words.id <> canonical_words.keep_id
      )
      UPDATE user_learning
      SET word_id = words_dedup_map.keep_id
      FROM words_dedup_map
      WHERE user_learning.word_id = words_dedup_map.duplicate_id;
    `.execute(db);

    await sql`
      WITH normalized_words AS (
        SELECT
          id,
          language,
          lower(trim(regexp_replace(word, '[[:punct:]]+', '', 'g'))) AS normalized_word
        FROM words
      ),
      canonical_words AS (
        SELECT
          language,
          normalized_word,
          MIN(id) AS keep_id
        FROM normalized_words
        GROUP BY language, normalized_word
      ),
      words_dedup_map AS (
        SELECT normalized_words.id AS duplicate_id
        FROM normalized_words
        JOIN canonical_words
          ON canonical_words.language = normalized_words.language
          AND canonical_words.normalized_word = normalized_words.normalized_word
        WHERE normalized_words.id <> canonical_words.keep_id
      )
      DELETE FROM words
      USING words_dedup_map
      WHERE words.id = words_dedup_map.duplicate_id;
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'words_language_word_key'
        ) THEN
          ALTER TABLE words
          ADD CONSTRAINT words_language_word_key UNIQUE (language, word);
        END IF;
      END
      $$;
    `.execute(db);

    await db.schema
      .createTable("sentence_translations")
      .ifNotExists()
      .addColumn("id", "integer", (column) =>
        column.generatedAlwaysAsIdentity().primaryKey(),
      )
      .addColumn("topic", "text", (column) => column.notNull())
      .addColumn("raw_sentence", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .execute();
  })();

  await globalThis.__simpleLanguageLearningLearningInit;
}

export async function initializeDatabase(): Promise<void> {
  await ensureUsersTable();
  await ensureLearningTables();
}
