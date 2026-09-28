/** Financial Future domain types. Money is a JS number in USD; dates are "YYYY-MM-DD". */

export type AccountType =
  | "checking" | "savings" | "credit_card" | "student_loan" | "auto_loan" | "other_loan"
  | "brokerage" | "retirement" | "other_asset" | "other_liability";

export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set(["credit_card", "student_loan", "auto_loan", "other_loan", "other_liability"]);
export const INVESTMENT_TYPES: ReadonlySet<AccountType> = new Set(["brokerage", "retirement"]);
export const CASH_TYPES: ReadonlySet<AccountType> = new Set(["checking", "savings"]);

export const ACCOUNT_TYPES: { value: AccountType; label: string; group: "cash" | "debt" | "investment" | "other" }[] = [
  { value: "checking", label: "Checking", group: "cash" },
  { value: "savings", label: "Savings", group: "cash" },
  { value: "credit_card", label: "Credit card", group: "debt" },
  { value: "student_loan", label: "Student loan", group: "debt" },
  { value: "auto_loan", label: "Auto loan", group: "debt" },
  { value: "other_loan", label: "Other loan", group: "debt" },
  { value: "brokerage", label: "Brokerage", group: "investment" },
  { value: "retirement", label: "Retirement", group: "investment" },
  { value: "other_asset", label: "Other asset", group: "other" },
  { value: "other_liability", label: "Other liability", group: "debt" },
];

export function isLiability(t: AccountType) {
  return LIABILITY_TYPES.has(t);
}

export type GoalCategory = "emergency_fund" | "debt_payoff" | "education" | "home" | "vehicle" | "net_worth" | "retirement" | "wedding" | "travel" | "savings" | "other";
export const GOAL_CATEGORIES: { value: GoalCategory; label: string }[] = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "debt_payoff", label: "Debt payoff" },
  { value: "education", label: "Education" },
  { value: "home", label: "Home" },
  { value: "vehicle", label: "Vehicle" },
  { value: "net_worth", label: "Net worth" },
  { value: "retirement", label: "Retirement" },
  { value: "wedding", label: "Wedding" },
  { value: "travel", label: "Travel" },
  { value: "savings", label: "Savings" },
  { value: "other", label: "Other" },
];

export type GoalStatus = "active" | "paused" | "completed" | "archived";
export type DebtStrategy = "minimum" | "avalanche" | "snowball" | "custom";
export const DEBT_STRATEGIES: { value: DebtStrategy; label: string; hint: string }[] = [
  { value: "minimum", label: "Minimum payments", hint: "Pay only what each lender requires." },
  { value: "avalanche", label: "Avalanche", hint: "Extra goes to the highest interest rate first. Least total interest." },
  { value: "snowball", label: "Snowball", hint: "Extra goes to the smallest balance first. Fastest first win." },
  { value: "custom", label: "Custom order", hint: "Extra follows the order you set." },
];
export type SurplusDestination = "checking" | "savings" | "investing";

