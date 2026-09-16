import "server-only";
import { headers } from "next/headers";

export function isMondayWebhookConfigured() {
  const s = process.env.MONDAY_WEBHOOK_SECRET?.trim();
  return Boolean(s && s.length >= 16);
}

/** Public origin of this deployment (NEXT_PUBLIC_SITE_URL, else derived from the request). */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/** The URL to paste into Monday's "Send a webhook" recipe. Null until MONDAY_WEBHOOK_SECRET is set. */
export async function getMondayWebhookUrl(): Promise<string | null> {
  if (!isMondayWebhookConfigured()) return null;
  const origin = await siteOrigin();
  return `${origin}/api/webhooks/monday?token=${encodeURIComponent(process.env.MONDAY_WEBHOOK_SECRET!.trim())}`;
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
