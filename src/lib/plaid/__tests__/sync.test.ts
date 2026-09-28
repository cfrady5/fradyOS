import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidItem } from "@/lib/finance/types";
import type { PlaidAccount, PlaidTransaction } from "../client";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ---- in-memory supabase stand-in (subset used by the sync) ---- */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let idCounter = 0;
function reset() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const t of ["plaid_items", "plaid_item_secrets", "plaid_sync_runs", "profiles", "financial_accounts", "financial_balance_snapshots", "financial_debts", "financial_budget_categories", "financial_transactions"]) tables[t] = [];
  idCounter = 0;
}
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: Row | Row[] | null = null;
  let conflict: string[] = [];
  let single = false;
  const b = {
    select() { return b; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return b; },
    order() { return b; },
    limit() { return b; },
    insert(p: Row | Row[]) { op = "insert"; payload = p; return b; },
    upsert(p: Row | Row[], o?: { onConflict?: string }) { op = "upsert"; payload = p; conflict = (o?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean); return b; },
    update(p: Row) { op = "update"; payload = p; return b; },
    delete() { op = "delete"; return b; },
    single() { single = true; return b; },
    maybeSingle() { single = true; return b; },
    then(resolve: (v: { data: unknown; error: null | { message: string } }) => void) {
      const rows = tables[table];
      const match = (r: Row) => filters.every((f) => f(r));
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload!];
        const out: Row[] = [];
        for (const p of list) {
          const hit = op === "upsert" && conflict.length ? rows.find((r) => conflict.every((k) => r[k] === p[k])) : undefined;
          if (hit) { Object.assign(hit, p); out.push(hit); continue; }
          const row = { id: `${table}-${++idCounter}`, ...p };
          rows.push(row);
          out.push(row);
        }
        return resolve({ data: single ? out[0] : out, error: null });
      }
      if (op === "update") { const hit = rows.filter(match); for (const r of hit) Object.assign(r, payload); return resolve({ data: hit, error: null }); }
      if (op === "delete") { tables[table] = rows.filter((r) => !match(r)); return resolve({ data: null, error: null }); }
      const hit = rows.filter(match);
      return resolve({ data: single ? (hit[0] ?? null) : hit, error: null });
    },
  };
  return b;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fake = { from: (t: string) => builder(t) } as unknown as SupabaseClient<any, any, any>;

/* ---- mocked Plaid client ---- */
const plaid = { accounts: [] as PlaidAccount[], pages: [] as { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }[], balanceCalls: 0, accountCalls: 0, liabilitiesCalls: 0, syncCalls: [] as (string | null)[], failWith: null as null | { code: string; message: string }, liabilities: null as null | Record<string, unknown> };
vi.mock("../client", async () => {
  const actual = await vi.importActual<typeof import("../client")>("../client");
  const fail = () => { if (plaid.failWith) throw new actual.PlaidError(plaid.failWith.message, { code: plaid.failWith.code }); };
  return {
    ...actual,
    getBalances: vi.fn(async () => { fail(); plaid.balanceCalls++; return { accounts: plaid.accounts, item: { item_id: "it-1", institution_id: "ins_1", products: ["transactions", "liabilities"] } }; }),
    getAccounts: vi.fn(async () => { fail(); plaid.accountCalls++; return { accounts: plaid.accounts, item: { item_id: "it-1", institution_id: "ins_1", products: ["transactions", "liabilities"] } }; }),
    getItem: vi.fn(async () => ({ item: { item_id: "it-1", institution_id: "ins_1", products: ["transactions", "liabilities"] } })),
    getLiabilities: vi.fn(async () => { plaid.liabilitiesCalls++; return { accounts: plaid.accounts, liabilities: plaid.liabilities ?? {} }; }),
    syncTransactionsPage: vi.fn(async (_t: string, cursor: string | null) => { plaid.syncCalls.push(cursor); const idx = plaid.syncCalls.length - 1; return plaid.pages[Math.min(idx, plaid.pages.length - 1)]; }),
  };
});
vi.mock("../crypto", () => ({ decryptToken: (s: string) => s.replace("enc:", ""), encryptToken: (s: string) => `enc:${s}` }));