export interface FinancialProfile {
  user_id: string;
  monthly_income: number;
  income_growth_pct: number;
  fixed_expenses: number;
  variable_expenses: number;
  investment_return_pct: number;
  savings_apy_pct: number;
  emergency_fund_months: number;
  surplus_destination: SurplusDestination;
  debt_strategy: DebtStrategy;
  extra_debt_payment: number;
  assumptions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FinancialAccount {
  id: string;
  user_id: string;
  name: string;
  account_type: AccountType;
  institution: string | null;
  balance: number;
  interest_rate: number | null;
  minimum_payment: number | null;
  monthly_contribution: number;
  include_in_net_worth: boolean;
  external_provider: string | null;
  external_account_id: string | null;
  plaid_item_id: string | null;
  external_subtype: string | null;
  external_mask: string | null;
  official_name: string | null;
  available_balance: number | null;
  last_synced_at: string | null;
  sync_error: string | null;
  notes: string | null;
  last_updated: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export type PlaidItemStatus = "active" | "error" | "reauth_required" | "disconnected";

export interface PlaidItem {
  id: string;
  user_id: string;
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  environment: "sandbox" | "production";
  status: PlaidItemStatus;
  error_code: string | null;
  error_message: string | null;
  products: string[];
  transactions_cursor: string | null;
  last_synced_at: string | null;
  last_webhook_at: string | null;
  consent_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaidSyncResult {
  accounts_seen: number;
  accounts_created: number;
  accounts_updated: number;
  transactions_added: number;
  transactions_modified: number;
  transactions_removed: number;
  liabilities: boolean;
  realtime: boolean;
  warnings: string[];
}

export interface PlaidSyncRun {
  id: string;
  user_id: string;
  item_id: string | null;
  trigger: "link" | "manual" | "scheduled" | "webhook";
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  result: PlaidSyncResult | null;
  error: string | null;
}

export type TransactionType = "income" | "expense" | "transfer" | "payment" | "contribution";

export interface FinancialTransaction {
  id: string;
  user_id: string;
  account_id: string;
  transaction_date: string;
  description: string | null;
  category_id: string | null;
  amount: number;
  transaction_type: TransactionType;
  external_id: string | null;
  pending: boolean;
  merchant_name: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  plaid_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialDebt {
  id: string;
  user_id: string;
  account_id: string;
  original_balance: number | null;
  actual_payment: number;
  custom_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BalanceSnapshot {
  id: string;
  user_id: string;
  account_id: string;
  snapshot_date: string;
  balance: number;
}

export interface FinancialGoal {
  id: string;
  user_id: string;
  name: string;
  category: GoalCategory;
  target_amount: number;
  current_amount: number;
  linked_account_id: string | null;
  target_date: string | null;
  priority: number;
  monthly_contribution: number;
  status: GoalStatus;
  linked_project_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** A typed change applied on top of the baseline model. Months are offsets from today (0 = this month). */
export type ScenarioChange =
  | { kind: "income"; label: string; amountMonthly: number; startMonth: number; endMonth?: number | null }
  | { kind: "expense"; label: string; amountMonthly: number; startMonth: number; endMonth?: number | null }
  | { kind: "one_time"; label: string; amount: number; month: number; fromAccountId?: string | null }
  | { kind: "debt_extra"; label: string; amountMonthly: number; startMonth: number; endMonth?: number | null; accountId?: string | null }
  | { kind: "payoff_now"; label: string; accountId: string; month: number }
  | { kind: "contribution"; label: string; accountId: string; amountMonthly: number; startMonth: number; endMonth?: number | null }
  | { kind: "return_rate"; label: string; investmentReturnPct: number }
  | { kind: "income_growth"; label: string; pct: number };

export interface FinancialScenario {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  assumptions: { changes: ScenarioChange[] };
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export type MilestoneType = "goal" | "life_event" | "debt_free" | "net_worth" | "custom";

export interface FinancialMilestone {
  id: string;
  user_id: string;
  title: string;
  milestone_type: MilestoneType;
  target_date: string | null;
  projected_date: string | null;
  amount: number | null;
  linked_goal_id: string | null;
  linked_event_id: string | null;
  is_done: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type BudgetKind = "expense" | "debt" | "savings" | "investing";

export interface BudgetCategory {
  id: string;
  user_id: string;
  name: string;
  kind: BudgetKind;
  budgeted: number;
  sort_order: number;
  is_archived: boolean;
  plaid_categories: string[];
  created_at: string;
}

export interface BudgetActual {
  id: string;
  user_id: string;
  category_id: string;
  month: string;
  actual: number;
  notes: string | null;
}

export const DEFAULT_BUDGET_CATEGORIES: { name: string; kind: BudgetKind }[] = [
  { name: "Housing", kind: "expense" },
  { name: "Utilities", kind: "expense" },
  { name: "Transportation", kind: "expense" },
  { name: "Food", kind: "expense" },
  { name: "Restaurants", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Shopping", kind: "expense" },
  { name: "Insurance", kind: "expense" },
  { name: "Debt payments", kind: "debt" },
  { name: "Savings", kind: "savings" },
  { name: "Investing", kind: "investing" },
  { name: "Travel", kind: "expense" },
  { name: "Subscriptions", kind: "expense" },
  { name: "Other", kind: "expense" },
];
