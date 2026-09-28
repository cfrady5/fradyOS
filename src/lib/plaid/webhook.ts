import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { getWebhookVerificationKey } from "./client";

export type Jwk = { kty: string; crv: string; x: string; y: string; kid?: string; alg?: string; expired_at?: number | null };
type KeyFetcher = (kid: string) => Promise<Jwk>;

const cache = new Map<string, { jwk: Jwk; at: number }>();
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_S = 5 * 60;

function b64urlJson<T>(s: string): T {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
}

async function defaultFetcher(kid: string): Promise<Jwk> {
  const r = await getWebhookVerificationKey(kid);
  return r.key;
}

/**
 * Verifies Plaid's `Plaid-Verification` header: an ES256 JWT whose payload carries a SHA-256 of the
 * raw body and an issued-at time. Keys are fetched from Plaid by `kid` and cached. Never call
 * request.json() before this: the body must be verified as received, byte for byte.
 */
export async function verifyPlaidWebhook(rawBody: string, jwt: string | null, opts: { fetchKey?: KeyFetcher; now?: number } = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!jwt) return { ok: false, reason: "Missing Plaid-Verification header" };
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed verification token" };
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: "Unreadable verification token" };
  }
  if (header.alg !== "ES256" || !header.kid) return { ok: false, reason: "Unexpected token algorithm" };
  const fetchKey = opts.fetchKey ?? defaultFetcher;
  const now = opts.now ?? Date.now();
  let jwk = cache.get(header.kid)?.jwk;
  if (!jwk || now - (cache.get(header.kid)?.at ?? 0) > CACHE_MS) {
    try {
      jwk = await fetchKey(header.kid);
      cache.set(header.kid, { jwk, at: now });
    } catch (e) {
      return { ok: false, reason: `Could not fetch Plaid verification key: ${e instanceof Error ? e.message : "error"}` };
    }
  }
  let valid = false;
  try {
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
    valid = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "Signature does not verify" };
  if (typeof payload.iat !== "number" || Math.abs(now / 1000 - payload.iat) > MAX_AGE_S) return { ok: false, reason: "Verification token is too old" };
  const digest = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (payload.request_body_sha256 !== digest) return { ok: false, reason: "Body hash mismatch" };
  return { ok: true };
}

export function _clearKeyCache() {
  cache.clear();
}
