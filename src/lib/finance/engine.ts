/**
 * Financial projection engine — pure functions, no I/O.
 *
 * The model is a month-by-month simulation of the user's accounts:
 *   income (with yearly growth) − living expenses − debt payments − planned contributions = surplus
 * Surplus flows to the chosen destination account; assets grow at their rate; debts accrue
 * interest and are paid down by minimums plus an extra amount allocated by strategy.
 * Scenario changes are typed deltas applied by month offset on top of the same model, so a
 * scenario and the baseline are always comparable.
 *
 * Every number here is a projection under stated assumptions, not a forecast.
 */
import { addMonths, parseDateOnly } from "@/lib/dates";
import {
  isLiability,
  type AccountType,
  type DebtStrategy,
  type GoalCategory,
  type GoalStatus,
  type ScenarioChange,
  type SurplusDestination,
} from "./types";

export interface ModelProfile {
  monthlyIncome: number;
  incomeGrowthPct: number;
  fixedExpenses: number;
  variableExpenses: number;
  investmentReturnPct: number;
  savingsApyPct: number;
  emergencyFundMonths: number;
  surplusDestination: SurplusDestination;
  debtStrategy: DebtStrategy;
  extraDebtPayment: number;
}

export interface ModelAccount {
  id: string;
  name: string;
  type: AccountType;
  /** Assets: value. Liabilities: amount owed (positive). */
  balance: number;
  /** Annual %: APR for liabilities, APY / expected growth for assets. Null = default for the type. */
  rate: number | null;
  minimumPayment: number | null;
  /** What is actually paid each month on a liability (>= minimum when set). */
  actualPayment: number;
  /** Planned monthly deposit into an asset. */
  contribution: number;
  includeInNetWorth: boolean;
  customOrder: number;
}

export interface ModelGoal {
  id: string;
  name: string;
  category: GoalCategory;
  targetAmount: number;
  currentAmount: number;
  linkedAccountId: string | null;
  targetDate: string | null;
  priority: number;
  monthlyContribution: number;
  status: GoalStatus;
}

export interface ModelInputs {
  today: string;
  /** Horizon in months (1..600). */
  months: number;
  profile: ModelProfile;
  accounts: ModelAccount[];
  goals: ModelGoal[];
  changes: ScenarioChange[];
}

export interface MonthPoint {
  month: number;
  date: string;
  netWorth: number;
  assets: number;
  checking: number;
  savings: number;
  /** checking + savings + earmarked goal cash */
  cash: number;
  investments: number;
  retirement: number;
  otherAssets: number;
  earmarked: number;
  debt: number;
  income: number;
  expenses: number;
  debtPayments: number;
  contributions: number;
  surplus: number;
}

export type GoalStatusKey = "completed" | "ahead" | "on_track" | "slightly_behind" | "significantly_behind" | "projected" | "stalled";

export interface GoalResult {
  id: string;
  name: string;
  category: GoalCategory;
  targetAmount: number;
  startAmount: number;
  endAmount: number;
  progressPct: number;
  targetDate: string | null;
  targetMonth: number | null;
  projectedMonth: number | null;
  projectedDate: string | null;
  /** projected − target, in months (negative = early). Null when either is unknown. */
  monthsDiff: number | null;
  status: GoalStatusKey;
  plannedMonthly: number;
  /** Straight-line monthly amount needed to hit the target by the target date (no growth). */
  requiredMonthly: number | null;
}

export interface DebtResult {
  accountId: string;
  name: string;
  type: AccountType;
  rate: number;
  startBalance: number;
  endBalance: number;
  monthlyPayment: number;
  payoffMonth: number | null;
  payoffDate: string | null;
  totalInterest: number;
  totalPaid: number;
}

export interface CashFlow {
  income: number;
  expenses: number;
  debtPayments: number;
  extraDebt: number;
  contributions: number;
  goalContributions: number;
  /** income − expenses − required debt payments */
  free: number;
  /** free − extra debt − contributions − goal contributions (what lands in the surplus destination) */
  unallocated: number;
  savingsRatePct: number;
}

