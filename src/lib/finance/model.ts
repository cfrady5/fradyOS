/** Adapters from database rows to engine inputs, plus display metadata. Client-safe. */
import type { ModelAccount, ModelGoal, ModelInputs, ModelProfile, GoalStatusKey } from "./engine";
import type { FinancialAccount, FinancialDebt, FinancialGoal, FinancialProfile, ScenarioChange } from "./types";

export const DEFAULT_HORIZON_MONTHS = 120;
export const HORIZONS: { value: number; label: string }[] = [
  { value: 12, label: "1 year" },
  { value: 36, label: "3 years" },
  { value: 60, label: "5 years" },
  { value: 120, label: "10 years" },
  { value: 240, label: "20 years" },
  { value: 360, label: "30 years" },
];

export function toModelProfile(p: FinancialProfile): ModelProfile {
  return {
    monthlyIncome: Number(p.monthly_income) || 0,
    incomeGrowthPct: Number(p.income_growth_pct) || 0,
    fixedExpenses: Number(p.fixed_expenses) || 0,
    variableExpenses: Number(p.variable_expenses) || 0,
    investmentReturnPct: Number(p.investment_return_pct) || 0,
    savingsApyPct: Number(p.savings_apy_pct) || 0,
    emergencyFundMonths: Number(p.emergency_fund_months) || 0,
    surplusDestination: p.surplus_destination,
    debtStrategy: p.debt_strategy,
    extraDebtPayment: Number(p.extra_debt_payment) || 0,
  };
}

export function toModelAccounts(accounts: FinancialAccount[], debts: FinancialDebt[]): ModelAccount[] {
  const debtByAccount = new Map(debts.map((d) => [d.account_id, d]));
  return accounts
    .filter((a) => !a.is_archived)
    .map((a) => {
      const d = debtByAccount.get(a.id);
      return {
        id: a.id,
        name: a.name,
        type: a.account_type,
        balance: Number(a.balance) || 0,
        rate: a.interest_rate == null ? null : Number(a.interest_rate),
        minimumPayment: a.minimum_payment == null ? null : Number(a.minimum_payment),
        actualPayment: d ? Number(d.actual_payment) || 0 : 0,
        contribution: Number(a.monthly_contribution) || 0,
        includeInNetWorth: a.include_in_net_worth,
        customOrder: d?.custom_order ?? 0,
      };
    });
}

export function toModelGoals(goals: FinancialGoal[]): ModelGoal[] {
  return goals
    .filter((g) => g.status !== "archived")
    .map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      targetAmount: Number(g.target_amount) || 0,
      currentAmount: Number(g.current_amount) || 0,
      linkedAccountId: g.linked_account_id,
      targetDate: g.target_date,
      priority: g.priority,
      monthlyContribution: Number(g.monthly_contribution) || 0,
      status: g.status,
    }));
}

export function buildModelInputs(args: { today: string; months?: number; profile: FinancialProfile; accounts: FinancialAccount[]; debts: FinancialDebt[]; goals: FinancialGoal[]; changes?: ScenarioChange[] }): ModelInputs {
  return {
    today: args.today,
    months: args.months ?? DEFAULT_HORIZON_MONTHS,
    profile: toModelProfile(args.profile),
    accounts: toModelAccounts(args.accounts, args.debts),
    goals: toModelGoals(args.goals),
    changes: args.changes ?? [],
  };
}

export const GOAL_STATUS_META: Record<GoalStatusKey, { label: string; tone: "good" | "warning" | "serious" | "critical" | "neutral"; hint: string }> = {
  completed: { label: "Completed", tone: "good", hint: "Target reached." },
  ahead: { label: "Ahead", tone: "good", hint: "Projected to finish 3+ months before the target date." },
  on_track: { label: "On track", tone: "good", hint: "Projected to finish by the target date." },
  slightly_behind: { label: "Slightly behind", tone: "warning", hint: "Projected 1–3 months late at the current contribution." },
  significantly_behind: { label: "Significantly behind", tone: "critical", hint: "Projected more than 3 months late, or not within the horizon." },
  projected: { label: "Projected", tone: "neutral", hint: "No target date; shows the projected completion." },
  stalled: { label: "Stalled", tone: "serious", hint: "Nothing is flowing toward this goal, so it never completes." },
};

export const TONE_CLASS: Record<"good" | "warning" | "serious" | "critical" | "neutral", string> = {
  good: "border-success/30 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/12 text-warning",
  serious: "border-chart-serious/30 bg-chart-serious/12 text-chart-serious",
  critical: "border-destructive/30 bg-destructive/12 text-destructive",
  neutral: "border-border bg-secondary text-muted-foreground",
};

/** Chart series colors (dataviz categorical slots, light / dark). */
export const SERIES = {
  netWorth: { light: "#2a78d6", dark: "#3987e5" },
  cash: { light: "#1baf7a", dark: "#199e70" },
  investments: { light: "#eb6834", dark: "#d95926" },
  debt: { light: "#e87ba4", dark: "#d55181" },
  baseline: { light: "#2a78d6", dark: "#3987e5" },
  scenario: { light: "#eb6834", dark: "#d95926" },
  scenario2: { light: "#1baf7a", dark: "#199e70" },
  scenario3: { light: "#eda100", dark: "#c98500" },
} as const;

export const SCENARIO_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
