import "server-only";

/**
 * Minimal Plaid API client on fetch. Keys are read on the server only.
 * Env names accepted (first match wins):
 *   client id: PLAID_CLIENT_ID | CLIENT_ID
 *   secret:    PLAID_SECRET | SECRET_Plaid | PLAID_SANDBOX_SECRET | PLAID_PRODUCTION_SECRET
 *   env:       PLAID_ENV = sandbox | production (default sandbox; production when only PLAID_PRODUCTION_SECRET is set)
 */
export type PlaidEnv = "sandbox" | "production";

function pick(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function plaidEnv(): PlaidEnv {
  const e = pick("PLAID_ENV")?.toLowerCase();
  if (e === "production" || e === "prod") return "production";
  if (e === "sandbox") return "sandbox";
  if (!pick("PLAID_SECRET", "SECRET_Plaid", "PLAID_SANDBOX_SECRET") && pick("PLAID_PRODUCTION_SECRET")) return "production";
  return "sandbox";
}

export function plaidCredentials(): { clientId: string; secret: string } | null {
  const clientId = pick("PLAID_CLIENT_ID", "CLIENT_ID");
  const env = plaidEnv();
  const secret = env === "production" ? pick("PLAID_PRODUCTION_SECRET", "PLAID_SECRET", "SECRET_Plaid") : pick("PLAID_SECRET", "SECRET_Plaid", "PLAID_SANDBOX_SECRET");
  if (!clientId || !secret) return null;
  return { clientId, secret };
}

export function isPlaidConfigured() {
  return plaidCredentials() !== null;
}

/** Products requested at Link time. `transactions` also refreshes balances; add `liabilities` for APR + minimum payments. */
export function plaidProducts(): string[] {
  const raw = pick("PLAID_PRODUCTS") ?? "transactions";
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? Array.from(new Set(list)) : ["transactions"];
}

export function plaidRedirectUri(): string | null {
  return pick("PLAID_REDIRECT_URI") ?? null;
}

const BASES: Record<PlaidEnv, string> = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" };

export class PlaidError extends Error {
  code: string;
  type: string;
  requestId: string | null;
  status: number;
  constructor(message: string, opts: { code?: string; type?: string; requestId?: string | null; status?: number } = {}) {
    super(message);
    this.name = "PlaidError";
    this.code = opts.code ?? "UNKNOWN";
    this.type = opts.type ?? "API_ERROR";
    this.requestId = opts.requestId ?? null;
    this.status = opts.status ?? 0;
  }
}

/** Error codes that mean the user has to go through Link again (update mode). */
export const REAUTH_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "ITEM_LOCKED", "USER_SETUP_REQUIRED", "MFA_NOT_SUPPORTED", "NO_ACCOUNTS", "INSUFFICIENT_CREDENTIALS", "INVALID_CREDENTIALS"]);
/** Codes that mean "not ready yet, try later" rather than a real failure. */
export const TRANSIENT_CODES = new Set(["PRODUCT_NOT_READY", "RATE_LIMIT_EXCEEDED", "INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "INSTITUTION_NO_LONGER_SUPPORTED", "INTERNAL_SERVER_ERROR", "PLANNED_MAINTENANCE"]);

export async function plaidCall<T>(path: string, body: Record<string, unknown>, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const creds = plaidCredentials();
  if (!creds) throw new PlaidError("Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET", { code: "NOT_CONFIGURED", type: "CONFIG" });
  const res = await fetch(`${BASES[plaidEnv()]}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "PLAID-CLIENT-ID": creds.clientId, "PLAID-SECRET": creds.secret, "Plaid-Version": "2020-09-14" },
    body: JSON.stringify(body),
    signal: opts.signal,
    cache: "no-store",
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || typeof json.error_code === "string") {
    const code = (json.error_code as string) ?? `HTTP_${res.status}`;
    const message = (json.error_message as string) || (json.display_message as string) || `Plaid request failed (${res.status})`;
    throw new PlaidError(message, { code, type: (json.error_type as string) ?? "API_ERROR", requestId: (json.request_id as string) ?? null, status: res.status });
  }
  return json as T;
}

/* ---------- Response shapes (subset) ---------- */

export interface PlaidBalances {
  available: number | null;
  current: number | null;
  limit: number | null;
  iso_currency_code: string | null;
}
export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: PlaidBalances;
}
export interface PlaidItemInfo {
  item_id: string;
  institution_id: string | null;
  institution_name?: string | null;
  products?: string[];
  billed_products?: string[];
  consent_expiration_time?: string | null;
  error?: { error_code: string; error_message: string } | null;
}
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // Plaid: positive = money out
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
}
export interface PlaidLiabilities {
  credit?: { account_id: string | null; aprs?: { apr_percentage: number; apr_type: string }[]; minimum_payment_amount?: number | null; last_statement_balance?: number | null; next_payment_due_date?: string | null }[];
  student?: { account_id: string | null; interest_rate_percentage?: number | null; minimum_payment_amount?: number | null; origination_principal_amount?: number | null }[];
  mortgage?: { account_id: string | null; interest_rate?: { percentage: number | null } | null; next_monthly_payment?: number | null; origination_principal_amount?: number | null }[];
}

export function createLinkToken(args: { userId: string; webhook?: string | null; redirectUri?: string | null; accessToken?: string | null; products?: string[] }) {
  const body: Record<string, unknown> = {
    user: { client_user_id: args.userId },
    client_name: "FRADY OS",
    language: "en",
    country_codes: ["US"],
  };
  if (args.accessToken) body.access_token = args.accessToken; // update mode: no products
  else {
    const products = args.products ?? plaidProducts();
    body.products = products.filter((p) => p === "transactions" || p === "auth" || p === "liabilities" || p === "investments").length ? products : ["transactions"];
    body.transactions = { days_requested: 365 };
  }
  if (args.webhook) body.webhook = args.webhook;
  if (args.redirectUri) body.redirect_uri = args.redirectUri;
  return plaidCall<{ link_token: string; expiration: string }>("/link/token/create", body);
}

export function exchangePublicToken(publicToken: string) {
  return plaidCall<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
}

export function getItem(accessToken: string) {
  return plaidCall<{ item: PlaidItemInfo; status?: { transactions?: { last_successful_update: string | null } } }>("/item/get", { access_token: accessToken });
}

export async function getInstitutionName(institutionId: string): Promise<string | null> {
  try {
    const r = await plaidCall<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: institutionId, country_codes: ["US"], options: { include_optional_metadata: false } });
    return r.institution?.name ?? null;
  } catch {
    return null;
  }
}

export function getAccounts(accessToken: string) {
  return plaidCall<{ accounts: PlaidAccount[]; item: PlaidItemInfo }>("/accounts/get", { access_token: accessToken });
}

/** Real-time balances (billed per call). */
export function getBalances(accessToken: string) {
  return plaidCall<{ accounts: PlaidAccount[]; item: PlaidItemInfo }>("/accounts/balance/get", { access_token: accessToken });
}

export function getLiabilities(accessToken: string) {
  return plaidCall<{ accounts: PlaidAccount[]; liabilities: PlaidLiabilities }>("/liabilities/get", { access_token: accessToken });
}

export function syncTransactionsPage(accessToken: string, cursor: string | null) {
  return plaidCall<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string; account_id?: string }[]; next_cursor: string; has_more: boolean }>("/transactions/sync", {
    access_token: accessToken,
    cursor: cursor ?? undefined,
    count: 500,
    options: { include_personal_finance_category: true },
  });
}

export function removeItem(accessToken: string) {
  return plaidCall<{ request_id: string }>("/item/remove", { access_token: accessToken });
}

export function getWebhookVerificationKey(keyId: string) {
  return plaidCall<{ key: { alg: string; crv: string; kid: string; kty: string; use: string; x: string; y: string; created_at: number; expired_at: number | null } }>("/webhook_verification_key/get", { key_id: keyId });
}
