"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  message?: string;
  email?: string;
  mode?: "signin" | "signup" | "magic";
};

const emailSchema = z.string().trim().email("Enter a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${proto}://${host}`;
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { error: parsed.error.issues[0].message, email, mode: "signin" };
  if (!password) return { error: "Enter your password", email, mode: "signin" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data, password });
  if (error) return { error: error.message, email, mode: "signin" };
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const e = emailSchema.safeParse(email);
  if (!e.success) return { error: e.error.issues[0].message, email, mode: "signup" };
  const p = passwordSchema.safeParse(password);
  if (!p.success) return { error: p.error.issues[0].message, email, mode: "signup" };

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: e.data,
    password: p.data,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message, email, mode: "signup" };
  if (data.session) redirect("/");
  return {
    message: "Check your email for a confirmation link, then sign in.",
    email,
    mode: "signin",
  };
}

export async function magicLinkAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const e = emailSchema.safeParse(email);
  if (!e.success) return { error: e.error.issues[0].message, email, mode: "magic" };
  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email: e.data,
    options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true },
  });
  if (error) return { error: error.message, email, mode: "magic" };
  return { message: "Magic link sent. Check your inbox.", email, mode: "magic" };
}
