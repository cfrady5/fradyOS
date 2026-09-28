import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, type Workspace } from "@/lib/data/workspace";
import type { BalanceSnapshot, BudgetActual, BudgetCategory, FinancialAccount, FinancialDebt, FinancialGoal, FinancialMilestone, FinancialProfile, FinancialScenario, ScenarioChange } from "@/lib/finance/types";
import { DEFAULT_BUDGET_CATEGORIES } from "@/lib/finance/types";
import { buildModelInputs } from "@/lib/finance/model";
import type { ModelInputs } from "@/lib/finance/engine";
import { addMonths, startOfMonth } from "@/lib/dates";

export type FinanceData = {
  ws: Workspace;
  profile: FinancialProfile;
  accounts: FinancialAccount[];
  debts: FinancialDebt[];
  goals: FinancialGoal[];
  scenarios: FinancialScenario[];
  milestones: FinancialMilestone[];
  categories: BudgetCategory[];
  /** Net worth history from balance snapshots: one point per month (last 24 months). */
  history: { date: string; netWorth: number }[];
  linkedProjects: { id: string; name: string; status: string; task_total: number; task_done: number }[];
  upcomingEvents: { id: string; name: string; start_date: string | null }[];
  inputs: ModelInputs;
  /** True until income or at least one account exists. */
  isEmpty: boolean;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function shapeProfile(row: Record<string, unknown>): FinancialProfile {
  return {
    ...(row as unknown as FinancialProfile),
    monthly_income: num(row.monthly_income),
    income_growth_pct: num(row.income_growth_pct),
    fixed_expenses: num(row.fixed_expenses),
    variable_expenses: num(row.variable_expenses),
    investment_return_pct: num(row.investment_return_pct),
    savings_apy_pct: num(row.savings_apy_pct),
    emergency_fund_months: num(row.emergency_fund_months),
    extra_debt_payment: num(row.extra_debt_payment),
    assumptions: (row.assumptions as Record<string, unknown>) ?? {},
  };
}

function shapeAccount(row: Record<string, unknown>): FinancialAccount {
  return {
    ...(row as unknown as FinancialAccount),
    balance: num(row.balance),
    interest_rate: row.interest_rate == null ? null : num(row.interest_rate),
    minimum_payment: row.minimum_payment == null ? null : num(row.minimum_payment),
    monthly_contribution: num(row.monthly_contribution),
  };
}

function shapeDebt(row: Record<string, unknown>): FinancialDebt {
  return { ...(row as unknown as FinancialDebt), original_balance: row.original_balance == null ? null : num(row.original_balance), actual_payment: num(row.actual_payment) };
}

function shapeGoal(row: Record<string, unknown>): FinancialGoal {
  return { ...(row as unknown as FinancialGoal), target_amount: num(row.target_amount), current_amount: num(row.current_amount), monthly_contribution: num(row.monthly_contribution) };
}

function shapeScenario(row: Record<string, unknown>): FinancialScenario {
  const a = row.assumptions as { changes?: ScenarioChange[] } | null;
  return { ...(row as unknown as FinancialScenario), assumptions: { changes: Array.isArray(a?.changes) ? a!.changes! : [] } };
}

function shapeMilestone(row: Record<string, unknown>): FinancialMilestone {
  return { ...(row as unknown as FinancialMilestone), amount: row.amount == null ? null : num(row.amount) };
}

export function shapeCategory(row: Record<string, unknown>): BudgetCategory {
  return { ...(row as unknown as BudgetCategory), budgeted: num(row.budgeted) };
}

export function shapeActual(row: Record<string, unknown>): BudgetActual {
  return { ...(row as unknown as BudgetActual), actual: num(row.actual) };
}

/** Loads everything the Finances section needs, bootstrapping the profile and default budget categories on first visit. */
export const getFinanceData = cache(async (months?: number): Promise<FinanceData> => {
  const ws = await requireWorkspace();
  const supabase = await createClient();
  const uid = ws.userId;

  let { data: profileRow } = await supabase.from("financial_profiles").select("*").eq("user_id", uid).maybeSingle();
  if (!profileRow) {
    const ins = await supabase.from("financial_profiles").insert({ user_id: uid }).select("*").single();
    if (ins.error) throw new Error(ins.error.message);
    profileRow = ins.data;
    await supabase.from("financial_budget_categories").insert(DEFAULT_BUDGET_CATEGORIES.map((c, i) => ({ user_id: uid, name: c.name, kind: c.kind, sort_order: i })));
  }

  const since = addMonths(startOfMonth(ws.today), -24);
  const [accounts, debts, goals, scenarios, milestones, categories, snapshots] = await Promise.all([
    supabase.from("financial_accounts").select("*").eq("user_id", uid).order("is_archived").order("account_type").order("name"),
    supabase.from("financial_debts").select("*").eq("user_id", uid).order("custom_order"),
    supabase.from("financial_goals").select("*").eq("user_id", uid).order("priority").order("created_at"),
    supabase.from("financial_scenarios").select("*").eq("user_id", uid).order("is_favorite", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("financial_milestones").select("*").eq("user_id", uid).order("target_date", { ascending: true, nullsFirst: false }).order("sort_order"),
    supabase.from("financial_budget_categories").select("*").eq("user_id", uid).eq("is_archived", false).order("sort_order").order("name"),
    supabase.from("financial_balance_snapshots").select("account_id,snapshot_date,balance").eq("user_id", uid).gte("snapshot_date", since).order("snapshot_date"),
  ]);
  for (const r of [accounts, debts, goals, scenarios, milestones, categories, snapshots]) if (r.error) throw new Error(r.error.message);

  const shapedAccounts = ((accounts.data ?? []) as Record<string, unknown>[]).map(shapeAccount);
  const shapedDebts = ((debts.data ?? []) as Record<string, unknown>[]).map(shapeDebt);
  const shapedGoals = ((goals.data ?? []) as Record<string, unknown>[]).map(shapeGoal);
  const profile = shapeProfile(profileRow as Record<string, unknown>);

  const projectIds = shapedGoals.map((g) => g.linked_project_id).filter((x): x is string => Boolean(x));
  const [projects, events] = await Promise.all([
    projectIds.length ? supabase.from("projects").select("id,name,status,tasks(id,status)").in("id", projectIds) : Promise.resolve({ data: [] as unknown[], error: null }),
    supabase.from("events").select("id,name,start_date").eq("user_id", uid).eq("is_archived", false).gte("start_date", ws.today).order("start_date").limit(50),
  ]);

  type PR = { id: string; name: string; status: string; tasks: { id: string; status: string }[] | null };
  const linkedProjects = ((projects.data ?? []) as PR[]).map((p) => ({ id: p.id, name: p.name, status: p.status, task_total: (p.tasks ?? []).length, task_done: (p.tasks ?? []).filter((t) => t.status === "completed").length }));

  const history = buildHistory(((snapshots.data ?? []) as Pick<BalanceSnapshot, "account_id" | "snapshot_date" | "balance">[]).map((s) => ({ ...s, balance: num(s.balance) })), shapedAccounts);

  const inputs = buildModelInputs({ today: ws.today, months, profile, accounts: shapedAccounts, debts: shapedDebts, goals: shapedGoals });

  return {
    ws,
    profile,
    accounts: shapedAccounts,
    debts: shapedDebts,
    goals: shapedGoals,
    scenarios: ((scenarios.data ?? []) as Record<string, unknown>[]).map(shapeScenario),
    milestones: ((milestones.data ?? []) as Record<string, unknown>[]).map(shapeMilestone),
    categories: ((categories.data ?? []) as Record<string, unknown>[]).map(shapeCategory),
    history,
    linkedProjects,
    upcomingEvents: (events.data ?? []) as { id: string; name: string; start_date: string | null }[],
    inputs,
    isEmpty: profile.monthly_income <= 0 && shapedAccounts.length === 0,
  };
});

/** Month-end net worth from snapshots: for each month, the latest known balance per account (carried forward). */
function buildHistory(snaps: Pick<BalanceSnapshot, "account_id" | "snapshot_date" | "balance">[], accounts: FinancialAccount[]): { date: string; netWorth: number }[] {
  if (!snaps.length) return [];
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const months = Array.from(new Set(snaps.map((s) => s.snapshot_date.slice(0, 7)))).sort();
  const latest = new Map<string, number>();
  const out: { date: string; netWorth: number }[] = [];
  let idx = 0;
  const sorted = [...snaps].sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
  for (const m of months) {
    while (idx < sorted.length && sorted[idx].snapshot_date.slice(0, 7) <= m) {
      latest.set(sorted[idx].account_id, sorted[idx].balance);
      idx++;
    }
    let nw = 0;
    for (const [id, bal] of latest) {
      const a = byAccount.get(id);
      if (!a || !a.include_in_net_worth) continue;
      const liability = ["credit_card", "student_loan", "auto_loan", "other_loan", "other_liability"].includes(a.account_type);
      nw += liability ? -bal : bal;
    }
    out.push({ date: `${m}-01`, netWorth: Math.round(nw * 100) / 100 });
  }
  return out;
}

export async function getBudgetMonth(userId: string, month: string): Promise<BudgetActual[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("financial_budget_actuals").select("*").eq("user_id", userId).eq("month", month);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(shapeActual);
}