const { runPlaidSync } = await import("../sync");

const item: PlaidItem = { id: "row", user_id: "u1", item_id: "it-1", institution_id: "ins_1", institution_name: "Plaid Bank", environment: "sandbox", status: "active", error_code: null, error_message: null, products: ["transactions", "liabilities"], transactions_cursor: null, last_synced_at: null, last_webhook_at: null, consent_expires_at: null, created_at: "", updated_at: "" };

function acct(id: string, type: string, subtype: string, current: number, extra: Partial<PlaidAccount> = {}): PlaidAccount {
  return { account_id: id, name: `${subtype} acct`, official_name: null, mask: id.slice(-4), type, subtype, balances: { available: null, current, limit: null, iso_currency_code: "USD" }, ...extra };
}
function tx(id: string, account_id: string, amount: number, date: string, primary: string, detailed = `${primary}_X`): PlaidTransaction {
  return { transaction_id: id, account_id, amount, date, name: id, merchant_name: null, pending: false, personal_finance_category: { primary, detailed } };
}

describe("runPlaidSync", () => {
  beforeEach(() => {
    reset();
    plaid.accounts = [];
    plaid.pages = [];
    plaid.balanceCalls = 0;
    plaid.accountCalls = 0;
    plaid.liabilitiesCalls = 0;
    plaid.syncCalls = [];
    plaid.failWith = null;
    plaid.liabilities = null;
    tables.plaid_items.push({ ...item });
    tables.plaid_item_secrets.push({ item_id: "it-1", user_id: "u1", access_token_enc: "enc:access-1" });
    tables.profiles.push({ id: "u1", timezone: "America/Indiana/Indianapolis" });
    tables.financial_budget_categories.push({ id: "cat-food", user_id: "u1", is_archived: false, plaid_categories: ["FOOD_AND_DRINK"] }, { id: "cat-housing", user_id: "u1", is_archived: false, plaid_categories: ["RENT_AND_UTILITIES_RENT"] });
  });

  it("creates accounts, debts, snapshots and transactions on first sync; updates balances on the next", async () => {
    plaid.accounts = [acct("acc-chk-0001", "depository", "checking", 1500.5, { balances: { available: 1400, current: 1500.5, limit: null, iso_currency_code: "USD" } }), acct("acc-card-0002", "credit", "credit card", 410), acct("acc-401k-0003", "investment", "401k", 12000)];
    plaid.liabilities = { credit: [{ account_id: "acc-card-0002", aprs: [{ apr_percentage: 24.99, apr_type: "purchase_apr" }], minimum_payment_amount: 35 }] };
    plaid.pages = [
      { added: [tx("t1", "acc-chk-0001", 54.1, "2026-09-02", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"), tx("t2", "acc-chk-0001", -2500, "2026-09-01", "INCOME", "INCOME_WAGES")], modified: [], removed: [], next_cursor: "c1", has_more: true },
      { added: [tx("t3", "acc-card-0002", 1200, "2026-09-03", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")], modified: [], removed: [], next_cursor: "c2", has_more: false },
    ];
    const r = await runPlaidSync(fake, item, { trigger: "link", realtime: true });
    expect(r).toMatchObject({ accounts_seen: 3, accounts_created: 3, accounts_updated: 0, transactions_added: 3, liabilities: true, realtime: true });
    expect(plaid.balanceCalls).toBe(1);
    expect(plaid.syncCalls).toEqual([null, "c1"]);

    const accounts = tables.financial_accounts;
    const card = accounts.find((a) => a.external_account_id === "acc-card-0002")!;
    expect(card).toMatchObject({ account_type: "credit_card", balance: 410, interest_rate: 24.99, minimum_payment: 35, external_provider: "plaid", plaid_item_id: "it-1", external_mask: "0002", institution: "Plaid Bank", include_in_net_worth: true });
    expect(card.name).toBe("Plaid Bank credit card acct ••0002");
    expect(accounts.find((a) => a.external_account_id === "acc-401k-0003")).toMatchObject({ account_type: "retirement", balance: 12000 });
    expect(accounts.find((a) => a.external_account_id === "acc-chk-0001")).toMatchObject({ account_type: "checking", balance: 1500.5, available_balance: 1400 });
    expect(tables.financial_debts).toHaveLength(1);
    expect(tables.financial_debts[0]).toMatchObject({ account_id: card.id, actual_payment: 35, original_balance: 410 });
    expect(tables.financial_balance_snapshots).toHaveLength(3);

    const txs = tables.financial_transactions;
    expect(txs).toHaveLength(3);
    expect(txs.find((t) => t.external_id === "t1")).toMatchObject({ amount: -54.1, transaction_type: "expense", category_id: "cat-food", category_primary: "FOOD_AND_DRINK" });
    expect(txs.find((t) => t.external_id === "t2")).toMatchObject({ amount: 2500, transaction_type: "income", category_id: null });
    expect(txs.find((t) => t.external_id === "t3")).toMatchObject({ amount: -1200, transaction_type: "expense", category_id: "cat-housing", account_id: card.id });
    expect(tables.plaid_items[0]).toMatchObject({ status: "active", transactions_cursor: "c2", error_code: null });
    expect(tables.plaid_sync_runs[0]).toMatchObject({ status: "success", trigger: "link" });

    // Second sync: balance changes, user-edited fields survive, cursor resumes, removed transaction deleted.
    const chk = accounts.find((a) => a.external_account_id === "acc-chk-0001")!;
    chk.name = "My checking";
    chk.monthly_contribution = 200;
    plaid.accounts[0].balances.current = 1600;
    plaid.pages = [{ added: [], modified: [tx("t1", "acc-chk-0001", 60, "2026-09-02", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")], removed: [{ transaction_id: "t3" }], next_cursor: "c3", has_more: false }];
    plaid.syncCalls = [];
    const r2 = await runPlaidSync(fake, { ...item, transactions_cursor: "c2" }, { trigger: "scheduled" });
    expect(r2).toMatchObject({ accounts_created: 0, accounts_updated: 3, transactions_modified: 1, transactions_removed: 1, realtime: false });
    expect(plaid.accountCalls).toBe(1);
    expect(plaid.syncCalls).toEqual(["c2"]);
    expect(chk).toMatchObject({ name: "My checking", monthly_contribution: 200, balance: 1600 });
    expect(tables.financial_transactions.map((t) => t.external_id).sort()).toEqual(["t1", "t2"]);
    expect(tables.financial_transactions.find((t) => t.external_id === "t1")!.amount).toBe(-60);
    expect(tables.financial_accounts).toHaveLength(3);
  });

  it("marks the item for re-authentication when the bank needs a new login", async () => {
    plaid.failWith = { code: "ITEM_LOGIN_REQUIRED", message: "the login details of this item have changed" };
    await expect(runPlaidSync(fake, item, { trigger: "manual", realtime: true })).rejects.toThrow(/login details/);
    expect(tables.plaid_items[0]).toMatchObject({ status: "reauth_required", error_code: "ITEM_LOGIN_REQUIRED" });
    expect(tables.plaid_sync_runs[0]).toMatchObject({ status: "error" });
  });

  it("flags accounts the bank stopped reporting instead of deleting them", async () => {
    tables.financial_accounts.push({ id: "old", user_id: "u1", external_provider: "plaid", external_account_id: "acc-gone", plaid_item_id: "it-1", account_type: "savings", balance: 10 });
    plaid.accounts = [acct("acc-chk-0001", "depository", "checking", 100)];
    plaid.pages = [{ added: [], modified: [], removed: [], next_cursor: "c", has_more: false }];
    await runPlaidSync(fake, item, { trigger: "manual" });
    expect(tables.financial_accounts.find((a) => a.id === "old")).toMatchObject({ sync_error: "No longer reported by the bank" });
  });
});
