/** Insights derived from the projection — every line here is computed, never templated from guesses. Client-safe. */
import { runProjection, type ModelInputs, type Projection } from "./engine";
import { fmtMoney, fmtMonths } from "./format";
import { formatDate } from "@/lib/dates";
import { GOAL_STATUS_META } from "./model";

export type Insight = { id: string; tone: "good" | "warning" | "serious" | "critical" | "neutral"; title: string; body: string; href?: string };

export function computeInsights(inputs: ModelInputs, base: Projection): Insight[] {
  const out: Insight[] = [];
  const cf = base.cashFlow;
  const prof = inputs.profile;

  if (prof.monthlyIncome <= 0) {
    out.push({ id: "no_income", tone: "neutral", title: "Add your monthly income to unlock projections", body: "Projections, goal status and scenarios all start from take-home pay and monthly expenses.", href: "/finances/budget" });
    return out;
  }

  // Cash flow
  if (cf.free < 0) out.push({ id: "negative_cf", tone: "critical", title: `Spending exceeds income by ${fmtMoney(-cf.free)} a month`, body: "Living expenses plus required debt payments are more than take-home pay. Cash is projected to shrink until something changes.", href: "/finances/budget" });
  else out.push({ id: "savings_rate", tone: cf.savingsRatePct >= 20 ? "good" : cf.savingsRatePct >= 10 ? "warning" : "serious", title: `You keep ${cf.savingsRatePct.toFixed(0)}% of take-home pay after expenses and debt minimums`, body: `${fmtMoney(cf.free)}/mo is free after ${fmtMoney(cf.expenses)} of expenses and ${fmtMoney(cf.debtPayments)} of required debt payments. ${cf.unallocated > 0 ? `${fmtMoney(cf.unallocated)} of it is not assigned to any goal or contribution yet.` : "All of it is already assigned."}` });

  if (base.firstShortfallMonth != null) {
    const p = base.points[base.firstShortfallMonth];
    out.push({ id: "shortfall", tone: "critical", title: `Checking goes negative in ${formatDate(p.date, "monthYear")}`, body: "At the current plan, planned contributions and payments outrun income. Lower contributions or expenses, or add income, to keep cash above zero.", href: "/finances/scenarios" });
  }

  // Emergency fund
  const ef = base.goals.find((g) => g.category === "emergency_fund");
  const covered = base.emergencyFundMonthsCovered;
  if (ef) {
    const meta = GOAL_STATUS_META[ef.status];
    out.push({ id: "ef_status", tone: meta.tone, title: `Emergency fund is ${meta.label.toLowerCase()}`, body: ef.projectedDate ? `Projected to reach ${fmtMoney(ef.targetAmount)} in ${formatDate(ef.projectedDate, "monthYear")}${ef.targetDate ? ` (target ${formatDate(ef.targetDate, "monthYear")})` : ""}. Savings currently cover ${covered.toFixed(1)} months of expenses.` : `Nothing is flowing toward it. Savings currently cover ${covered.toFixed(1)} months of expenses.`, href: "/finances/goals" });
  } else if (prof.emergencyFundMonths > 0) {
    out.push({ id: "ef_missing", tone: covered >= prof.emergencyFundMonths ? "good" : covered >= 1 ? "warning" : "serious", title: `Savings cover ${covered.toFixed(1)} months of expenses (target ${prof.emergencyFundMonths})`, body: covered >= prof.emergencyFundMonths ? "Your savings already meet the emergency fund target in Settings." : `Add an emergency fund goal to track the ${fmtMoney(base.emergencyFundTarget)} target.`, href: "/finances/goals" });
  }

  // Debt
  const openDebts = base.debts.filter((d) => d.startBalance > 0);
  if (openDebts.length) {
    if (base.debtFreeMonth != null) {
      out.push({ id: "debt_free", tone: "neutral", title: `Debt-free in ${fmtMonths(base.debtFreeMonth)} (${formatDate(base.debtFreeDate!, "monthYear")})`, body: `Total interest on the way: ${fmtMoney(base.totalInterest)} across ${openDebts.length} debt${openDebts.length === 1 ? "" : "s"}.`, href: "/finances/debt" });
    } else {
      out.push({ id: "debt_never", tone: "critical", title: "Debts are not paid off within the horizon", body: "Minimum payments are not enough to clear the balances. Add an extra monthly payment or check that every debt has a minimum recorded.", href: "/finances/debt" });
    }
    const plus = runProjection({ ...inputs, profile: { ...prof, extraDebtPayment: prof.extraDebtPayment + 300 } });
    if (plus.debtFreeMonth != null && (base.debtFreeMonth == null || plus.debtFreeMonth < base.debtFreeMonth)) {
      out.push({ id: "extra_300", tone: "good", title: `An extra $300/mo pays everything off ${base.debtFreeMonth != null ? `${fmtMonths(base.debtFreeMonth - plus.debtFreeMonth)} sooner` : `by ${formatDate(plus.debtFreeDate!, "monthYear")}`}`, body: `Interest saved: ${fmtMoney(Math.max(0, base.totalInterest - plus.totalInterest))}. Try it in Scenarios before committing.`, href: "/finances/scenarios" });
    }
    const highest = [...openDebts].sort((a, b) => b.rate - a.rate)[0];
    if (highest && highest.rate >= 15) out.push({ id: "high_apr", tone: "warning", title: `${highest.name} costs ${highest.rate.toFixed(1)}% APR`, body: `That is the most expensive balance you carry (${fmtMoney(highest.startBalance)}). Avalanche sends every extra dollar here first.`, href: "/finances/debt" });
    const noMin = openDebts.filter((d) => d.monthlyPayment <= 0);
    if (noMin.length) out.push({ id: "no_min", tone: "serious", title: `${noMin.length} debt${noMin.length === 1 ? " has" : "s have"} no monthly payment recorded`, body: `${noMin.map((d) => d.name).join(", ")}: the projection assumes nothing is paid, so interest just accrues. Add the minimum payment on the account.`, href: "/finances/accounts" });
  }

  // Goals
  const behind = base.goals.filter((g) => g.status === "slightly_behind" || g.status === "significantly_behind");
  for (const g of behind.slice(0, 3)) {
    const need = g.requiredMonthly != null ? Math.max(0, g.requiredMonthly - g.plannedMonthly) : null;
    out.push({ id: `goal_${g.id}`, tone: GOAL_STATUS_META[g.status].tone, title: `${g.name} is ${GOAL_STATUS_META[g.status].label.toLowerCase()}`, body: g.projectedDate ? `Projected ${formatDate(g.projectedDate, "monthYear")} vs target ${formatDate(g.targetDate!, "monthYear")}.${need != null && need > 0 ? ` About ${fmtMoney(need)}/mo more would put it on track.` : ""}` : `Not reached within ${fmtMonths(base.months)} at ${fmtMoney(g.plannedMonthly)}/mo.${g.requiredMonthly != null ? ` Roughly ${fmtMoney(g.requiredMonthly)}/mo is needed for ${formatDate(g.targetDate!, "monthYear")}.` : ""}`, href: "/finances/goals" });
  }
  const ahead = base.goals.filter((g) => g.status === "ahead");
  if (ahead.length) out.push({ id: "ahead", tone: "good", title: `${ahead.length} goal${ahead.length === 1 ? " is" : "s are"} ahead of schedule`, body: `${ahead.map((g) => `${g.name} (${formatDate(g.projectedDate!, "monthYear")})`).join(", ")}. You could redirect part of that contribution to a goal that is behind.`, href: "/finances/goals" });
  const stalled = base.goals.filter((g) => g.status === "stalled");
  if (stalled.length) out.push({ id: "stalled", tone: "serious", title: `${stalled.length} goal${stalled.length === 1 ? " has" : "s have"} no money flowing toward ${stalled.length === 1 ? "it" : "them"}`, body: `${stalled.map((g) => g.name).join(", ")}. Set a monthly contribution or link an account so the projection can date ${stalled.length === 1 ? "it" : "them"}.`, href: "/finances/goals" });

  // Net worth
  if (base.milestones.length) {
    const next = base.milestones[0];
    out.push({ id: "nw_milestone", tone: "neutral", title: `Net worth crosses ${fmtMoney(next.amount, { compact: true })} in ${formatDate(next.date, "monthYear")}`, body: `From ${fmtMoney(base.start.netWorth)} today to ${fmtMoney(base.end.netWorth)} in ${fmtMonths(base.months)}, under the assumptions in Settings.`, href: "/finances/timeline" });
  } else if (base.end.netWorth < base.start.netWorth) {
    out.push({ id: "nw_down", tone: "critical", title: `Net worth falls from ${fmtMoney(base.start.netWorth)} to ${fmtMoney(base.end.netWorth)}`, body: "Interest and spending outpace what is coming in. The Scenarios page can show which lever fixes it fastest.", href: "/finances/scenarios" });
  }

  // Investing
  const investing = inputs.accounts.filter((a) => a.type === "brokerage" || a.type === "retirement");
  if (investing.length && investing.every((a) => a.contribution <= 0) && cf.unallocated > 200 && base.debtFreeMonth === 0) {
    out.push({ id: "idle_cash", tone: "warning", title: `${fmtMoney(cf.unallocated)}/mo lands in ${prof.surplusDestination} with no investment contribution`, body: `With no debt to pay, a monthly contribution would compound at the ${prof.investmentReturnPct}% assumed return. This is a projection under your assumptions, not investment advice.`, href: "/finances/accounts" });
  }

  return out;
}