export interface NetWorthMilestone {
  amount: number;
  month: number;
  date: string;
}

export interface Projection {
  today: string;
  months: number;
  points: MonthPoint[];
  goals: GoalResult[];
  debts: DebtResult[];
  debtFreeMonth: number | null;
  debtFreeDate: string | null;
  totalInterest: number;
  milestones: NetWorthMilestone[];
  shortfallMonths: number[];
  firstShortfallMonth: number | null;
  cashFlow: CashFlow;
  emergencyFundTarget: number;
  emergencyFundMonthsCovered: number;
  start: MonthPoint;
  end: MonthPoint;
}

export const NET_WORTH_THRESHOLDS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000];
export const MAX_MONTHS = 600;

const CASH_ID = "__cash";

/** Whole months from `today` to `date` (day-of-month aware, floored). */
export function monthIndexOf(today: string, date: string): number {
  const a = parseDateOnly(today);
  const b = parseDateOnly(date);
  let diff = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) diff -= 1;
  return diff;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Minimum payment used when the account has none recorded. Credit cards: 2% or $25; loans: 0. */
export function effectiveMinimum(acc: ModelAccount): number {
  if (!isLiability(acc.type)) return 0;
  if (acc.minimumPayment != null && acc.minimumPayment > 0) return acc.minimumPayment;
  if (acc.type === "credit_card" && acc.balance > 0) return Math.max(25, round2(acc.balance * 0.02));
  return 0;
}

export function effectivePayment(acc: ModelAccount): number {
  return Math.max(effectiveMinimum(acc), acc.actualPayment || 0);
}

function defaultRate(acc: ModelAccount, profile: ModelProfile, returnOverride: number | null): number {
  if (acc.rate != null) return acc.rate;
  switch (acc.type) {
    case "savings":
      return profile.savingsApyPct;
    case "brokerage":
    case "retirement":
      return returnOverride ?? profile.investmentReturnPct;
    default:
      return 0;
  }
}

function orderForStrategy(accs: ModelAccount[], strategy: DebtStrategy, rateOf: (a: ModelAccount) => number, balOf: (a: ModelAccount) => number): ModelAccount[] {
  const list = [...accs];
  switch (strategy) {
    case "snowball":
      return list.sort((a, b) => balOf(a) - balOf(b) || rateOf(b) - rateOf(a));
    case "custom":
      return list.sort((a, b) => a.customOrder - b.customOrder || rateOf(b) - rateOf(a));
    case "avalanche":
    case "minimum":
    default:
      return list.sort((a, b) => rateOf(b) - rateOf(a) || balOf(a) - balOf(b));
  }
}

function active(change: { startMonth: number; endMonth?: number | null }, month: number) {
  return month >= change.startMonth && (change.endMonth == null || month <= change.endMonth);
}

/** Emergency fund target from the profile: months × (living expenses + required debt payments). */
export function emergencyFundTarget(profile: ModelProfile, accounts: ModelAccount[]): number {
  const monthly = profile.fixedExpenses + profile.variableExpenses + accounts.filter((a) => isLiability(a.type) && a.balance > 0).reduce((s, a) => s + effectivePayment(a), 0);
  return round2(monthly * profile.emergencyFundMonths);
}

