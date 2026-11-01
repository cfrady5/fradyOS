import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WHOOP signs each webhook with HMAC-SHA256 over `<timestamp><raw body>` using the app's client secret,
 * base64-encoded in X-WHOOP-Signature, with the timestamp in X-WHOOP-Signature-Timestamp.
 * Deliveries older than five minutes are rejected to blunt replays.
 */
export function verifyWhoopSignature(rawBody: string, signature: string | null, timestamp: string | null, clientSecret: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (!signature || !timestamp) return { ok: false, reason: "Missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Bad timestamp" };
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (Math.abs(now - tsMs) > 5 * 60_000) return { ok: false, reason: "Stale timestamp" };
  const expected = createHmac("sha256", clientSecret).update(`${timestamp}${rawBody}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return { ok: false, reason: "Bad signature encoding" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "Signature mismatch" };
  return { ok: true };
}

export type WhoopWebhookType = "workout.updated" | "workout.deleted" | "sleep.updated" | "sleep.deleted" | "recovery.updated" | "recovery.deleted";

export interface WhoopWebhookEvent {
  user_id: number | string;
  id: string | number;
  type: WhoopWebhookType;
  trace_id?: string;
}

export const WEBHOOK_TYPES: WhoopWebhookType[] = ["workout.updated", "workout.deleted", "sleep.updated", "sleep.deleted", "recovery.updated", "recovery.deleted"];
