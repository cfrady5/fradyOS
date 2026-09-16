"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { getTaskDetail, type TaskDetail } from "@/lib/data/tasks";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { taskInputSchema, firstZodMessage, zodFieldErrors, optionalDate, taskStatusSchema } from "@/lib/validation";
import { nextOccurrence } from "@/lib/recurrence";
import { diffDays, addDays } from "@/lib/dates";
import type { Task, TaskStatus } from "@/lib/types";

function revalidateAll() {
  revalidatePath("/", "layout");
}

async function logActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskId: string,
  kind: string,
  extra: { from_status?: string | null; to_status?: string | null; detail?: string | null } = {},
) {
  await supabase.from("task_activity").insert({ user_id: userId, task_id: taskId, kind, ...extra });
}

export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = taskInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const status = v.status ?? "todo";
    const payload = {
      user_id: ws.userId,
      ...v,
      status,
      priority: v.priority ?? "normal",
      links: v.links ?? [],
      recurrence: v.recurrence ?? null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    };
    const { data, error } = await supabase.from("tasks").insert(payload).select("id").single();
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, data.id, "created", { to_status: status });
    revalidateAll();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateTask(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = taskInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: existing } = await supabase.from("tasks").select("*").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Task not found");
    const prev = existing as Task;

    const update: Record<string, unknown> = { ...v };
    if (v.recurrence === undefined) delete update.recurrence;

    // Keep completed_at consistent with status.
    if (v.status && v.status !== prev.status) {
      if (v.status === "completed") update.completed_at = new Date().toISOString();
      else if (prev.status === "completed") update.completed_at = null;
    }
    // Track manual date overrides for template-derived tasks.
    if (prev.template_item_id && v.due_date !== undefined && v.due_date !== prev.due_date) {
      update.date_overridden = true;
    }
    // Leaving the waiting state clears the received marker if re-entering later.
    const { error } = await supabase.from("tasks").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);

    if (v.status && v.status !== prev.status) {
      const kind = v.status === "completed" ? "completed" : prev.status === "completed" ? "reopened" : "status_changed";
      await logActivity(supabase, ws.userId, id, kind, { from_status: prev.status, to_status: v.status });
      if (v.status === "completed") await spawnNextRecurrence(supabase, ws.userId, { ...prev, ...update } as Task, ws.today);
    }
    if (v.due_date !== undefined && v.due_date !== prev.due_date) {
      await logActivity(supabase, ws.userId, id, "rescheduled", { detail: `Due ${prev.due_date ?? "none"} → ${v.due_date ?? "none"}` });
    }
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<ActionResult<{ id: string }>> {
  const parsed = taskStatusSchema.safeParse(status);
  if (!parsed.success) return fail("Invalid status");
  return updateTask(id, { status: parsed.data });
}

export async function completeTask(id: string): Promise<ActionResult<{ id: string; nextId?: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("tasks").select("*").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Task not found");
    const prev = existing as Task;
    if (prev.status === "completed") return ok({ id });
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tasks")
      .update({ status: "completed", completed_at: now, focus_rank: null })
      .eq("id", id)
      .eq("user_id", ws.userId);
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, id, "completed", { from_status: prev.status, to_status: "completed" });
    const nextId = await spawnNextRecurrence(supabase, ws.userId, prev, ws.today);
    revalidateAll();
    return ok({ id, nextId: nextId ?? undefined });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function reopenTask(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("tasks").select("status").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Task not found");
    const { error } = await supabase
      .from("tasks")
      .update({ status: "todo", completed_at: null })
      .eq("id", id)
      .eq("user_id", ws.userId);
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, id, "reopened", { from_status: "completed", to_status: "todo" });
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/**
 * When a recurring task is completed, create the next instance. The unique index on
 * (recurrence_parent_id, due_date) guarantees at most one child per due date.
 */
async function spawnNextRecurrence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  task: Task,
  today: string,
): Promise<string | null> {
  const rule = task.recurrence;
  if (!rule || !rule.freq) return null;
  const basisDate = rule.basis === "completion" ? today : task.due_date ?? task.planned_date ?? today;
  let nextDue = nextOccurrence(rule, basisDate);
  // Never generate occurrences that are already in the past (e.g. after a long gap).
  while (nextDue && nextDue < today) {
    const n = nextOccurrence(rule, nextDue);
    if (!n || n === nextDue) break;
    nextDue = n;
  }
  if (!nextDue) return null;
  const shift = task.due_date ? diffDays(task.due_date, nextDue) : null;
  const plannedNext = task.planned_date && shift !== null ? addDays(task.planned_date, shift) : task.planned_date ? nextDue : null;
  const parentId = task.recurrence_parent_id ?? task.id;
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      work_area_id: task.work_area_id,
      project_id: task.project_id,
      event_id: task.event_id,
      title: task.title,
      description: task.description,
      status: "todo",
      priority: task.priority,
      planned_date: plannedNext,
      due_date: nextDue,
      due_time: task.due_time,
      estimated_minutes: task.estimated_minutes,
      links: task.links ?? [],
      notes: task.notes,
      recurrence: rule,
      recurrence_parent_id: parentId,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique_violation: the next occurrence already exists.
    if ((error as { code?: string }).code === "23505") return null;
    console.error("recurrence spawn failed", error.message);
    return null;
  }
  await logActivity(supabase, userId, data.id, "created", { detail: "Recurring instance" });
  return data.id as string;
}

