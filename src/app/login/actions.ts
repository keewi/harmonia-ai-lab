"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, AUTH_MAX_AGE, labPassword, sessionToken } from "@/lib/auth";

export async function signIn(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const password = labPassword();
  const token = await sessionToken();
  if (!password || !token) return { error: "No password is set up yet. Add LAB_PASSWORD to .env.local and restart." };
  if (String(form.get("password") ?? "") !== password) return { error: "That password isn't right." };
  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
