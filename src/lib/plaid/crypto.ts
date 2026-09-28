import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Plaid access tokens are encrypted at rest with AES-256-GCM.
 * Key: PLAID_TOKEN_ENCRYPTION_KEY (64 hex chars or 32+ bytes base64). When it is not set, a key is
 * derived from CRON_SECRET with HKDF so the integration works out of the box; the UI and /api/health
 * flag that fallback. Rotating whichever secret is in use makes stored tokens unreadable, which
 * simply means reconnecting each bank.
 */
export type KeySource = "env" | "derived" | "none";

export function keySource(): KeySource {
  if (process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim()) return "env";
  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16) return "derived";
  return "none";
}

function keyBytes(): Buffer {
  const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const b = Buffer.from(raw, "base64");
    if (b.length >= 32) return createHash("sha256").update(b).digest();
    return createHash("sha256").update(raw, "utf8").digest();
  }
  const cron = process.env.CRON_SECRET;
  if (cron && cron.length >= 16) return Buffer.from(hkdfSync("sha256", cron, "frady-os-plaid", "plaid-access-token-v1", 32));
  throw new Error("Set PLAID_TOKEN_ENCRYPTION_KEY (64 hex chars) so Plaid access tokens can be stored encrypted");
}

export function encryptToken(plain: string): string {
  const key = keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptToken(enc: string): string {
  const [v, ivB, tagB, ctB] = enc.split(".");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("Stored Plaid token has an unknown format");
  const key = keyBytes();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the stored Plaid token (was the encryption key changed?). Reconnect the bank.");
  }
}
