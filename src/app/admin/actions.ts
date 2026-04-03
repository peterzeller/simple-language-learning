"use server";

import { redirect } from "next/navigation";

import { ensureLearningTables, getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin-auth";

function parseId(value: FormDataEntryValue | null, fieldName: string): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${fieldName} id.`);
  }

  return id;
}

export async function deleteWordTranslation(formData: FormData): Promise<void> {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const wordId = parseId(formData.get("wordId"), "word");
  const fromId = parseId(formData.get("fromId"), "source word");
  const toId = parseId(formData.get("toId"), "target word");

  await db
    .deleteFrom("word_links")
    .where("from_id", "=", fromId)
    .where("to_id", "=", toId)
    .executeTakeFirst();

  redirect(`/admin/words/${wordId}`);
}

export async function deleteWord(formData: FormData): Promise<void> {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const wordId = parseId(formData.get("wordId"), "word");

  await db.deleteFrom("words").where("id", "=", wordId).executeTakeFirst();

  redirect("/admin/words");
}

export async function deleteSentence(formData: FormData): Promise<void> {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const sentenceId = parseId(formData.get("sentenceId"), "sentence");

  await db
    .deleteFrom("sentence_translations")
    .where("id", "=", sentenceId)
    .executeTakeFirst();

  redirect("/admin/sentences");
}