export function runProjection(raw: ModelInputs): Projection {
  const months = Math.max(1, Math.min(MAX_MONTHS, Math.floor(raw.months)));
  const profile = raw.profile;
  const changes = raw.changes ?? [];

  // Ensure there is somewhere for cash to land.
  const accounts: ModelAccount[] = raw.accounts.map((a) => ({ ...a }));
  if (!accounts.some((a) => a.type === "checking")) {
    accounts.push({ id: CASH_ID, name: "Cash", type: "checking", balance: 0, rate: 0, minimumPayment: null, actualPayment: 0, contribution: 0, includeInNetWorth: true, customOrder: 0 });
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const bal = new Map(accounts.map((a) => [a.id, a.balance]));
  const liabilities = accounts.filter((a) => isLiability(a.type));
  const assets = accounts.filter((a) => !isLiability(a.type));

  const returnOverride = changes.reduce<number | null>((v, c) => (c.kind === "return_rate" ? c.investmentReturnPct : v), null);
  const growthOverride = changes.reduce<number | null>((v, c) => (c.kind === "income_growth" ? c.pct : v), null);
  const rateOf = (a: ModelAccount) => defaultRate(a, profile, returnOverride);
  const balOf = (a: ModelAccount) => bal.get(a.id) ?? 0;

  const basePayment = new Map(liabilities.map((a) => [a.id, effectivePayment(a)]));
  const interestAcc = new Map(liabilities.map((a) => [a.id, 0]));
  const paidAcc = new Map(liabilities.map((a) => [a.id, 0]));
  const payoffMonth = new Map<string, number>();
  for (const a of liabilities) if (a.balance <= 0) payoffMonth.set(a.id, 0);

  const efTarget = emergencyFundTarget(profile, accounts);
  const goals = raw.goals
    .filter((g) => g.status === "active" || g.status === "completed" || g.status === "paused")
    .map((g) => ({
      ...g,
      targetAmount: g.targetAmount > 0 ? g.targetAmount : g.category === "emergency_fund" ? efTarget : g.linkedAccountId && byId.get(g.linkedAccountId) && isLiability(byId.get(g.linkedAccountId)!.type) ? byId.get(g.linkedAccountId)!.balance : g.category === "debt_payoff" ? liabilities.reduce((s, a) => s + a.balance, 0) : 0,
    }));
  const earmark = new Map(goals.map((g) => [g.id, g.linkedAccountId || g.category === "net_worth" || g.category === "retirement" || g.category === "debt_payoff" ? 0 : g.currentAmount]));
  const goalDone = new Map<string, number>();
  const startDebt = liabilities.reduce((s, a) => s + Math.max(0, a.balance), 0);

  const firstOf = (type: AccountType) => assets.find((a) => a.type === type);
  const destinationAccount = (): ModelAccount => {
    const want = profile.surplusDestination === "investing" ? "brokerage" : profile.surplusDestination;
    return firstOf(want) ?? firstOf("checking")!;
  };
  const checkingAccount = () => firstOf("checking")!;

  function snapshot(month: number, flows: Pick<MonthPoint, "income" | "expenses" | "debtPayments" | "contributions" | "surplus">): MonthPoint {
    let checking = 0, savings = 0, investments = 0, retirement = 0, otherAssets = 0, debt = 0, assetsTotal = 0;
    for (const a of accounts) {
      const b = bal.get(a.id) ?? 0;
      if (isLiability(a.type)) {
        debt += Math.max(0, b);
        continue;
      }
      if (a.type === "checking") checking += b;
      else if (a.type === "savings") savings += b;
      else if (a.type === "brokerage") investments += b;
      else if (a.type === "retirement") retirement += b;
      else otherAssets += b;
      if (a.includeInNetWorth) assetsTotal += b;
    }
    let earmarked = 0;
    for (const v of earmark.values()) earmarked += v;
    assetsTotal += earmarked;
    const nwDebt = liabilities.filter((a) => a.includeInNetWorth).reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0);
    return {
      month,
      date: addMonths(raw.today, month),
      netWorth: round2(assetsTotal - nwDebt),
      assets: round2(assetsTotal),
      checking: round2(checking),
      savings: round2(savings),
      cash: round2(checking + savings + earmarked),
      investments: round2(investments),
      retirement: round2(retirement),
      otherAssets: round2(otherAssets),
      earmarked: round2(earmarked),
      debt: round2(debt),
      income: round2(flows.income),
      expenses: round2(flows.expenses),
      debtPayments: round2(flows.debtPayments),
      contributions: round2(flows.contributions),
      surplus: round2(flows.surplus),
    };
  }

  function goalProgress(g: (typeof goals)[number], point: MonthPoint): number {
    if (g.linkedAccountId && byId.has(g.linkedAccountId)) {
      const acc = byId.get(g.linkedAccountId)!;
      const b = bal.get(acc.id) ?? 0;
      return isLiability(acc.type) ? g.targetAmount - Math.max(0, b) : b;
    }
    switch (g.category) {
      case "net_worth":
        return point.netWorth;
      case "retirement":
        return point.retirement;
      case "debt_payoff":
        return startDebt - point.debt;
      default:
        return earmark.get(g.id) ?? g.currentAmount;
    }
  }

  const points: MonthPoint[] = [];
  const shortfallMonths: number[] = [];
  const zeroFlows = { income: 0, expenses: 0, debtPayments: 0, contributions: 0, surplus: 0 };
  const start = snapshot(0, zeroFlows);
  points.push(start);
  const startProgress = new Map(goals.map((g) => [g.id, goalProgress(g, start)]));
  for (const g of goals) {
    if (g.status === "completed" || goalProgress(g, start) >= g.targetAmount - 0.005) goalDone.set(g.id, 0);
  }

  let firstCashFlow: CashFlow | null = null;

  for (let i = 1; i <= months; i++) {
    const yearIdx = Math.floor((i - 1) / 12);
    const growthPct = growthOverride ?? profile.incomeGrowthPct;
    let income = profile.monthlyIncome * Math.pow(1 + growthPct / 100, yearIdx);
    let expenses = profile.fixedExpenses + profile.variableExpenses;
    let extraBudget = profile.extraDebtPayment;
    const targetedExtra = new Map<string, number>();
    const contributionAdds = new Map<string, number>();
    for (const c of changes) {
      if (c.kind === "income" && active(c, i)) income += c.amountMonthly;
      else if (c.kind === "expense" && active(c, i)) expenses += c.amountMonthly;
      else if (c.kind === "debt_extra" && active(c, i)) {
        if (c.accountId && byId.has(c.accountId)) targetedExtra.set(c.accountId, (targetedExtra.get(c.accountId) ?? 0) + c.amountMonthly);
        else extraBudget += c.amountMonthly;
      } else if (c.kind === "contribution" && active(c, i) && byId.has(c.accountId)) {
        contributionAdds.set(c.accountId, (contributionAdds.get(c.accountId) ?? 0) + c.amountMonthly);
      }
    }

    // 1. Debts: interest, then required payments; freed payments roll over under snowball/avalanche/custom.
    let debtPayments = 0;
    let requiredPayments = 0;
    let freed = 0;
    for (const a of liabilities) {
      const b = bal.get(a.id) ?? 0;
      const base = basePayment.get(a.id) ?? 0;
      if (b <= 0.005) {
        if (profile.debtStrategy !== "minimum") freed += base;
        continue;
      }
      const interest = (b * (rateOf(a) / 100)) / 12;
      interestAcc.set(a.id, (interestAcc.get(a.id) ?? 0) + interest);
      let nb = b + interest;
      const pay = Math.min(nb, base);
      nb -= pay;
      debtPayments += pay;
      requiredPayments += pay;
      paidAcc.set(a.id, (paidAcc.get(a.id) ?? 0) + pay);
      bal.set(a.id, nb);
    }
    extraBudget += freed;
    // Goal contributions aimed at a linked liability count as targeted extra.
    let goalContributions = 0;
    for (const g of goals) {
      if (g.status !== "active" || goalDone.has(g.id) || g.monthlyContribution <= 0) continue;
      const acc = g.linkedAccountId ? byId.get(g.linkedAccountId) : undefined;
      if (acc && isLiability(acc.type)) targetedExtra.set(acc.id, (targetedExtra.get(acc.id) ?? 0) + g.monthlyContribution);
    }
    for (const [id, amt] of targetedExtra) {
      const b = bal.get(id) ?? 0;
      const pay = Math.min(Math.max(0, b), amt);
      bal.set(id, b - pay);
      debtPayments += pay;
      paidAcc.set(id, (paidAcc.get(id) ?? 0) + pay);
      extraBudget += amt - pay; // whatever this debt could not absorb rolls to the strategy queue
    }
    let extraPaid = 0;
    if (extraBudget > 0) {
      const open = liabilities.filter((a) => (bal.get(a.id) ?? 0) > 0.005);
      for (const a of orderForStrategy(open, profile.debtStrategy, rateOf, balOf)) {
        if (extraBudget <= 0) break;
        const b = bal.get(a.id) ?? 0;
        const pay = Math.min(b, extraBudget);
        bal.set(a.id, b - pay);
        extraBudget -= pay;
        debtPayments += pay;
        extraPaid += pay;
        paidAcc.set(a.id, (paidAcc.get(a.id) ?? 0) + pay);
      }
    }
    for (const a of liabilities) {
      if (!payoffMonth.has(a.id) && (bal.get(a.id) ?? 0) <= 0.005) {
        payoffMonth.set(a.id, i);
        bal.set(a.id, 0);
      }
    }

    // 2. Planned contributions into assets and goals.
    let contributions = 0;
    for (const a of assets) {
      const c = (a.contribution || 0) + (contributionAdds.get(a.id) ?? 0);
      if (c === 0) continue;
      bal.set(a.id, (bal.get(a.id) ?? 0) + c);
      contributions += c;
    }
    for (const g of goals) {
      if (g.status !== "active" || goalDone.has(g.id) || g.monthlyContribution <= 0) continue;
      const acc = g.linkedAccountId ? byId.get(g.linkedAccountId) : undefined;
      if (acc && isLiability(acc.type)) {
        goalContributions += g.monthlyContribution; // already applied as targeted extra above
        continue;
      }
      if (acc) bal.set(acc.id, (bal.get(acc.id) ?? 0) + g.monthlyContribution);
      else if (g.category === "net_worth" || g.category === "retirement" || g.category === "debt_payoff") {
        bal.set(destinationAccount().id, (bal.get(destinationAccount().id) ?? 0) + g.monthlyContribution);
      } else earmark.set(g.id, (earmark.get(g.id) ?? 0) + g.monthlyContribution);
      goalContributions += g.monthlyContribution;
    }

    // 3. One-time events this month.
    for (const c of changes) {
      if (c.kind === "one_time" && c.month === i) {
        const target = (c.fromAccountId && byId.get(c.fromAccountId)) || (c.amount >= 0 ? destinationAccount() : checkingAccount());
        if (isLiability(target.type)) bal.set(target.id, (bal.get(target.id) ?? 0) - c.amount);
        else bal.set(target.id, (bal.get(target.id) ?? 0) + c.amount);
      } else if (c.kind === "payoff_now" && c.month === i && byId.has(c.accountId)) {
        let owed = Math.max(0, bal.get(c.accountId) ?? 0);
        if (owed > 0) {
          const sources = [firstOf("savings"), checkingAccount()].filter((x): x is ModelAccount => Boolean(x));
          for (const s of sources) {
            if (owed <= 0) break;
            const have = bal.get(s.id) ?? 0;
            const take = s.type === "checking" ? owed : Math.min(Math.max(0, have), owed);
            bal.set(s.id, have - take);
            owed -= take;
          }
          paidAcc.set(c.accountId, (paidAcc.get(c.accountId) ?? 0) + (bal.get(c.accountId) ?? 0));
          bal.set(c.accountId, 0);
          if (!payoffMonth.has(c.accountId)) payoffMonth.set(c.accountId, i);
        }
      }
    }

    // 4. Surplus to destination (or shortfall out of checking).
    const surplus = income - expenses - debtPayments - contributions - goalContributions;
    if (surplus >= 0) bal.set(destinationAccount().id, (bal.get(destinationAccount().id) ?? 0) + surplus);
    else bal.set(checkingAccount().id, (bal.get(checkingAccount().id) ?? 0) + surplus);
    if ((bal.get(checkingAccount().id) ?? 0) < -0.005) shortfallMonths.push(i);

    // 5. Growth on assets.
    for (const a of assets) {
      const r = rateOf(a) / 100 / 12;
      if (r) bal.set(a.id, (bal.get(a.id) ?? 0) * (1 + r));
    }

    const point = snapshot(i, { income, expenses, debtPayments, contributions: contributions + goalContributions, surplus });
    points.push(point);
    for (const g of goals) {
      if (!goalDone.has(g.id) && g.targetAmount > 0 && goalProgress(g, point) >= g.targetAmount - 0.005) goalDone.set(g.id, i);
    }
    if (i === 1) {
      const free = income - expenses - requiredPayments;
      firstCashFlow = {
        income: round2(income),
        expenses: round2(expenses),
        debtPayments: round2(requiredPayments),
        extraDebt: round2(extraPaid),
        contributions: round2(contributions),
        goalContributions: round2(goalContributions),
        free: round2(free),
        unallocated: round2(surplus),
        savingsRatePct: income > 0 ? round2((Math.max(0, free) / income) * 100) : 0,
      };
    }
  }

  const end = points[points.length - 1];
  const goalResults: GoalResult[] = goals.map((g) => {
    const startAmount = startProgress.get(g.id) ?? 0;
    const endAmount = goalProgress(g, end);
    const done = goalDone.get(g.id) ?? null;
    const targetMonth = g.targetDate ? monthIndexOf(raw.today, g.targetDate) : null;
    const monthsDiff = done != null && targetMonth != null ? done - targetMonth : null;
    let status: GoalStatusKey;
    if (done != null && done === 0) status = "completed";
    else if (targetMonth == null) status = done != null ? "projected" : "stalled";
    else if (done == null) status = "significantly_behind";
    else if (monthsDiff! <= -3) status = "ahead";
    else if (monthsDiff! <= 0) status = "on_track";
    else if (monthsDiff! <= 3) status = "slightly_behind";
    else status = "significantly_behind";
    const remaining = Math.max(0, g.targetAmount - startAmount);
    const requiredMonthly = targetMonth != null && remaining > 0 ? round2(remaining / Math.max(1, targetMonth)) : remaining === 0 ? 0 : null;
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      targetAmount: round2(g.targetAmount),
      startAmount: round2(startAmount),
      endAmount: round2(endAmount),
      progressPct: g.targetAmount > 0 ? Math.max(0, Math.min(100, round2((startAmount / g.targetAmount) * 100))) : 0,
      targetDate: g.targetDate,
      targetMonth,
      projectedMonth: done,
      projectedDate: done != null ? addMonths(raw.today, done) : null,
      monthsDiff,
      status,
      plannedMonthly: g.monthlyContribution,
      requiredMonthly,
    };
  });

  const debtResults: DebtResult[] = liabilities
    .filter((a) => a.id !== CASH_ID)
    .map((a) => {
      const pm = payoffMonth.get(a.id) ?? null;
      return {
        accountId: a.id,
        name: a.name,
        type: a.type,
        rate: rateOf(a),
        startBalance: round2(a.balance),
        endBalance: round2(bal.get(a.id) ?? 0),
        monthlyPayment: basePayment.get(a.id) ?? 0,
        payoffMonth: pm,
        payoffDate: pm != null ? addMonths(raw.today, pm) : null,
        totalInterest: round2(interestAcc.get(a.id) ?? 0),
        totalPaid: round2(paidAcc.get(a.id) ?? 0),
      };
    });
  const openDebts = debtResults.filter((d) => d.startBalance > 0);
  const debtFreeMonth = openDebts.length === 0 ? 0 : openDebts.every((d) => d.payoffMonth != null) ? Math.max(...openDebts.map((d) => d.payoffMonth!)) : null;

  const milestones: NetWorthMilestone[] = [];
  for (const t of NET_WORTH_THRESHOLDS) {
    if (start.netWorth >= t) continue;
    const p = points.find((pt) => pt.netWorth >= t);
    if (p) milestones.push({ amount: t, month: p.month, date: p.date });
  }

  const monthlyNeed = profile.fixedExpenses + profile.variableExpenses + liabilities.reduce((s, a) => s + (a.balance > 0 ? effectivePayment(a) : 0), 0);
  return {
    today: raw.today,
    months,
    points,
    goals: goalResults,
    debts: debtResults,
    debtFreeMonth,
    debtFreeDate: debtFreeMonth != null ? addMonths(raw.today, debtFreeMonth) : null,
    totalInterest: round2(debtResults.reduce((s, d) => s + d.totalInterest, 0)),
    milestones,
    shortfallMonths,
    firstShortfallMonth: shortfallMonths[0] ?? null,
    cashFlow: firstCashFlow ?? { income: 0, expenses: 0, debtPayments: 0, extraDebt: 0, contributions: 0, goalContributions: 0, free: 0, unallocated: 0, savingsRatePct: 0 },
    emergencyFundTarget: efTarget,
    emergencyFundMonthsCovered: monthlyNeed > 0 ? round2(start.savings / monthlyNeed) : 0,
    start,
    end,
  };
}

