"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { firstZodMessage, zodFieldErrors, optionalDate } from "@/lib/validation";
import { accountInputSchema, budgetActualSchema, budgetCategoryInputSchema, financialProfileSchema, goalInputSchema, milestoneInputSchema, recurringInputSchema, scenarioInputSchema, transactionInputSchema, transactionPatchSchema } from "@/lib/finance/validation";
import { isLiability, type AccountType } from "@/lib/finance/types";
import { projectionFigures } from "@/lib/finance/recurring";
import { shapeRecurring } from "@/lib/data/finance";

function revalidate() {
  revalidatePath("/", "layout");
}

type Supa = Awaited<ReturnType<typeof createClient>>;

async function snapshotBalance(supabase: Supa, userId: string, accountId: string, date: string, balance: number) {
  await supabase.from("financial_balance_snapshots").upsert({ user_id: userId, account_id: accountId, snapshot_date: date, balance }, { onConflict: "account_id,snapshot_date" });
}

/* ---------------- Profile / assumptions ---------------- */

export async function saveFinancialProfile(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const parsed = financialProfileSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { error } = await supabase.from("financial_profiles").upsert({ user_id: ws.userId, ...parsed.data }, { onConflict: "user_id" });
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Accounts ---------------- */

export async function createAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = accountInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const { actual_payment, original_balance, ...v } = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("financial_accounts")
      .insert({ user_id: ws.userId, ...v, monthly_contribution: v.monthly_contribution ?? 0, include_in_net_worth: v.include_in_net_worth ?? true, last_updated: v.last_updated ?? ws.today })
      .select("id")
      .single();
    if (error) return fail(error.message);
    const id = data.id as string;
    await snapshotBalance(supabase, ws.userId, id, ws.today, v.balance);
    if (isLiability(v.account_type)) {
      const { count } = await supabase.from("financial_debts").select("id", { count: "exact", head: true }).eq("user_id", ws.userId);
      await supabase.from("financial_debts").insert({ user_id: ws.userId, account_id: id, actual_payment: actual_payment ?? v.minimum_payment ?? 0, original_balance: original_balance ?? v.balance, custom_order: count ?? 0 });
    }
    revalidate();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateAccount(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = accountInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const { actual_payment, original_balance, ...v } = parsed.data;
    const supabase = await createClient();
    const { data: existing } = await supabase.from("financial_accounts").select("id,balance,account_type").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Account not found");
    const update: Record<string, unknown> = { ...v };
    const balanceChanged = v.balance != null && Number(v.balance) !== Number(existing.balance);
    if (balanceChanged && v.last_updated === undefined) update.last_updated = ws.today;
    const { error } = await supabase.from("financial_accounts").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    if (balanceChanged) await snapshotBalance(supabase, ws.userId, id, ws.today, v.balance!);
    const type = (v.account_type ?? existing.account_type) as AccountType;
    if (isLiability(type)) {
      const patch: Record<string, unknown> = {};
      if (actual_payment !== undefined) patch.actual_payment = actual_payment ?? 0;
      if (original_balance !== undefined) patch.original_balance = original_balance;
      const { data: debt } = await supabase.from("financial_debts").select("id").eq("account_id", id).maybeSingle();
      if (debt) {
        if (Object.keys(patch).length) await supabase.from("financial_debts").update(patch).eq("id", debt.id);
      } else {
        await supabase.from("financial_debts").insert({ user_id: ws.userId, account_id: id, actual_payment: actual_payment ?? v.minimum_payment ?? 0, original_balance: original_balance ?? v.balance ?? existing.balance });
      }
    } else {
      await supabase.from("financial_debts").delete().eq("account_id", id);
    }
    revalidate();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteAccount(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_accounts").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const accountIdsSchema = z.array(z.string().min(1).max(64)).min(1, "Select at least one account").max(500);

/**
 * Deletes many accounts at once. Balance history, debt details and transactions go with each
 * account (cascade); goals that tracked one lose only the link. Accounts still synced from a
 * connected bank are skipped, because the next sync would recreate them: remove the bank first.
 */
export async function bulkDeleteAccounts(ids: unknown): Promise<ActionResult<{ deleted: number; skippedLinked: number }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = accountIdsSchema.safeParse(ids);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const supabase = await createClient();
    const { data: rows, error: loadErr } = await supabase.from("financial_accounts").select("id,external_provider,plaid_item_id").eq("user_id", ws.userId).in("id", parsed.data);
    if (loadErr) return fail(loadErr.message);
    const accounts = (rows ?? []) as { id: string; external_provider: string | null; plaid_item_id: string | null }[];
    if (!accounts.length) return fail("No matching accounts");
    const linked = accounts.filter((a) => a.external_provider === "plaid" && a.plaid_item_id);
    const deletable = accounts.filter((a) => !linked.includes(a)).map((a) => a.id);
    if (deletable.length) {
      const { error } = await supabase.from("financial_accounts").delete().eq("user_id", ws.userId).in("id", deletable);
      if (error) return fail(error.message);
    }
    revalidate();
    return ok({ deleted: deletable.length, skippedLinked: linked.length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Toggles "include in net worth" for many accounts at once. */
export async function bulkSetAccountsInNetWorth(ids: unknown, include: boolean): Promise<ActionResult<{ updated: number }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = accountIdsSchema.safeParse(ids);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const supabase = await createClient();
    const { data, error } = await supabase.from("financial_accounts").update({ include_in_net_worth: include }).eq("user_id", ws.userId).in("id", parsed.data).select("id");
    if (error) return fail(error.message);
    revalidate();
    return ok({ updated: (data ?? []).length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setDebtOrder(accountIds: string[]): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    await Promise.all(accountIds.map((accountId, i) => supabase.from("financial_debts").update({ custom_order: i }).eq("account_id", accountId).eq("user_id", ws.userId)));
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Goals ---------------- */

export async function createGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = goalInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const { count } = await supabase.from("financial_goals").select("id", { count: "exact", head: true }).eq("user_id", ws.userId);
    const { data, error } = await supabase
      .from("financial_goals")
      .insert({ user_id: ws.userId, ...v, current_amount: v.current_amount ?? 0, monthly_contribution: v.monthly_contribution ?? 0, status: v.status ?? "active", priority: count ?? 0 })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateGoal(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = goalInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { data: existing } = await supabase.from("financial_goals").select("status").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Goal not found");
    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status && parsed.data.status !== existing.status) update.completed_at = parsed.data.status === "completed" ? new Date().toISOString() : null;
    const { error } = await supabase.from("financial_goals").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteGoal(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_goals").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Persists a new priority order (index = priority). */
export async function reorderGoals(ids: string[]): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const results = await Promise.all(ids.map((id, i) => supabase.from("financial_goals").update({ priority: i }).eq("id", id).eq("user_id", ws.userId)));
    const err = results.find((r) => r.error);
    if (err?.error) return fail(err.error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const allocationSchema = z.array(z.object({ goalId: z.string().uuid(), monthly: z.number().min(0).max(1e9) })).max(100);

/** Writes suggested monthly contributions onto goals. */
export async function applyGoalAllocation(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const parsed = allocationSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const supabase = await createClient();
    const results = await Promise.all(parsed.data.map((l) => supabase.from("financial_goals").update({ monthly_contribution: l.monthly }).eq("id", l.goalId).eq("user_id", ws.userId)));
    const err = results.find((r) => r.error);
    if (err?.error) return fail(err.error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const linkProjectSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  new_project_name: z.string().trim().max(200).optional(),
  work_area_id: z.string().uuid().nullable().optional(),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(300), due_date: optionalDate.optional() })).max(20).optional(),
});

/**
 * Connects a financial goal to the rest of FradyOS: links (or creates) a project and optionally
 * creates tasks under it. Shared IDs: goal.linked_project_id ↔ project.id; tasks carry the project id.
 */
export async function linkGoalToProject(goalId: string, input: unknown): Promise<ActionResult<{ projectId: string; taskIds: string[] }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = linkProjectSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: goal } = await supabase.from("financial_goals").select("id,name,target_date,linked_project_id,notes").eq("id", goalId).eq("user_id", ws.userId).maybeSingle();
    if (!goal) return fail("Goal not found");
    let projectId = v.project_id ?? goal.linked_project_id ?? null;
    if (!projectId) {
      const name = v.new_project_name?.trim() || `Goal: ${goal.name}`;
      const { data: p, error } = await supabase
        .from("projects")
        .insert({ user_id: ws.userId, name, work_area_id: v.work_area_id ?? null, status: "active", priority: "normal", links: [], target_date: goal.target_date, description: `Financial goal “${goal.name}” from Finances → Goals.` })
        .select("id")
        .single();
      if (error) return fail(error.message);
      projectId = p.id as string;
    }
    const { error: gErr } = await supabase.from("financial_goals").update({ linked_project_id: projectId }).eq("id", goalId).eq("user_id", ws.userId);
    if (gErr) return fail(gErr.message);
    const taskIds: string[] = [];
    if (v.tasks?.length) {
      const { data: existing } = await supabase.from("tasks").select("title").eq("user_id", ws.userId).eq("project_id", projectId);
      const have = new Set(((existing ?? []) as { title: string }[]).map((t) => t.title.trim().toLowerCase()));
      const rows = v.tasks.filter((t) => !have.has(t.title.trim().toLowerCase())).map((t) => ({ user_id: ws.userId, project_id: projectId, title: t.title, status: "todo", priority: "normal", links: [], due_date: t.due_date ?? null, description: `From financial goal “${goal.name}”.` }));
      if (rows.length) {
        const { data: created, error } = await supabase.from("tasks").insert(rows).select("id");
        if (error) return fail(error.message);
        for (const r of (created ?? []) as { id: string }[]) taskIds.push(r.id);
      }
    }
    revalidate();
    return ok({ projectId, taskIds });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Scenarios ---------------- */

export async function createScenario(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = scenarioInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const { changes, ...v } = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.from("financial_scenarios").insert({ user_id: ws.userId, ...v, is_favorite: v.is_favorite ?? false, assumptions: { changes } }).select("id").single();
    if (error) return fail(error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateScenario(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = scenarioInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const { changes, ...v } = parsed.data;
    const supabase = await createClient();
    const update: Record<string, unknown> = { ...v };
    if (changes) update.assumptions = { changes };
    const { error } = await supabase.from("financial_scenarios").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteScenario(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_scenarios").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Milestones ---------------- */

export async function createMilestone(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = milestoneInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { data, error } = await supabase.from("financial_milestones").insert({ user_id: ws.userId, ...parsed.data, milestone_type: parsed.data.milestone_type ?? "custom", is_done: parsed.data.is_done ?? false }).select("id").single();
    if (error) return fail(error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateMilestone(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = milestoneInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { error } = await supabase.from("financial_milestones").update(parsed.data).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteMilestone(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_milestones").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Budget ---------------- */

export async function saveBudgetCategory(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = (id ? budgetCategoryInputSchema.partial() : budgetCategoryInputSchema).safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("financial_budget_categories").update(parsed.data).eq("id", id).eq("user_id", ws.userId);
      if (error) return fail(error.code === "23505" ? "A category with that name already exists" : error.message);
      revalidate();
      return ok({ id });
    }
    const { count } = await supabase.from("financial_budget_categories").select("id", { count: "exact", head: true }).eq("user_id", ws.userId);
    const { data, error } = await supabase.from("financial_budget_categories").insert({ user_id: ws.userId, ...parsed.data, kind: parsed.data.kind ?? "expense", budgeted: parsed.data.budgeted ?? 0, sort_order: count ?? 0 }).select("id").single();
    if (error) return fail(error.code === "23505" ? "A category with that name already exists" : error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function archiveBudgetCategory(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_budget_categories").update({ is_archived: true }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function saveBudgetActual(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const parsed = budgetActualSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const supabase = await createClient();
    const { error } = await supabase.from("financial_budget_actuals").upsert({ user_id: ws.userId, ...parsed.data }, { onConflict: "category_id,month" });
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Recurring ---------------- */

const idListSchema = z.array(z.string().min(1).max(64)).min(1, "Select at least one row").max(1000);

export async function saveRecurring(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = (id ? recurringInputSchema.partial() : recurringInputSchema).safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("financial_recurring").update(parsed.data).eq("id", id).eq("user_id", ws.userId);
      if (error) return fail(error.message);
      revalidate();
      return ok({ id });
    }
    const { count } = await supabase.from("financial_recurring").select("id", { count: "exact", head: true }).eq("user_id", ws.userId);
    const { data, error } = await supabase.from("financial_recurring").insert({ user_id: ws.userId, ...parsed.data, sort_order: count ?? 0 }).select("id").single();
    if (error) return fail(error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteRecurring(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("financial_recurring").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Copies the recurring monthly equivalents into the projection assumptions (income and fixed expenses). Variable spending is left alone. */
export async function applyRecurringToProfile(): Promise<ActionResult<{ income: number; fixed: number }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const [items, accounts] = await Promise.all([
      supabase.from("financial_recurring").select("*").eq("user_id", ws.userId),
      supabase.from("financial_accounts").select("id,balance,is_archived").eq("user_id", ws.userId),
    ]);
    if (items.error) return fail(items.error.message);
    if (accounts.error) return fail(accounts.error.message);
    const figures = projectionFigures(
      ((items.data ?? []) as Record<string, unknown>[]).map(shapeRecurring),
      ((accounts.data ?? []) as { id: string; balance: number | string; is_archived: boolean }[]).map((a) => ({ id: a.id, balance: Number(a.balance) || 0, is_archived: a.is_archived })),
    );
    const { error } = await supabase.from("financial_profiles").upsert({ user_id: ws.userId, monthly_income: figures.income, fixed_expenses: figures.fixed }, { onConflict: "user_id" });
    if (error) return fail(error.message);
    revalidate();
    return ok({ income: figures.income, fixed: figures.fixed });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/* ---------------- Transactions ---------------- */

export async function addTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { data: acc, error: accErr } = await supabase.from("financial_accounts").select("id").eq("id", parsed.data.account_id).eq("user_id", ws.userId).maybeSingle();
    if (accErr) return fail(accErr.message);
    if (!acc) return fail("That account does not exist");
    const { data, error } = await supabase
      .from("financial_transactions")
      .insert({ user_id: ws.userId, ...parsed.data, merchant_name: parsed.data.description, source: "manual", pending: false })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidate();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function patchTransactions(ids: unknown, input: unknown): Promise<ActionResult<{ updated: number }>> {
  try {
    const ws = await requireWorkspace();
    const parsedIds = idListSchema.safeParse(ids);
    if (!parsedIds.success) return fail(firstZodMessage(parsedIds.error));
    const parsed = transactionPatchSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const patch: Record<string, unknown> = {};
    if (parsed.data.category_id !== undefined) patch.category_id = parsed.data.category_id;
    if (parsed.data.transaction_type !== undefined) patch.transaction_type = parsed.data.transaction_type;
    if (!Object.keys(patch).length) return fail("Nothing to change");
    const supabase = await createClient();
    const { data, error } = await supabase.from("financial_transactions").update(patch).eq("user_id", ws.userId).in("id", parsedIds.data).select("id");
    if (error) return fail(error.message);
    revalidate();
    return ok({ updated: (data ?? []).length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteTransactions(ids: unknown): Promise<ActionResult<{ deleted: number }>> {
  try {
    const ws = await requireWorkspace();
    const parsedIds = idListSchema.safeParse(ids);
    if (!parsedIds.success) return fail(firstZodMessage(parsedIds.error));
    const supabase = await createClient();
    const { data, error } = await supabase.from("financial_transactions").delete().eq("user_id", ws.userId).in("id", parsedIds.data).select("id");
    if (error) return fail(error.message);
    revalidate();
    return ok({ deleted: (data ?? []).length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
