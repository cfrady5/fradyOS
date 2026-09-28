/** Scenario presets: each produces typed changes from a few user-editable numbers. Client-safe. */
import type { ScenarioChange } from "./types";

export type PresetField = { key: string; label: string; kind: "money" | "months" | "pct" | "account_debt" | "account_asset"; default: number | string; hint?: string };

export interface ScenarioPreset {
  id: string;
  group: "Housing" | "Career" | "Education" | "Debt" | "Investing" | "Life";
  name: string;
  description: string;
  fields: PresetField[];
  build: (v: Record<string, number | string>) => ScenarioChange[];
}

const n = (v: number | string | undefined, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const s = (v: number | string | undefined) => (typeof v === "string" ? v : "");

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "rent_change",
    group: "Housing",
    name: "Rent changes",
    description: "Move to a place with different rent (or utilities) starting in a given month.",
    fields: [
      { key: "delta", label: "Monthly change", kind: "money", default: 400, hint: "Positive = more expensive" },
      { key: "start", label: "Starts in (months)", kind: "months", default: 3 },
    ],
    build: (v) => [{ kind: "expense", label: `Rent change ${n(v.delta) >= 0 ? "+" : ""}$${n(v.delta)}/mo`, amountMonthly: n(v.delta), startMonth: n(v.start, 1) }],
  },
  {
    id: "live_at_home",
    group: "Housing",
    name: "Live at home for a while",
    description: "Cut housing costs for a stretch of months, then resume.",
    fields: [
      { key: "saved", label: "Monthly housing saved", kind: "money", default: 1200 },
      { key: "start", label: "Starts in (months)", kind: "months", default: 1 },
      { key: "duration", label: "For how many months", kind: "months", default: 12 },
    ],
    build: (v) => [{ kind: "expense", label: `Live at home (−$${n(v.saved)}/mo)`, amountMonthly: -n(v.saved), startMonth: n(v.start, 1), endMonth: n(v.start, 1) + n(v.duration, 12) - 1 }],
  },
  {
    id: "buy_home",
    group: "Housing",
    name: "Buy a home",
    description: "Down payment out of savings, then a mortgage payment replaces rent.",
    fields: [
      { key: "down", label: "Down payment + closing", kind: "money", default: 30000 },
      { key: "month", label: "Purchase in (months)", kind: "months", default: 24 },
      { key: "delta", label: "Monthly housing change", kind: "money", default: 300, hint: "Mortgage + taxes + insurance minus current rent" },
      { key: "from", label: "Pay down payment from", kind: "account_asset", default: "" },
    ],
    build: (v) => [
      { kind: "one_time", label: `Down payment $${n(v.down)}`, amount: -n(v.down), month: n(v.month, 1), fromAccountId: s(v.from) || null },
      { kind: "expense", label: `Housing change ${n(v.delta) >= 0 ? "+" : ""}$${n(v.delta)}/mo`, amountMonthly: n(v.delta), startMonth: n(v.month, 1) + 1 },
    ],
  },
  {
    id: "raise",
    group: "Career",
    name: "Raise or new job",
    description: "Take-home pay changes by a monthly amount from a given month.",
    fields: [
      { key: "delta", label: "Monthly take-home change", kind: "money", default: 800 },
      { key: "start", label: "Starts in (months)", kind: "months", default: 6 },
    ],
    build: (v) => [{ kind: "income", label: `Income ${n(v.delta) >= 0 ? "+" : ""}$${n(v.delta)}/mo`, amountMonthly: n(v.delta), startMonth: n(v.start, 1) }],
  },
  {
    id: "side_income",
    group: "Career",
    name: "Side income",
    description: "Extra monthly income for a limited window.",
    fields: [
      { key: "amount", label: "Monthly amount", kind: "money", default: 500 },
      { key: "start", label: "Starts in (months)", kind: "months", default: 1 },
      { key: "duration", label: "For how many months", kind: "months", default: 24 },
    ],
    build: (v) => [{ kind: "income", label: `Side income $${n(v.amount)}/mo`, amountMonthly: n(v.amount), startMonth: n(v.start, 1), endMonth: n(v.start, 1) + n(v.duration, 12) - 1 }],
  },
  {
    id: "income_gap",
    group: "Career",
    name: "Gap between jobs",
    description: "Income stops for a number of months, then resumes.",
    fields: [
      { key: "start", label: "Starts in (months)", kind: "months", default: 6 },
      { key: "duration", label: "Months without income", kind: "months", default: 3 },
      { key: "income", label: "Monthly income lost", kind: "money", default: 4000 },
    ],
    build: (v) => [{ kind: "income", label: `No income for ${n(v.duration, 3)} months`, amountMonthly: -n(v.income), startMonth: n(v.start, 1), endMonth: n(v.start, 1) + n(v.duration, 3) - 1 }],
  },
  {
    id: "grad_school",
    group: "Education",
    name: "Graduate school",
    description: "Tuition paid over a period, optionally with reduced income while studying.",
    fields: [
      { key: "tuition", label: "Tuition per month", kind: "money", default: 2500, hint: "Total cost ÷ months of study" },
      { key: "start", label: "Starts in (months)", kind: "months", default: 12 },
      { key: "duration", label: "Months of study", kind: "months", default: 24 },
      { key: "incomeLoss", label: "Monthly income lost while studying", kind: "money", default: 0 },
      { key: "after", label: "Monthly income gain after", kind: "money", default: 1500 },
    ],
    build: (v) => {
      const start = n(v.start, 1);
      const end = start + n(v.duration, 24) - 1;
      const out: ScenarioChange[] = [{ kind: "expense", label: `Tuition $${n(v.tuition)}/mo`, amountMonthly: n(v.tuition), startMonth: start, endMonth: end }];
      if (n(v.incomeLoss) > 0) out.push({ kind: "income", label: `Reduced income while studying`, amountMonthly: -n(v.incomeLoss), startMonth: start, endMonth: end });
      if (n(v.after) !== 0) out.push({ kind: "income", label: `Income after degree +$${n(v.after)}/mo`, amountMonthly: n(v.after), startMonth: end + 1 });
      return out;
    },
  },
  {
    id: "extra_debt",
    group: "Debt",
    name: "Pay extra on debt",
    description: "Add a monthly amount toward debt, allocated by your payoff strategy.",
    fields: [
      { key: "amount", label: "Extra per month", kind: "money", default: 300 },
      { key: "start", label: "Starts in (months)", kind: "months", default: 1 },
      { key: "account", label: "Target a specific debt (optional)", kind: "account_debt", default: "" },
    ],
    build: (v) => [{ kind: "debt_extra", label: `Extra debt payment $${n(v.amount)}/mo`, amountMonthly: n(v.amount), startMonth: n(v.start, 1), accountId: s(v.account) || null }],
  },
  {
    id: "payoff_lump",
    group: "Debt",
    name: "Pay off a debt with savings",
    description: "Clear one balance in a given month using savings, then checking.",
    fields: [
      { key: "account", label: "Debt to pay off", kind: "account_debt", default: "" },
      { key: "month", label: "In (months)", kind: "months", default: 1 },
    ],
    build: (v) => (s(v.account) ? [{ kind: "payoff_now", label: "Pay off debt from savings", accountId: s(v.account), month: n(v.month, 1) }] : []),
  },
  {
    id: "invest_more",
    group: "Investing",
    name: "Invest more each month",
    description: "Add a recurring contribution to an investment account.",
    fields: [
      { key: "account", label: "Investment account", kind: "account_asset", default: "" },
      { key: "amount", label: "Monthly contribution", kind: "money", default: 300 },
      { key: "start", label: "Starts in (months)", kind: "months", default: 1 },
    ],
    build: (v) => (s(v.account) ? [{ kind: "contribution", label: `Invest $${n(v.amount)}/mo`, accountId: s(v.account), amountMonthly: n(v.amount), startMonth: n(v.start, 1) }] : []),
  },
  {
    id: "return_rate",
    group: "Investing",
    name: "Different market return",
    description: "Test a more conservative or aggressive annual return on investments.",
    fields: [{ key: "pct", label: "Annual return %", kind: "pct", default: 5 }],
    build: (v) => [{ kind: "return_rate", label: `${n(v.pct, 5)}% annual return`, investmentReturnPct: n(v.pct, 5) }],
  },
  {
    id: "windfall",
    group: "Life",
    name: "Bonus or windfall",
    description: "A one-time amount lands in an account.",
    fields: [
      { key: "amount", label: "Amount", kind: "money", default: 5000 },
      { key: "month", label: "In (months)", kind: "months", default: 2 },
      { key: "account", label: "Deposit into", kind: "account_asset", default: "" },
    ],
    build: (v) => [{ kind: "one_time", label: `Windfall $${n(v.amount)}`, amount: n(v.amount), month: n(v.month, 1), fromAccountId: s(v.account) || null }],
  },
  {
    id: "big_purchase",
    group: "Life",
    name: "Big purchase or trip",
    description: "A one-time expense paid from an account.",
    fields: [
      { key: "amount", label: "Cost", kind: "money", default: 3000 },
      { key: "month", label: "In (months)", kind: "months", default: 6 },
      { key: "account", label: "Pay from", kind: "account_asset", default: "" },
    ],
    build: (v) => [{ kind: "one_time", label: `Purchase $${n(v.amount)}`, amount: -n(v.amount), month: n(v.month, 1), fromAccountId: s(v.account) || null }],
  },
  {
    id: "car",
    group: "Life",
    name: "Buy a car",
    description: "Down payment now, then a monthly payment for the loan term.",
    fields: [
      { key: "down", label: "Down payment", kind: "money", default: 3000 },
      { key: "payment", label: "Monthly payment", kind: "money", default: 450 },
      { key: "term", label: "Loan term (months)", kind: "months", default: 60 },
      { key: "month", label: "Purchase in (months)", kind: "months", default: 3 },
    ],
    build: (v) => [
      { kind: "one_time", label: `Car down payment $${n(v.down)}`, amount: -n(v.down), month: n(v.month, 1) },
      { kind: "expense", label: `Car payment $${n(v.payment)}/mo`, amountMonthly: n(v.payment), startMonth: n(v.month, 1) + 1, endMonth: n(v.month, 1) + n(v.term, 60) },
    ],
  },
];

export function presetById(id: string) {
  return SCENARIO_PRESETS.find((p) => p.id === id) ?? null;
}

export function describeChange(c: ScenarioChange): string {
  const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const window = (start: number, end?: number | null) => (end != null ? `months ${start}–${end}` : `from month ${start}`);
  switch (c.kind) {
    case "income":
      return `Income ${money(c.amountMonthly)}/mo ${window(c.startMonth, c.endMonth)}`;
    case "expense":
      return `Expenses ${money(c.amountMonthly)}/mo ${window(c.startMonth, c.endMonth)}`;
    case "one_time":
      return `${c.amount >= 0 ? "Deposit" : "Spend"} ${money(Math.abs(c.amount))} in month ${c.month}`;
    case "debt_extra":
      return `Extra debt payment ${money(c.amountMonthly)}/mo ${window(c.startMonth, c.endMonth)}`;
    case "payoff_now":
      return `Pay off a debt from savings in month ${c.month}`;
    case "contribution":
      return `Contribute ${money(c.amountMonthly)}/mo ${window(c.startMonth, c.endMonth)}`;
    case "return_rate":
      return `Investment return ${c.investmentReturnPct}%/yr`;
    case "income_growth":
      return `Income growth ${c.pct}%/yr`;
  }
}
