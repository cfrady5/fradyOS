/** Pure mapping from Plaid shapes to FRADY OS finance rows. Client-safe (no secrets). */
import type { AccountType, TransactionType } from "@/lib/finance/types";

/** Plaid type/subtype → app account type. */
export function mapAccountType(type: string, subtype: string | null | undefined): AccountType {
  const t = type.toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  if (t === "depository") {
    if (s === "checking" || s === "paypal" || s === "prepaid" || s === "cash management" || s === "ebt") return "checking";
    return "savings"; // savings, money market, cd, hsa, gic…
  }
  if (t === "credit") return "credit_card";
  if (t === "loan") {
    if (s === "student") return "student_loan";
    if (s === "auto") return "auto_loan";
    return "other_loan"; // mortgage, home equity, line of credit, personal, business, consumer…
  }
  if (t === "investment" || t === "brokerage") {
    if (["401k", "401a", "403b", "457b", "ira", "roth", "roth 401k", "sep ira", "simple ira", "pension", "retirement", "sarsep", "profit sharing plan", "thrift savings plan", "keogh", "rrsp", "rrif", "lira", "lrsp", "lif", "prif", "tfsa", "fixed annuity", "variable annuity"].includes(s)) return "retirement";
    return "brokerage";
  }
  return "other_asset";
}

export function isPlaidLiability(type: string) {
  const t = type.toLowerCase();
  return t === "credit" || t === "loan";
}

/**
 * Balance in app terms. Assets: current value. Liabilities: amount owed, positive.
 * Plaid reports credit/loan `current` as a positive amount owed already.
 */
export function mapBalance(type: string, balances: { current: number | null; available: number | null }): number {
  const cur = balances.current ?? balances.available ?? 0;
  return isPlaidLiability(type) ? Math.abs(cur) : cur;
}

export function displayName(acc: { name: string; official_name: string | null; mask: string | null }, institution: string | null): string {
  const base = acc.name?.trim() || acc.official_name?.trim() || "Account";
  const withInst = institution && !base.toLowerCase().includes(institution.toLowerCase()) ? `${institution} ${base}` : base;
  return acc.mask ? `${withInst} ••${acc.mask}` : withInst;
}

/** Plaid amount is positive for money leaving the account; the app stores positive = money in. */
export function mapTransaction(t: { amount: number; personal_finance_category?: { primary: string; detailed: string } | null }, accountType: AccountType): { amount: number; transaction_type: TransactionType } {
  const amount = -t.amount;
  const primary = t.personal_finance_category?.primary ?? "";
  let transaction_type: TransactionType;
  if (primary === "INCOME") transaction_type = "income";
  else if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") transaction_type = accountType === "brokerage" || accountType === "retirement" ? (amount > 0 ? "contribution" : "transfer") : "transfer";
  else if (primary === "LOAN_PAYMENTS") transaction_type = "payment";
  else if (amount > 0 && (accountType === "credit_card" || accountType === "student_loan" || accountType === "auto_loan" || accountType === "other_loan")) transaction_type = "payment";
  else transaction_type = amount > 0 ? "income" : "expense";
  return { amount, transaction_type };
}

/** Longest-prefix match of a Plaid category (detailed, e.g. FOOD_AND_DRINK_GROCERIES) against budget mappings. */
export function matchBudgetCategory(categories: { id: string; plaid_categories: string[] }[], primary: string | null, detailed: string | null): string | null {
  const keys = [detailed, primary].filter((k): k is string => Boolean(k));
  let best: { id: string; len: number } | null = null;
  for (const c of categories) {
    for (const p of c.plaid_categories ?? []) {
      const P = p.toUpperCase();
      for (const k of keys) {
        if (k === P || k.startsWith(P + "_")) {
          if (!best || P.length > best.len) best = { id: c.id, len: P.length };
        }
      }
    }
  }
  return best?.id ?? null;
}

/** Categories that are neither income nor living expenses. */
export const NON_SPEND_PRIMARY = new Set(["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);
export const FIXED_PRIMARY = new Set(["RENT_AND_UTILITIES"]);

export type MonthCashFlow = { month: string; income: number; spending: number; fixed: number; variable: number; loanPayments: number; transfersOut: number; count: number };

/**
 * Monthly income / spending from transactions (any account). Income = INCOME category inflows;
 * spending = outflows that are not transfers or loan payments; fixed = rent & utilities.
 */
export function summarizeCashFlow(rows: { transaction_date: string; amount: number; transaction_type: TransactionType; category_primary: string | null; pending: boolean }[]): MonthCashFlow[] {
  const by = new Map<string, MonthCashFlow>();
  for (const r of rows) {
    if (r.pending) continue;
    const m = r.transaction_date.slice(0, 7);
    if (!by.has(m)) by.set(m, { month: `${m}-01`, income: 0, spending: 0, fixed: 0, variable: 0, loanPayments: 0, transfersOut: 0, count: 0 });
    const row = by.get(m)!;
    row.count++;
    const primary = r.category_primary ?? "";
    if (r.transaction_type === "income" || primary === "INCOME") {
      if (r.amount > 0) row.income += r.amount;
      continue;
    }
    if (r.amount >= 0) continue; // refunds / inflows outside income are ignored
    const out = -r.amount;
    if (primary === "LOAN_PAYMENTS" || r.transaction_type === "payment") {
      row.loanPayments += out;
      continue;
    }
    if (primary === "TRANSFER_OUT" || primary === "TRANSFER_IN" || r.transaction_type === "transfer" || r.transaction_type === "contribution") {
      row.transfersOut += out;
      continue;
    }
    row.spending += out;
    if (FIXED_PRIMARY.has(primary)) row.fixed += out;
    else row.variable += out;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return Array.from(by.values())
    .map((r) => ({ ...r, income: r2(r.income), spending: r2(r.spending), fixed: r2(r.fixed), variable: r2(r.variable), loanPayments: r2(r.loanPayments), transfersOut: r2(r.transfersOut) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function averageCashFlow(months: MonthCashFlow[]): { income: number; fixed: number; variable: number; spending: number; months: number } {
  if (!months.length) return { income: 0, fixed: 0, variable: 0, spending: 0, months: 0 };
  const n = months.length;
  const r2 = (x: number) => Math.round((x / n) * 100) / 100;
  return { income: r2(months.reduce((s, m) => s + m.income, 0)), fixed: r2(months.reduce((s, m) => s + m.fixed, 0)), variable: r2(months.reduce((s, m) => s + m.variable, 0)), spending: r2(months.reduce((s, m) => s + m.spending, 0)), months: n };
}

export function describePlaidError(code: string | null | undefined, message: string | null | undefined): string {
  switch (code) {
    case "ITEM_LOGIN_REQUIRED":
      return "The bank needs you to sign in again.";
    case "PENDING_EXPIRATION":
      return "The bank's consent is about to expire. Reconnect to keep syncing.";
    case "PENDING_DISCONNECT":
      return "The bank is about to disconnect this connection. Reconnect to keep syncing.";
    case "USER_PERMISSION_REVOKED":
      return "Access was revoked at the bank. Reconnect to resume.";
    case "PRODUCT_NOT_READY":
      return "Plaid is still preparing this connection. Try again in a minute.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
      return "The bank is not responding right now.";
    case "INVALID_API_KEYS":
      return "Plaid rejected the API keys. Check PLAID_CLIENT_ID / PLAID_SECRET and that PLAID_ENV matches the secret (sandbox vs production).";
    default:
      return message || code || "Unknown Plaid error";
  }
}
