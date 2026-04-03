import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

import { ensureUsersTable, getDb } from "@/lib/db";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE_NAME = "simple-language-learning-session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

export interface SessionUser {
  id: number;
  email: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Buffer.from(buffer).toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [salt, key] = storedHash.split(":");

  if (!salt || !key) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKey = Buffer.from(key, "hex");

  if (storedKey.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedKey, derivedKey);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createUserSession(userId: number): Promise<void> {
  await ensureUsersTable();
  const db = getDb();

  const sessionToken = createSessionToken();
  const sessionTokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db
    .updateTable("users")
    .set({
      session_token_hash: sessionTokenHash,
      session_expires_at: expiresAt,
      updated_at: new Date(),
    })
    .where("id", "=", userId)
    .executeTakeFirst();

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearUserSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return;
  }

  await ensureUsersTable();
  const db = getDb();
  const sessionTokenHash = await sha256Hex(sessionToken);

  await db
    .updateTable("users")
    .set({
      session_token_hash: null,
      session_expires_at: null,
      updated_at: new Date(),
    })
    .where("session_token_hash", "=", sessionTokenHash)
    .executeTakeFirst();

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  await ensureUsersTable();
  const db = getDb();
  const sessionTokenHash = await sha256Hex(sessionToken);
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "session_expires_at"])
    .where("session_token_hash", "=", sessionTokenHash)
    .executeTakeFirst();

  if (!user?.session_expires_at) {
    return null;
  }

  if (user.session_expires_at.getTime() <= Date.now()) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
  };
}

export { normalizeEmail };