/* ---------- Debt strategy comparison ---------- */

export interface StrategyComparison {
  strategy: DebtStrategy;
  debtFreeMonth: number | null;
  debtFreeDate: string | null;
  totalInterest: number;
  interestSavedVsMinimum: number;
  monthsSavedVsMinimum: number | null;
}

export function compareDebtStrategies(inputs: ModelInputs, extraDebtPayment?: number): StrategyComparison[] {
  const strategies: DebtStrategy[] = ["minimum", "avalanche", "snowball", "custom"];
  const runs = strategies.map((strategy) => {
    const p = runProjection({ ...inputs, months: Math.max(inputs.months, 360), profile: { ...inputs.profile, debtStrategy: strategy, extraDebtPayment: extraDebtPayment ?? inputs.profile.extraDebtPayment } });
    return { strategy, p };
  });
  const min = runs[0].p;
  return runs.map(({ strategy, p }) => ({
    strategy,
    debtFreeMonth: p.debtFreeMonth,
    debtFreeDate: p.debtFreeDate,
    totalInterest: p.totalInterest,
    interestSavedVsMinimum: round2(min.totalInterest - p.totalInterest),
    monthsSavedVsMinimum: min.debtFreeMonth != null && p.debtFreeMonth != null ? min.debtFreeMonth - p.debtFreeMonth : null,
  }));
}