export async function deleteTask(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidateAll();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function loadTask(id: string): Promise<ActionResult<TaskDetail>> {
  try {
    const ws = await requireWorkspace();
    const detail = await getTaskDetail(ws.userId, id);
    if (!detail) return fail("Task not found");
    return ok(detail);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Sets or clears the planned work date only. The deadline is never touched here. */
export async function setPlannedDate(id: string, planned: string | null): Promise<ActionResult<{ id: string }>> {
  const p = optionalDate.safeParse(planned ?? "");
  if (!p.success) return fail("Invalid date");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ planned_date: p.data }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

// ---------------------------------------------------------------------------
// Focus (top three priorities)
// ---------------------------------------------------------------------------
export async function setFocus(taskIds: string[]): Promise<ActionResult<undefined>> {
  const parsed = z.array(z.string().uuid()).max(3).safeParse(taskIds);
  if (!parsed.success) return fail("Pick up to three tasks");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    // Clear first so the unique (user, rank) index never collides.
    const clear = await supabase.from("tasks").update({ focus_rank: null }).eq("user_id", ws.userId).not("focus_rank", "is", null);
    if (clear.error) return fail(clear.error.message);
    for (let i = 0; i < parsed.data.length; i++) {
      const { error } = await supabase.from("tasks").update({ focus_rank: i + 1 }).eq("id", parsed.data[i]).eq("user_id", ws.userId);
      if (error) return fail(error.message);
    }
    revalidateAll();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function toggleFocus(taskId: string): Promise<ActionResult<{ focused: boolean }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("tasks")
      .select("id,focus_rank")
      .eq("user_id", ws.userId)
      .not("focus_rank", "is", null)
      .order("focus_rank");
    const current = (rows ?? []) as { id: string; focus_rank: number }[];
    if (current.some((r) => r.id === taskId)) {
      await supabase.from("tasks").update({ focus_rank: null }).eq("id", taskId).eq("user_id", ws.userId);
      revalidateAll();
      return ok({ focused: false });
    }
    if (current.length >= 3) return fail("You already have three priorities. Remove one first.");
    const used = new Set(current.map((r) => r.focus_rank));
    const rank = [1, 2, 3].find((r) => !used.has(r)) ?? 1;
    const { error } = await supabase.from("tasks").update({ focus_rank: rank }).eq("id", taskId).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidateAll();
    return ok({ focused: true });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------
export async function addSubtask(taskId: string, title: string): Promise<ActionResult<{ id: string }>> {
  const t = title.trim();
  if (!t) return fail("Enter a subtask");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { count } = await supabase.from("subtasks").select("id", { count: "exact", head: true }).eq("task_id", taskId);
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ user_id: ws.userId, task_id: taskId, title: t.slice(0, 300), sort_order: count ?? 0 })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidateAll();
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function toggleSubtask(id: string, done: boolean): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("subtasks").update({ is_done: done }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidateAll();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteSubtask(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("subtasks").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidateAll();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

// ---------------------------------------------------------------------------
// Waiting-on actions
// ---------------------------------------------------------------------------
export async function recordFollowUp(
  id: string,
  input: { next_followup_date?: string | null; note?: string | null },
): Promise<ActionResult<{ id: string }>> {
  const schema = z.object({ next_followup_date: optionalDate.optional(), note: z.string().max(2000).optional().nullable() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(firstZodMessage(parsed.error));
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("tasks").select("waiting_notes").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Task not found");
    const noteLine = parsed.data.note?.trim() ? `${ws.today}: ${parsed.data.note.trim()}` : `${ws.today}: Followed up`;
    const notes = [existing.waiting_notes, noteLine].filter(Boolean).join("\n");
    const update: Record<string, unknown> = { waiting_last_followup_date: ws.today, waiting_notes: notes };
    if (parsed.data.next_followup_date !== undefined) update.waiting_followup_date = parsed.data.next_followup_date;
    const { error } = await supabase.from("tasks").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, id, "followup_recorded", { detail: noteLine });
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function rescheduleFollowUp(id: string, date: string | null): Promise<ActionResult<{ id: string }>> {
  const p = optionalDate.safeParse(date ?? "");
  if (!p.success) return fail("Invalid date");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ waiting_followup_date: p.data }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, id, "followup_rescheduled", { detail: `Follow-up → ${p.data ?? "none"}` });
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function markReceived(id: string, outcome: "complete" | "todo"): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("tasks").select("*").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Task not found");
    const prev = existing as Task;
    const now = new Date().toISOString();
    const update =
      outcome === "complete"
        ? { waiting_received_at: now, status: "completed", completed_at: now, focus_rank: null }
        : { waiting_received_at: now, status: "todo", completed_at: null };
    const { error } = await supabase.from("tasks").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    await logActivity(supabase, ws.userId, id, "received", { from_status: prev.status, to_status: update.status, detail: `Received from ${prev.waiting_person ?? "someone"}` });
    if (outcome === "complete") await spawnNextRecurrence(supabase, ws.userId, prev, ws.today);
    revalidateAll();
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
