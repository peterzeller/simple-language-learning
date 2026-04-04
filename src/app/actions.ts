"use server";

import { redirect } from "next/navigation";

import { type AuthFormState } from "@/app/auth-form-state";
import {
  clearUserSession,
  createUserSession,
  getCurrentUser,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth";
import { ensureUsersTable, getDb } from "@/lib/db";

function readCredentials(formData: FormData): {
  email: string;
  password: string;
} {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  return {
    email: normalizeEmail(email),
    password,
  };
}

function validateCredentials(email: string, password: string): string | null {
  if (!email) {
    return "Enter your email address.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }

  if (!password) {
    return "Enter your password.";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }

  return null;
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  await ensureUsersTable();
  const db = getDb();

  const { email, password } = readCredentials(formData);
  const validationError = validateCredentials(email, password);

  if (validationError) {
    return { error: validationError };
  }

  const user = await db
    .selectFrom("users")
    .select(["id", "password_hash"])
    .where("email", "=", email)
    .executeTakeFirst();

  if (!user) {
    return { error: "No account was found for that email address." };
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    return { error: "Incorrect email or password." };
  }

  await createUserSession(user.id);
  redirect("/");
}

export async function register(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  await ensureUsersTable();
  const db = getDb();

  const { email, password } = readCredentials(formData);
  const validationError = validateCredentials(email, password);

  if (validationError) {
    return { error: validationError };
  }

  const existingUser = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirst();

  if (existingUser) {
    return { error: "An account with that email already exists." };
  }

  const passwordHash = await hashPassword(password);
  const insertedUser = await db
    .insertInto("users")
    .values({
      email,
      password_hash: passwordHash,
      learning_language: "es",
      known_language: "en",
      updated_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await createUserSession(insertedUser.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await clearUserSession();
  redirect("/");
}

export async function redirectLoggedInUsers(): Promise<void> {
  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }
}