/* ---------- Goal allocation ---------- */

export interface AllocationLine {
  goalId: string;
  name: string;
  priority: number;
  requiredMonthly: number | null;
  suggestedMonthly: number;
  fullyFunded: boolean;
}

/**
 * Splits `available` monthly cash across active goals in priority order: each goal takes what it
 * needs to hit its target date (straight-line), leftovers go to goals without a date.
 */
export function suggestAllocation(inputs: ModelInputs, available: number): AllocationLine[] {
  const base = runProjection({ ...inputs, months: 1 });
  const byId = new Map(base.goals.map((g) => [g.id, g]));
  const goals = inputs.goals.filter((g) => g.status === "active" && byId.get(g.id)?.status !== "completed").sort((a, b) => a.priority - b.priority);
  let remaining = Math.max(0, available);
  const lines: AllocationLine[] = [];
  const undated: AllocationLine[] = [];
  for (const g of goals) {
    const r = byId.get(g.id);
    const required = r?.requiredMonthly ?? null;
    const line: AllocationLine = { goalId: g.id, name: g.name, priority: g.priority, requiredMonthly: required, suggestedMonthly: 0, fullyFunded: false };
    if (required != null) {
      line.suggestedMonthly = round2(Math.min(required, remaining));
      line.fullyFunded = line.suggestedMonthly >= required - 0.005;
      remaining = round2(remaining - line.suggestedMonthly);
    } else undated.push(line);
    lines.push(line);
  }
  if (undated.length && remaining > 0) {
    const each = round2(remaining / undated.length);
    for (const l of undated) {
      l.suggestedMonthly = each;
      l.fullyFunded = true;
    }
  }
  return lines;
}

