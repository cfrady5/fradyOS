import { describe, it, expect } from "vitest";
import { advance, matchRecurring, monthlyAmount, nextOccurrence, observe, projectionFigures, totals, upcoming } from "../recurring";
import type { RecurringItem } from "../types";

function item(partial: Partial<RecurringItem> & Pick<RecurringItem, "id" | "kind" | "amount">): RecurringItem {
  return {
    user_id: "u",
    name: partial.id,
    cadence: "monthly",
    next_date: null,
    account_id: null,
    category_id: null,
    match_pattern: null,
    is_variable: false,
    in_projection: true,
    is_active: true,
    notes: null,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("monthlyAmount", () => {
  it("converts each cadence to a monthly equivalent", () => {
    expect(monthlyAmount({ amount: 100, cadence: "monthly" })).toBe(100);
    expect(monthlyAmount({ amount: 1977.95, cadence: "semimonthly" })).toBe(3955.9);
    expect(monthlyAmount({ amount: 1000, cadence: "biweekly" })).toBe(2166.67);
    expect(monthlyAmount({ amount: 120, cadence: "yearly" })).toBe(10);
    expect(monthlyAmount({ amount: 300, cadence: "quarterly" })).toBe(100);
    expect(monthlyAmount({ amount: 10, cadence: "weekly" })).toBe(43.33);
  });
});

describe("advance / nextOccurrence", () => {
  it("steps by cadence", () => {
    expect(advance("2026-10-05", "weekly")).toBe("2026-10-12");
    expect(advance("2026-10-05", "biweekly")).toBe("2026-10-19");
    expect(advance("2026-10-05", "monthly")).toBe("2026-11-05");
    expect(advance("2026-10-05", "quarterly")).toBe("2027-01-05");
    expect(advance("2026-10-05", "yearly")).toBe("2027-10-05");
  });
  it("alternates twice-a-month between D and D+15, clipping to month end", () => {
    expect(advance("2026-10-12", "semimonthly")).toBe("2026-10-27");
    expect(advance("2026-10-27", "semimonthly")).toBe("2026-11-12");
    expect(advance("2026-02-14", "semimonthly")).toBe("2026-02-28");
    expect(advance("2026-02-28", "semimonthly")).toBe("2026-03-13");
  });
  it("rolls a stale next date forward to today or later", () => {
    expect(nextOccurrence({ next_date: "2026-09-08", cadence: "monthly" }, "2026-10-05")).toBe("2026-10-08");
    expect(nextOccurrence({ next_date: "2026-10-05", cadence: "monthly" }, "2026-10-05")).toBe("2026-10-05");
    expect(nextOccurrence({ next_date: null, cadence: "monthly" }, "2026-10-05")).toBeNull();
  });
  it("lists upcoming occurrences in date order, skipping inactive items", () => {
    const items = [
      item({ id: "rent", kind: "expense", amount: 1200, next_date: "2026-10-01" }),
      item({ id: "pay", kind: "income", amount: 1000, cadence: "biweekly", next_date: "2026-10-09" }),
      item({ id: "old", kind: "expense", amount: 5, next_date: "2026-10-02", is_active: false }),
    ];
    const list = upcoming(items, "2026-10-05", 30);
    expect(list.map((x) => `${x.date}:${x.item.id}`)).toEqual(["2026-10-09:pay", "2026-10-23:pay", "2026-11-01:rent"]);
  });
});

describe("totals / projectionFigures", () => {
  const items = [
    item({ id: "pay", kind: "income", amount: 1977.95, cadence: "semimonthly" }),
    item({ id: "sales", kind: "income", amount: 5000, is_variable: true, in_projection: false }),
    item({ id: "claude", kind: "expense", amount: 100 }),
    item({ id: "earnest", kind: "debt", amount: 1719.48, account_id: "loan" }),
    item({ id: "doe", kind: "debt", amount: 251.34, account_id: "fed" }),
    item({ id: "save", kind: "savings", amount: 200, is_active: false }),
  ];
  it("sums monthly equivalents by kind for active items", () => {
    const t = totals(items);
    expect(t.income).toBe(8955.9);
    expect(t.byKind.debt).toBe(1970.82);
    expect(t.byKind.savings).toBe(0);
    expect(t.outgoing).toBe(2070.82);
    expect(t.net).toBe(6885.08);
    expect(t.variableIncome).toBe(5000);
  });
  it("counts only in-projection income and adds debt payments the accounts cannot model", () => {
    const f = projectionFigures(items, [
      { id: "loan", balance: 140697.65, is_archived: false },
      { id: "fed", balance: 0, is_archived: false },
    ]);
    expect(f.income).toBe(3955.9);
    expect(f.fixed).toBe(351.34);
    expect(f.unmodeledDebt.map((i) => i.id)).toEqual(["doe"]);
  });
});

describe("matchRecurring / observe", () => {
  const items = [
    item({ id: "earnest", kind: "debt", amount: 1719.48, match_pattern: "earnest" }),
    item({ id: "pay", kind: "income", amount: 1977.95, match_pattern: "resourcing edge | RESOURCINGEDGE" }),
    item({ id: "venmo", kind: "expense", amount: 10, match_pattern: "venmo" }),
    item({ id: "venmo-cashout", kind: "income", amount: 10, match_pattern: "venmo type: cashout" }),
  ];
  it("matches case-insensitively, longest pattern wins, and alternatives split on |", () => {
    expect(matchRecurring("Withdrawal EARNEST MO TYPE: AUTOPAY", items)?.id).toBe("earnest");
    expect(matchRecurring("Deposit RESOURCING EDGE TYPE: PAYROLL", items)?.id).toBe("pay");
    expect(matchRecurring("deposit resourcingedge", items)?.id).toBe("pay");
    expect(matchRecurring("Deposit VENMO TYPE: CASHOUT CO: VENMO", items)?.id).toBe("venmo-cashout");
    expect(matchRecurring("Withdrawal VENMO TYPE: PURCHASE", items)?.id).toBe("venmo");
    expect(matchRecurring("Kroger", items)).toBeNull();
    expect(matchRecurring(null, items)).toBeNull();
  });
  it("summarises occurrences per item", () => {
    const obs = observe(items, [
      { description: "Withdrawal EARNEST MO", amount: -1719.48, transaction_date: "2026-09-08" },
      { description: "Withdrawal EARNEST MO", amount: -1719.48, transaction_date: "2026-10-05" },
      { description: "Deposit RESOURCING EDGE", amount: 1977.94, transaction_date: "2026-09-29" },
      { description: "Deposit RESOURCING EDGE", amount: 1977.96, transaction_date: "2026-09-12" },
      { description: "Kroger", amount: -20, transaction_date: "2026-09-12" },
    ]);
    expect(obs.earnest).toEqual({ count: 2, lastDate: "2026-10-05", lastAmount: 1719.48, average: 1719.48 });
    expect(obs.pay).toEqual({ count: 2, lastDate: "2026-09-29", lastAmount: 1977.94, average: 1977.95 });
    expect(obs.venmo).toBeUndefined();
  });
});
