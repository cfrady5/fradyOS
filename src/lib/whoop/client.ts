import "server-only";

/**
 * WHOOP developer API v2. Tokens come from the OAuth flow in /api/whoop/connect and /api/whoop/callback.
 * The client paces itself under the documented limits (100 requests a minute, 10,000 a day) and backs
 * off on 429 or 5xx responses.
 */
export const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
export const WHOOP_SCOPES = ["offline", "read:recovery", "read:cycles", "read:sleep", "read:workout", "read:profile", "read:body_measurement"];

export function whoopConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.WHOOP_CLIENT_ID?.trim();
  const clientSecret = process.env.WHOOP_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const isWhoopConfigured = () => whoopConfig() !== null;

export class WhoopError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "WhoopError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const cfg = whoopConfig();
  if (!cfg) throw new WhoopError("WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET are not configured", 500);
  const u = new URL(WHOOP_AUTH_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", WHOOP_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const cfg = whoopConfig();
  if (!cfg) throw new WhoopError("WHOOP is not configured", 500);
  const body = new URLSearchParams({ ...form, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  const res = await fetch(WHOOP_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenSet> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new WhoopError(json.error_description || json.error || `Token request failed (${res.status})`, res.status || 502);
  }
  return json as TokenSet;
}

export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" });

/** Simple in-process pacing: never more than 90 calls in any rolling minute from this instance. */
const calls: number[] = [];
async function pace() {
  const now = Date.now();
  while (calls.length && calls[0] < now - 60_000) calls.shift();
  if (calls.length >= 90) {
    const wait = calls[0] + 60_000 - now + 50;
    await new Promise((r) => setTimeout(r, wait));
  }
  calls.push(Date.now());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET against the v2 API with retry on 429/5xx (exponential backoff, honouring Retry-After). */
export async function whoopGet<T>(accessToken: string, path: string, params: Record<string, string | number | undefined> = {}, attempt = 0): Promise<T> {
  const u = new URL(`${WHOOP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  await pace();
  const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, cache: "no-store" });
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
    if (attempt < 4) {
      await sleep(waitMs);
      return whoopGet<T>(accessToken, path, params, attempt + 1);
    }
    throw new WhoopError(`WHOOP ${res.status} after retries`, res.status, waitMs);
  }
  if (res.status === 401) throw new WhoopError("WHOOP token rejected", 401);
  if (res.status === 404) throw new WhoopError("Not found", 404);
  if (!res.ok) throw new WhoopError(`WHOOP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return (await res.json()) as T;
}

export interface Page<T> {
  records: T[];
  next_token?: string | null;
}

/** Iterates a paginated collection, newest first as the API returns it, until next_token is empty or `maxPages` is hit. */
export async function* paginate<T>(accessToken: string, path: string, params: Record<string, string | number | undefined>, maxPages = 40): AsyncGenerator<T[], void, void> {
  let next: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await whoopGet<Page<T>>(accessToken, path, { ...params, limit: 25, nextToken: next });
    yield page.records ?? [];
    if (!page.next_token) return;
    next = page.next_token;
  }
}