export function withAllocation(inputs: ModelInputs, lines: AllocationLine[]): ModelInputs {
  const map = new Map(lines.map((l) => [l.goalId, l.suggestedMonthly]));
  return { ...inputs, goals: inputs.goals.map((g) => (map.has(g.id) ? { ...g, monthlyContribution: map.get(g.id)! } : g)) };
}

/* ---------- Scenario comparison ---------- */

export interface ScenarioSummary {
  name: string;
  netWorth1y: number;
  netWorth3y: number;
  netWorth5y: number;
  netWorth10y: number;
  netWorthEnd: number;
  debtFreeMonth: number | null;
  debtFreeDate: string | null;
  totalInterest: number;
  investmentsEnd: number;
  cashEnd: number;
  emergencyFundMonth: number | null;
  emergencyFundDate: string | null;
  monthlyCashFlow: number;
  firstShortfallMonth: number | null;
  goals: { id: string; name: string; projectedMonth: number | null; projectedDate: string | null; status: GoalStatusKey }[];
  projection: Projection;
}

export function summarize(name: string, p: Projection): ScenarioSummary {
  const at = (m: number) => (p.points[Math.min(m, p.points.length - 1)] ?? p.end).netWorth;
  const ef = p.goals.find((g) => g.category === "emergency_fund");
  return {
    name,
    netWorth1y: at(12),
    netWorth3y: at(36),
    netWorth5y: at(60),
    netWorth10y: at(120),
    netWorthEnd: p.end.netWorth,
    debtFreeMonth: p.debtFreeMonth,
    debtFreeDate: p.debtFreeDate,
    totalInterest: p.totalInterest,
    investmentsEnd: round2(p.end.investments + p.end.retirement),
    cashEnd: p.end.cash,
    emergencyFundMonth: ef?.projectedMonth ?? null,
    emergencyFundDate: ef?.projectedDate ?? null,
    monthlyCashFlow: p.cashFlow.unallocated,
    firstShortfallMonth: p.firstShortfallMonth,
    goals: p.goals.map((g) => ({ id: g.id, name: g.name, projectedMonth: g.projectedMonth, projectedDate: g.projectedDate, status: g.status })),
    projection: p,
  };
}

export function runScenario(base: ModelInputs, name: string, changes: ScenarioChange[]): ScenarioSummary {
  return summarize(name, runProjection({ ...base, changes: [...(base.changes ?? []), ...changes] }));
}

/** Monthly contribution needed to reach `target` from `current` in `months` at an annual rate (compound monthly). */
export function requiredContribution(current: number, target: number, months: number, annualRatePct: number): number {
  if (months <= 0) return Math.max(0, target - current);
  const r = annualRatePct / 100 / 12;
  const fvCurrent = current * Math.pow(1 + r, months);
  const remaining = target - fvCurrent;
  if (remaining <= 0) return 0;
  if (r === 0) return round2(remaining / months);
  return round2((remaining * r) / (Math.pow(1 + r, months) - 1));
}

/** Months to pay a balance at an APR with a fixed payment; null when the payment never clears the interest. */
export function monthsToPayoff(balance: number, aprPct: number, payment: number): number | null {
  if (balance <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (payment <= 0) return null;
  if (r === 0) return Math.ceil(balance / payment);
  if (payment <= balance * r) return null;
  return Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r));
}
