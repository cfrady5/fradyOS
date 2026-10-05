/** Recurring money movements: cadence math, matching against transactions, totals. Client-safe, pure. */
import { addDays, addMonths, addYears, endOfMonth, parseDateOnly } from "@/lib/dates";
import type { FinancialAccount, RecurringCadence, RecurringItem, RecurringKind } from "./types";

export const CADENCES: { value: RecurringCadence; label: string; perYear: number; short: string }[] = [
  { value: "weekly", label: "Every week", perYear: 52, short: "wk" },
  { value: "biweekly", label: "Every 2 weeks", perYear: 26, short: "2 wks" },
  { value: "semimonthly", label: "Twice a month", perYear: 24, short: "2×/mo" },
  { value: "monthly", label: "Every month", perYear: 12, short: "mo" },
  { value: "quarterly", label: "Every 3 months", perYear: 4, short: "qtr" },
  { value: "yearly", label: "Every year", perYear: 1, short: "yr" },
];

export function cadenceMeta(c: RecurringCadence) {
  return CADENCES.find((x) => x.value === c) ?? CADENCES[3];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly equivalent of one item (amount × occurrences per year ÷ 12). */
export function monthlyAmount(item: Pick<RecurringItem, "amount" | "cadence">): number {
  return r2((item.amount * cadenceMeta(item.cadence).perYear) / 12);
}

/** The occurrence after `date` for this cadence. Twice-a-month alternates between day D and D+15 (clipped to month end). */
export function advance(date: string, cadence: RecurringCadence): string {
  switch (cadence) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "semimonthly": {
      const { d } = parseDateOnly(date);
      if (d <= 15) {
        const eom = endOfMonth(date);
        const target = `${date.slice(0, 8)}${String(d + 15).padStart(2, "0")}`;
        return target > eom ? eom : target;
      }
      const nextMonth = addMonths(`${date.slice(0, 8)}01`, 1);
      return `${nextMonth.slice(0, 8)}${String(d - 15).padStart(2, "0")}`;
    }
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "yearly":
      return addYears(date, 1);
  }
}

/** Next occurrence on or after `today` (rolls a stale next_date forward). Null when the item has no date. */
export function nextOccurrence(item: Pick<RecurringItem, "next_date" | "cadence">, today: string): string | null {
  if (!item.next_date) return null;
  let d = item.next_date;
  let guard = 0;
  while (d < today && guard++ < 400) d = advance(d, item.cadence);
  return d;
}

/** Occurrences within [today, today + days]. */
export function upcoming(items: RecurringItem[], today: string, days: number): { item: RecurringItem; date: string }[] {
  const until = addDays(today, days);
  const out: { item: RecurringItem; date: string }[] = [];
  for (const item of items) {
    if (!item.is_active) continue;
    let d = nextOccurrence(item, today);
    let guard = 0;
    while (d && d <= until && guard++ < 60) {
      out.push({ item, date: d });
      d = advance(d, item.cadence);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.item.name.localeCompare(b.item.name)));
}

export type RecurringTotals = {
  income: number;
  /** Everything that leaves: expenses + debt payments + savings + investing. */
  outgoing: number;
  byKind: Record<RecurringKind, number>;
  net: number;
  variableIncome: number;
  variableOutgoing: number;
};

export function totals(items: RecurringItem[]): RecurringTotals {
  const byKind: Record<RecurringKind, number> = { income: 0, expense: 0, debt: 0, savings: 0, investing: 0 };
  let variableIncome = 0;
  let variableOutgoing = 0;
  for (const it of items) {
    if (!it.is_active) continue;
    const m = monthlyAmount(it);
    byKind[it.kind] = r2(byKind[it.kind] + m);
    if (it.is_variable) {
      if (it.kind === "income") variableIncome = r2(variableIncome + m);
      else variableOutgoing = r2(variableOutgoing + m);
    }
  }
  const outgoing = r2(byKind.expense + byKind.debt + byKind.savings + byKind.investing);
  return { income: byKind.income, outgoing, byKind, net: r2(byKind.income - outgoing), variableIncome, variableOutgoing };
}

/**
 * What "Use in projection" writes to the profile: income = active income items marked in_projection;
 * fixed expenses = active expense items + debt payments whose account has no balance to model them
 * (so a loan with an unknown balance still costs its payment every month).
 */
export function projectionFigures(items: RecurringItem[], accounts: Pick<FinancialAccount, "id" | "balance" | "is_archived">[]): { income: number; fixed: number; unmodeledDebt: RecurringItem[] } {
  const balance = new Map(accounts.map((a) => [a.id, a.is_archived ? 0 : a.balance]));
  let income = 0;
  let fixed = 0;
  const unmodeledDebt: RecurringItem[] = [];
  for (const it of items) {
    if (!it.is_active || !it.in_projection) continue;
    const m = monthlyAmount(it);
    if (it.kind === "income") income = r2(income + m);
    else if (it.kind === "expense") fixed = r2(fixed + m);
    else if (it.kind === "debt") {
      const bal = it.account_id ? (balance.get(it.account_id) ?? 0) : 0;
      if (bal <= 0) {
        fixed = r2(fixed + m);
        unmodeledDebt.push(it);
      }
    }
  }
  return { income, fixed, unmodeledDebt };
}

function patterns(item: Pick<RecurringItem, "match_pattern">): string[] {
  return (item.match_pattern ?? "")
    .split("|")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/** The first active-or-not item whose pattern appears in the description (longest pattern wins). */
export function matchRecurring<T extends Pick<RecurringItem, "id" | "match_pattern">>(description: string | null | undefined, items: T[]): T | null {
  const hay = (description ?? "").toLowerCase();
  if (!hay) return null;
  let best: { item: T; len: number } | null = null;
  for (const item of items) {
    for (const p of patterns(item)) {
      if (hay.includes(p) && (!best || p.length > best.len)) best = { item, len: p.length };
    }
  }
  return best?.item ?? null;
}

export type Observation = { count: number; lastDate: string | null; lastAmount: number | null; average: number | null };

/** What the transactions say about each item: how often it was seen, when last, and the average absolute amount. */
export function observe(items: RecurringItem[], transactions: { description: string | null; merchant_name?: string | null; amount: number; transaction_date: string }[]): Record<string, Observation> {
  const out: Record<string, Observation> = {};
  const sums: Record<string, number> = {};
  for (const t of transactions) {
    const hit = matchRecurring(`${t.merchant_name ?? ""} ${t.description ?? ""}`, items);
    if (!hit) continue;
    const o = (out[hit.id] ??= { count: 0, lastDate: null, lastAmount: null, average: null });
    o.count++;
    sums[hit.id] = (sums[hit.id] ?? 0) + Math.abs(t.amount);
    if (!o.lastDate || t.transaction_date > o.lastDate) {
      o.lastDate = t.transaction_date;
      o.lastAmount = Math.abs(t.amount);
    }
  }
  for (const id of Object.keys(out)) out[id].average = r2(sums[id] / out[id].count);
  return out;
}

export function kindLabel(kind: RecurringKind): string {
  switch (kind) {
    case "income":
      return "Income";
    case "expense":
      return "Expense";
    case "debt":
      return "Debt payment";
    case "savings":
      return "Savings";
    case "investing":
      return "Investing";
  }
}
