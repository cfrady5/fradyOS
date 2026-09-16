import "server-only";
import type { NextRequest } from "next/server";

/**
 * Scheduled endpoints accept only requests carrying the CRON_SECRET.
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export function isAuthorizedCron(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return { ok: false, status: 500, error: "CRON_SECRET is not configured (must be at least 16 characters)" };
  const auth = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : header;
  if (!presented || !timingSafeEqual(presented, secret)) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
