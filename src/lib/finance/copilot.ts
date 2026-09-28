/**
 * Financial Copilot — Phase 1 "calculator mode".
 * Each question is answered from the projection engine with the user's own numbers.
 * Answers always separate: what the model projects, the assumptions behind it, and general education.
 * Nothing here is a guarantee or personalized investment advice.
 */
import { runProjection, requiredContribution, monthsToPayoff, type ModelInputs } from "./engine";
import { fmtMoney, fmtMonths, fmtPct } from "./format";
import { formatDate } from "@/lib/dates";
import { isLiability } from "./types";

export type CopilotField = { key: string; label: string; kind: "money" | "months" | "pct" | "account_debt" | "goal"; default: number | string };
export interface CopilotAnswer {
  headline: string;
  projection: string[];
  assumptions: string[];
  education: string[];
}
export interface CopilotQuestion {
  id: string;
  title: string;
  prompt: string;
  fields: CopilotField[];
  answer: (inputs: ModelInputs, v: Record<string, number | string>) => CopilotAnswer;
}

const n = (v: number | string | undefined, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const s = (v: number | string | undefined) => (typeof v === "string" ? v : "");
const my = (d: string | null) => (d ? formatDate(d, "monthYear") : "beyond the horizon");

function baseAssumptions(inputs: ModelInputs): string[] {
  const p = inputs.profile;
  return [
    `Take-home income ${fmtMoney(p.monthlyIncome)}/mo growing ${fmtPct(p.incomeGrowthPct)} a year; expenses ${fmtMoney(p.fixedExpenses + p.variableExpenses)}/mo held flat.`,
    `Investments return ${fmtPct(p.investmentReturnPct)} a year, savings earn ${fmtPct(p.savingsApyPct)}; debts accrue interest monthly at their APR.`,
    `Extra debt money follows the ${p.debtStrategy} strategy; surplus lands in ${p.surplusDestination}. Taxes, inflation and market swings are not modeled.`,
  ];
}

export const COPILOT_QUESTIONS: CopilotQuestion[] = [
  {
    id: "rent",
    title: "Can I afford higher rent?",
    prompt: "What happens to my goals and cash if my housing cost goes up?",
    fields: [{ key: "delta", label: "Monthly increase", kind: "money", default: 400 }],
    answer: (inputs, v) => {
      const delta = n(v.delta, 400);
      const base = runProjection(inputs);
      const alt = runProjection({ ...inputs, changes: [...inputs.changes, { kind: "expense", label: "Rent", amountMonthly: delta, startMonth: 1 }] });
      const freeAfter = base.cashFlow.free - delta;
      const goalLines = alt.goals.filter((g) => g.targetDate).map((g) => {
        const b = base.goals.find((x) => x.id === g.id)!;
        return `${g.name}: ${my(b.projectedDate)} → ${my(g.projectedDate)}`;
      });
      return {
        headline: freeAfter < 0 ? `No: ${fmtMoney(delta)}/mo more puts you ${fmtMoney(-freeAfter)}/mo in the red` : freeAfter < base.cashFlow.contributions + base.cashFlow.goalContributions ? `Tight: it fits, but current contributions no longer do` : `Yes: ${fmtMoney(freeAfter)}/mo remains free after the increase`,
        projection: [
          `Free cash after expenses and debt minimums goes from ${fmtMoney(base.cashFlow.free)} to ${fmtMoney(freeAfter)} per month.`,
          `Net worth in 5 years: ${fmtMoney(base.points[Math.min(60, base.points.length - 1)].netWorth)} → ${fmtMoney(alt.points[Math.min(60, alt.points.length - 1)].netWorth)}.`,
          alt.firstShortfallMonth != null ? `Checking would go negative in ${formatDate(alt.points[alt.firstShortfallMonth].date, "monthYear")}.` : "Checking stays above zero across the horizon.",
          ...goalLines,
        ],
        assumptions: baseAssumptions(inputs),
        education: ["A common rule of thumb keeps total housing at or below about 30% of take-home pay, but the real test is whether goals and an emergency fund still fit.", "Rent increases compound with every renewal; model the next two years, not only the next lease."],
      };
    },
  },
  {
    id: "extra_debt",
    title: "What if I pay more toward debt?",
    prompt: "How much sooner am I debt-free and how much interest do I save?",
    fields: [{ key: "amount", label: "Extra per month", kind: "money", default: 200 }],
    answer: (inputs, v) => {
      const amount = n(v.amount, 200);
      const base = runProjection({ ...inputs, months: Math.max(inputs.months, 360) });
      const alt = runProjection({ ...inputs, months: Math.max(inputs.months, 360), profile: { ...inputs.profile, extraDebtPayment: inputs.profile.extraDebtPayment + amount } });
      if (!base.debts.some((d) => d.startBalance > 0)) return { headline: "You have no open debts to pay down", projection: [], assumptions: [], education: ["With no debt, the same monthly amount could go to an emergency fund or investments."] };
      return {
        headline: alt.debtFreeMonth != null ? `Debt-free ${base.debtFreeMonth != null ? `${fmtMonths(base.debtFreeMonth - alt.debtFreeMonth)} sooner` : `by ${my(alt.debtFreeDate)}`}, saving ${fmtMoney(Math.max(0, base.totalInterest - alt.totalInterest))} in interest` : "Even with the extra payment, debts do not clear within 30 years",
        projection: [
          `Debt-free date: ${my(base.debtFreeDate)} → ${my(alt.debtFreeDate)}.`,
          `Total interest: ${fmtMoney(base.totalInterest)} → ${fmtMoney(alt.totalInterest)}.`,
          ...alt.debts.filter((d) => d.startBalance > 0).map((d) => `${d.name}: paid off ${my(d.payoffDate)} (was ${my(base.debts.find((x) => x.accountId === d.accountId)?.payoffDate ?? null)}).`),
          `Free cash after the extra payment: ${fmtMoney(base.cashFlow.free - amount)}/mo.`,
        ],
        assumptions: [...baseAssumptions(inputs), `The extra ${fmtMoney(amount)}/mo starts next month and continues until every balance is zero; freed minimums roll into the next debt.`],
        education: ["Avalanche (highest APR first) minimizes interest; snowball (smallest balance first) gives quicker wins. Both beat minimums-only.", "Paying down a 20% APR balance is a guaranteed 20% return, which is hard to beat elsewhere."],
      };
    },
  },
  {
    id: "net_worth_when",
    title: "When will I reach a net worth target?",
    prompt: "Given my current plan, when does net worth cross a number?",
    fields: [{ key: "target", label: "Net worth target", kind: "money", default: 100000 }],
    answer: (inputs, v) => {
      const target = n(v.target, 100000);
      const p = runProjection({ ...inputs, months: 480 });
      const hit = p.points.find((pt) => pt.netWorth >= target);
      return {
        headline: hit ? `Projected to reach ${fmtMoney(target, { compact: true })} in ${formatDate(hit.date, "monthYear")} (${fmtMonths(hit.month)})` : `Not reached within 40 years at the current plan`,
        projection: [`Net worth today: ${fmtMoney(p.start.netWorth)}.`, `In 5 years: ${fmtMoney(p.points[60].netWorth)}; in 10 years: ${fmtMoney(p.points[120].netWorth)}.`, ...(hit ? [`At that point cash ${fmtMoney(hit.cash)}, investments ${fmtMoney(hit.investments + hit.retirement)}, debt ${fmtMoney(hit.debt)}.`] : [])],
        assumptions: baseAssumptions(inputs),
        education: ["Net worth is assets minus liabilities; paying down debt raises it just as much as saving does.", "Early years are driven by contributions; later years by compounding, which is why the curve bends upward."],
      };
    },
  },
  {
    id: "bonus",
    title: "What should I do with a bonus?",
    prompt: "Compare putting a lump sum toward debt, savings, or investments.",
    fields: [{ key: "amount", label: "Lump sum", kind: "money", default: 5000 }],
    answer: (inputs, v) => {
      const amount = n(v.amount, 5000);
      const months = Math.max(inputs.months, 120);
      const at = 60;
      const base = runProjection({ ...inputs, months });
      const savings = inputs.accounts.find((a) => a.type === "savings");
      const invest = inputs.accounts.find((a) => a.type === "brokerage") ?? inputs.accounts.find((a) => a.type === "retirement");
      const debt = [...inputs.accounts.filter((a) => isLiability(a.type) && a.balance > 0)].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
      const opts: { label: string; p: ReturnType<typeof runProjection> }[] = [];
      if (savings) opts.push({ label: `Savings (${savings.name})`, p: runProjection({ ...inputs, months, changes: [...inputs.changes, { kind: "one_time", label: "Bonus", amount, month: 1, fromAccountId: savings.id }] }) });
      if (invest) opts.push({ label: `Invest (${invest.name})`, p: runProjection({ ...inputs, months, changes: [...inputs.changes, { kind: "one_time", label: "Bonus", amount, month: 1, fromAccountId: invest.id }] }) });
      if (debt) opts.push({ label: `Pay down ${debt.name}`, p: runProjection({ ...inputs, months, changes: [...inputs.changes, { kind: "one_time", label: "Bonus", amount: -Math.min(amount, debt.balance), month: 1, fromAccountId: debt.id }, ...(amount > debt.balance ? [{ kind: "one_time" as const, label: "Remainder", amount: amount - debt.balance, month: 1 }] : [])] }) });
      if (!opts.length) opts.push({ label: "Checking", p: runProjection({ ...inputs, months, changes: [...inputs.changes, { kind: "one_time", label: "Bonus", amount, month: 1 }] }) });
      const ranked = [...opts].sort((a, b) => b.p.points[at].netWorth - a.p.points[at].netWorth);
      return {
        headline: `${ranked[0].label} projects the highest 5-year net worth (${fmtMoney(ranked[0].p.points[at].netWorth)})`,
        projection: opts.map((o) => `${o.label}: net worth in 5 years ${fmtMoney(o.p.points[at].netWorth)} (${fmtMoney(o.p.points[at].netWorth - base.points[at].netWorth, { sign: true })} vs no bonus)${o.p.debtFreeDate !== base.debtFreeDate ? `, debt-free ${my(o.p.debtFreeDate)}` : ""}.`),
        assumptions: [...baseAssumptions(inputs), "Comparison uses the 5-year net worth under each option; risk and liquidity are not scored."],
        education: ["If the emergency fund is short, most planners fill it before investing, because a cash cushion prevents new debt.", "Above roughly 7–8% APR, paying down debt usually beats expected market returns on a risk-adjusted basis."],
      };
    },
  },
  {
    id: "goal_monthly",
    title: "How much per month for a goal?",
    prompt: "What monthly contribution hits a goal by its target date?",
    fields: [{ key: "goal", label: "Goal", kind: "goal", default: "" }],
    answer: (inputs, v) => {
      const g = inputs.goals.find((x) => x.id === s(v.goal)) ?? inputs.goals.find((x) => x.status === "active" && x.targetDate);
      if (!g) return { headline: "Add a goal with a target date first", projection: [], assumptions: [], education: [] };
      const p = runProjection(inputs);
      const r = p.goals.find((x) => x.id === g.id)!;
      const months = r.targetMonth ?? 0;
      const linked = g.linkedAccountId ? inputs.accounts.find((a) => a.id === g.linkedAccountId) : undefined;
      const rate = linked ? (linked.rate ?? (linked.type === "savings" ? inputs.profile.savingsApyPct : linked.type === "brokerage" || linked.type === "retirement" ? inputs.profile.investmentReturnPct : 0)) : 0;
      const need = months > 0 ? requiredContribution(r.startAmount, r.targetAmount, months, rate) : Math.max(0, r.targetAmount - r.startAmount);
      return {
        headline: months > 0 ? `About ${fmtMoney(need)}/mo reaches ${g.name} by ${formatDate(g.targetDate!, "monthYear")}` : `${g.name} has no future target date`,
        projection: [`Progress ${fmtMoney(r.startAmount)} of ${fmtMoney(r.targetAmount)} with ${fmtMonths(months)} left.`, `Current plan: ${fmtMoney(g.monthlyContribution)}/mo → projected ${my(r.projectedDate)} (${r.status.replace("_", " ")}).`, need > g.monthlyContribution ? `Gap: ${fmtMoney(need - g.monthlyContribution)}/mo more than planned.` : `The current contribution already covers it.`],
        assumptions: [`Growth on the goal balance at ${fmtPct(rate)} a year, compounded monthly; contributions start next month.`, ...baseAssumptions(inputs).slice(0, 1)],
        education: ["Goals with dates are easier to fund: divide what is left by the months left, then adjust for growth.", "Automating the transfer on payday makes the number above the default rather than the leftover."],
      };
    },
  },
  {
    id: "raise",
    title: "What does a raise change?",
    prompt: "If take-home pay rises, how do goals and net worth move?",
    fields: [{ key: "delta", label: "Monthly take-home increase", kind: "money", default: 500 }],
    answer: (inputs, v) => {
      const delta = n(v.delta, 500);
      const base = runProjection(inputs);
      const alt = runProjection({ ...inputs, changes: [...inputs.changes, { kind: "income", label: "Raise", amountMonthly: delta, startMonth: 1 }] });
      const i = Math.min(120, base.points.length - 1);
      return {
        headline: `${fmtMoney(delta)}/mo more adds ${fmtMoney(alt.points[i].netWorth - base.points[i].netWorth)} to net worth over ${fmtMonths(i)} if it all goes to ${inputs.profile.surplusDestination}`,
        projection: [`Free cash: ${fmtMoney(base.cashFlow.free)} → ${fmtMoney(base.cashFlow.free + delta)} per month.`, `Net worth in ${fmtMonths(i)}: ${fmtMoney(base.points[i].netWorth)} → ${fmtMoney(alt.points[i].netWorth)}.`, ...(base.firstShortfallMonth != null && alt.firstShortfallMonth == null ? ["The raise removes the projected cash shortfall."] : [])],
        assumptions: [...baseAssumptions(inputs), "The raise is not assigned to any goal or debt here; use Goals or Scenarios to direct it."],
        education: ["Lifestyle inflation is the quiet risk: pre-commit a share of every raise to goals before it reaches checking."],
      };
    },
  },
  {
    id: "live_home",
    title: "How much would living at home save?",
    prompt: "Cut housing costs for a period and see where the savings land.",
    fields: [
      { key: "saved", label: "Housing saved per month", kind: "money", default: 1200 },
      { key: "duration", label: "Months", kind: "months", default: 12 },
    ],
    answer: (inputs, v) => {
      const saved = n(v.saved, 1200);
      const dur = n(v.duration, 12);
      const base = runProjection(inputs);
      const alt = runProjection({ ...inputs, changes: [...inputs.changes, { kind: "expense", label: "Live at home", amountMonthly: -saved, startMonth: 1, endMonth: dur }] });
      const i = Math.min(dur, base.points.length - 1);
      const j = Math.min(60, base.points.length - 1);
      return {
        headline: `${fmtMoney(saved * dur)} saved over ${fmtMonths(dur)}, worth ${fmtMoney(alt.points[j].netWorth - base.points[j].netWorth)} in net worth after 5 years`,
        projection: [`Net worth after ${fmtMonths(i)}: ${fmtMoney(base.points[i].netWorth)} → ${fmtMoney(alt.points[i].netWorth)}.`, alt.debtFreeDate !== base.debtFreeDate ? `Debt-free: ${my(base.debtFreeDate)} → ${my(alt.debtFreeDate)}.` : "Debt-free date does not change unless the savings are directed at debt.", ...alt.goals.filter((g) => g.projectedDate !== base.goals.find((b) => b.id === g.id)?.projectedDate).map((g) => `${g.name}: ${my(base.goals.find((b) => b.id === g.id)!.projectedDate)} → ${my(g.projectedDate)}.`)],
        assumptions: [...baseAssumptions(inputs), `Housing drops by ${fmtMoney(saved)}/mo for months 1–${dur}, then returns to today's level.`],
        education: ["Temporary low-cost periods are most powerful when the difference is auto-transferred, not left in checking."],
      };
    },
  },
  {
    id: "car",
    title: "Can I afford a car payment?",
    prompt: "Add a monthly payment and see whether goals still fit.",
    fields: [
      { key: "payment", label: "Monthly payment", kind: "money", default: 450 },
      { key: "term", label: "Term (months)", kind: "months", default: 60 },
      { key: "apr", label: "APR %", kind: "pct", default: 7 },
    ],
    answer: (inputs, v) => {
      const pay = n(v.payment, 450);
      const term = n(v.term, 60);
      const apr = n(v.apr, 7);
      const base = runProjection(inputs);
      const alt = runProjection({ ...inputs, changes: [...inputs.changes, { kind: "expense", label: "Car payment", amountMonthly: pay, startMonth: 1, endMonth: term }] });
      const r = apr / 100 / 12;
      const principal = r > 0 ? (pay * (1 - Math.pow(1 + r, -term))) / r : pay * term;
      const freeAfter = base.cashFlow.free - pay;
      const behind = alt.goals.filter((g) => (g.status === "slightly_behind" || g.status === "significantly_behind") && base.goals.find((b) => b.id === g.id)?.status !== g.status);
      return {
        headline: freeAfter < 0 ? `No: the payment exceeds free cash by ${fmtMoney(-freeAfter)}/mo` : behind.length ? `It fits, but ${behind.length} goal${behind.length === 1 ? "" : "s"} slip behind` : `Yes: ${fmtMoney(freeAfter)}/mo remains free with the payment`,
        projection: [`${fmtMoney(pay)}/mo for ${fmtMonths(term)} at ${fmtPct(apr)} finances about ${fmtMoney(principal)}; total paid ${fmtMoney(pay * term)} (${fmtMoney(pay * term - principal)} interest).`, `Net worth in 5 years: ${fmtMoney(base.points[Math.min(60, base.points.length - 1)].netWorth)} → ${fmtMoney(alt.points[Math.min(60, alt.points.length - 1)].netWorth)}.`, ...behind.map((g) => `${g.name}: ${my(base.goals.find((b) => b.id === g.id)!.projectedDate)} → ${my(g.projectedDate)}.`)],
        assumptions: [...baseAssumptions(inputs), "The car itself is not added as an asset; insurance, fuel and maintenance are not included in the payment."],
        education: ["Cars depreciate; a shorter term with a higher payment usually costs far less interest than a long one.", "Some planners cap all transportation costs near 10–15% of take-home pay."],
      };
    },
  },
  {
    id: "payoff_one",
    title: "When is one debt gone at a given payment?",
    prompt: "Closed-form payoff for a single balance.",
    fields: [
      { key: "account", label: "Debt", kind: "account_debt", default: "" },
      { key: "payment", label: "Monthly payment", kind: "money", default: 300 },
    ],
    answer: (inputs, v) => {
      const d = inputs.accounts.find((a) => a.id === s(v.account)) ?? inputs.accounts.find((a) => isLiability(a.type) && a.balance > 0);
      if (!d) return { headline: "No open debt to calculate", projection: [], assumptions: [], education: [] };
      const pay = n(v.payment, 300);
      const m = monthsToPayoff(d.balance, d.rate ?? 0, pay);
      const totalPaid = m != null ? pay * m : null;
      return {
        headline: m == null ? `${fmtMoney(pay)}/mo never clears ${d.name}: it does not cover the interest` : `${d.name} is gone in ${fmtMonths(m)} at ${fmtMoney(pay)}/mo`,
        projection: m == null ? [`Monthly interest alone is about ${fmtMoney((d.balance * (d.rate ?? 0)) / 100 / 12)}.`] : [`Balance ${fmtMoney(d.balance)} at ${fmtPct(d.rate ?? 0)} APR.`, `Total paid about ${fmtMoney(totalPaid!)}, of which ${fmtMoney(totalPaid! - d.balance)} is interest.`],
        assumptions: ["Fixed payment every month, interest compounding monthly, no new charges."],
        education: ["Doubling a payment usually more than halves the payoff time because less interest accrues each month."],
      };
    },
  },
];

export function questionById(id: string) {
  return COPILOT_QUESTIONS.find((q) => q.id === id) ?? null;
}
