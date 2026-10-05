import { z } from "zod";
import { optionalDate, optionalText, optionalUuid } from "@/lib/validation";

const money = z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : v), z.number().finite().min(-1e11).max(1e11));
const moneyOpt = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : v), z.number().finite().min(-1e11).max(1e11).nullable());
const pct = z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[%\s]/g, "")) : v), z.number().finite().min(-100).max(1000));
const pctOpt = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.replace(/[%\s]/g, "")) : v), z.number().finite().min(-100).max(1000).nullable());
const intNonNeg = z.preprocess((v) => (typeof v === "string" ? parseInt(v, 10) : v), z.number().int().min(0).max(100000));

export const accountTypeSchema = z.enum(["checking", "savings", "credit_card", "student_loan", "auto_loan", "other_loan", "brokerage", "retirement", "other_asset", "other_liability"]);
export const goalCategorySchema = z.enum(["emergency_fund", "debt_payoff", "education", "home", "vehicle", "net_worth", "retirement", "wedding", "travel", "savings", "other"]);
export const goalStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
export const debtStrategySchema = z.enum(["minimum", "avalanche", "snowball", "custom"]);
export const milestoneTypeSchema = z.enum(["goal", "life_event", "debt_free", "net_worth", "custom"]);
export const budgetKindSchema = z.enum(["expense", "debt", "savings", "investing"]);
export const recurringKindSchema = z.enum(["income", "expense", "debt", "savings", "investing"]);
export const recurringCadenceSchema = z.enum(["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"]);
export const transactionTypeSchema = z.enum(["income", "expense", "transfer", "payment", "contribution"]);

export const financialProfileSchema = z.object({
  monthly_income: money,
  income_growth_pct: pct,
  fixed_expenses: money,
  variable_expenses: money,
  investment_return_pct: pct,
  savings_apy_pct: pct,
  emergency_fund_months: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(0).max(60)),
  surplus_destination: z.enum(["checking", "savings", "investing"]),
  debt_strategy: debtStrategySchema,
  extra_debt_payment: money,
});

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(120),
  account_type: accountTypeSchema,
  institution: optionalText(120),
  balance: money,
  interest_rate: pctOpt,
  minimum_payment: moneyOpt,
  monthly_contribution: money.optional(),
  include_in_net_worth: z.boolean().optional(),
  notes: optionalText(5000),
  last_updated: optionalDate.optional(),
  // debt details (liabilities only)
  actual_payment: moneyOpt.optional(),
  original_balance: moneyOpt.optional(),
});
export type AccountInput = z.infer<typeof accountInputSchema>;

export const goalInputSchema = z.object({
  name: z.string().trim().min(1, "Give the goal a name").max(160),
  category: goalCategorySchema,
  target_amount: money,
  current_amount: money.optional(),
  linked_account_id: optionalUuid,
  target_date: optionalDate,
  monthly_contribution: money.optional(),
  status: goalStatusSchema.optional(),
  linked_project_id: optionalUuid,
  notes: optionalText(5000),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("income"), label: z.string().max(200), amountMonthly: money, startMonth: intNonNeg, endMonth: intNonNeg.nullable().optional() }),
  z.object({ kind: z.literal("expense"), label: z.string().max(200), amountMonthly: money, startMonth: intNonNeg, endMonth: intNonNeg.nullable().optional() }),
  z.object({ kind: z.literal("one_time"), label: z.string().max(200), amount: money, month: intNonNeg, fromAccountId: optionalUuid.optional() }),
  z.object({ kind: z.literal("debt_extra"), label: z.string().max(200), amountMonthly: money, startMonth: intNonNeg, endMonth: intNonNeg.nullable().optional(), accountId: optionalUuid.optional() }),
  z.object({ kind: z.literal("payoff_now"), label: z.string().max(200), accountId: z.string().uuid(), month: intNonNeg }),
  z.object({ kind: z.literal("contribution"), label: z.string().max(200), accountId: z.string().uuid(), amountMonthly: money, startMonth: intNonNeg, endMonth: intNonNeg.nullable().optional() }),
  z.object({ kind: z.literal("return_rate"), label: z.string().max(200), investmentReturnPct: pct }),
  z.object({ kind: z.literal("income_growth"), label: z.string().max(200), pct }),
]);

export const scenarioInputSchema = z.object({
  name: z.string().trim().min(1, "Name the scenario").max(160),
  description: optionalText(2000),
  changes: z.array(changeSchema).max(40),
  is_favorite: z.boolean().optional(),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export const milestoneInputSchema = z.object({
  title: z.string().trim().min(1, "Give the milestone a title").max(200),
  milestone_type: milestoneTypeSchema.optional(),
  target_date: optionalDate,
  amount: moneyOpt.optional(),
  linked_goal_id: optionalUuid,
  linked_event_id: optionalUuid,
  is_done: z.boolean().optional(),
  notes: optionalText(5000),
});
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;

export const budgetCategoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name the category").max(80),
  kind: budgetKindSchema.optional(),
  budgeted: money.optional(),
});

export const budgetActualSchema = z.object({
  category_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "Month must be YYYY-MM-01"),
  actual: money,
});

export const recurringInputSchema = z.object({
  name: z.string().trim().min(1, "Name the recurring item").max(120),
  kind: recurringKindSchema,
  amount: money.refine((n) => n >= 0, "Amount is per occurrence and cannot be negative"),
  cadence: recurringCadenceSchema,
  next_date: optionalDate,
  account_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(1).max(64).nullable()),
  category_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(1).max(64).nullable()),
  match_pattern: optionalText(200),
  is_variable: z.boolean().optional(),
  in_projection: z.boolean().optional(),
  is_active: z.boolean().optional(),
  notes: optionalText(5000),
});
export type RecurringInput = z.infer<typeof recurringInputSchema>;

export const transactionInputSchema = z.object({
  account_id: z.string().min(1, "Pick an account").max(64),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  description: z.string().trim().min(1, "Describe the transaction").max(300),
  amount: money.refine((n) => n !== 0, "Amount cannot be zero"),
  transaction_type: transactionTypeSchema,
  category_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(1).max(64).nullable()),
});
export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const transactionPatchSchema = z.object({
  category_id: z.preprocess((v) => (v === "" ? null : v), z.string().min(1).max(64).nullable()).optional(),
  transaction_type: transactionTypeSchema.optional(),
});
