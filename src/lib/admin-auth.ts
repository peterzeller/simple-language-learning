import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser, type SessionUser } from "@/lib/auth";

const ADMIN_USER_ID = 1;

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user || user.id !== ADMIN_USER_ID) {
    redirect("/");
  }

  return user;
}
