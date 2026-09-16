import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, Note, Subtask, Task, TaskActivity, TaskWithRefs } from "@/lib/types";

export const TASK_SELECT =
  "*, project:projects(id,name), work_area:work_areas(id,name,color), event:events(id,name,start_date), subtasks(id,is_done)";

type RawTask = Task & {
  project: { id: string; name: string } | null;
  work_area: { id: string; name: string; color: string } | null;
  event: { id: string; name: string; start_date: string | null } | null;
  subtasks?: { id: string; is_done: boolean }[] | null;
};

export function shapeTask(row: RawTask): TaskWithRefs {
  const subs = row.subtasks ?? [];
  const { subtasks: _s, ...rest } = row;
  void _s;
  return {
    ...rest,
    links: Array.isArray(rest.links) ? rest.links : [],
    subtask_total: subs.length,
    subtask_done: subs.filter((s) => s.is_done).length,
  };
}

export type TaskFilters = {
  area?: string | null;
  project?: string | null;
  event?: string | null;
  status?: string | null; // comma-separated statuses or "open"
  priority?: string | null;
  due?: "overdue" | "today" | "week" | "month" | "none" | "any" | null;
  q?: string | null;
  includeCompleted?: boolean;
  today: string;
  limit?: number;
};

export async function listTasks(userId: string, f: TaskFilters): Promise<TaskWithRefs[]> {
  const supabase = await createClient();
  let q = supabase.from("tasks").select(TASK_SELECT).eq("user_id", userId);

  if (f.area) q = q.eq("work_area_id", f.area);
  if (f.project) q = q.eq("project_id", f.project);
  if (f.event) q = q.eq("event_id", f.event);
  if (f.priority) q = q.eq("priority", f.priority);

  if (f.status && f.status !== "all") {
    if (f.status === "open") q = q.neq("status", "completed");
    else q = q.in("status", f.status.split(","));
  } else if (!f.includeCompleted) {
    q = q.neq("status", "completed");
  }

  if (f.due && f.due !== "any") {
    if (f.due === "overdue") q = q.lt("due_date", f.today);
    else if (f.due === "today") q = q.eq("due_date", f.today);
    else if (f.due === "week") q = q.gte("due_date", f.today).lte("due_date", addDaysStr(f.today, 7));
    else if (f.due === "month") q = q.gte("due_date", f.today).lte("due_date", addDaysStr(f.today, 30));
    else if (f.due === "none") q = q.is("due_date", null);
  }

  if (f.q) q = q.ilike("title", `%${f.q.replace(/[%_]/g, "")}%`);

  q = q
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(f.limit ?? 500);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawTask[]).map(shapeTask);
}

function addDaysStr(s: string, n: number) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export type TaskDetail = {
  task: TaskWithRefs;
  subtasks: Subtask[];
  notes: Note[];
  attachments: Attachment[];
  activity: TaskActivity[];
};

export async function getTaskDetail(userId: string, id: string): Promise<TaskDetail | null> {
  const supabase = await createClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) return null;

  const [subs, notes, atts, act] = await Promise.all([
    supabase.from("subtasks").select("*").eq("task_id", id).order("sort_order").order("created_at"),
    supabase.from("notes").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    supabase.from("attachments").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    supabase.from("task_activity").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  return {
    task: shapeTask(task as RawTask),
    subtasks: (subs.data ?? []) as Subtask[],
    notes: (notes.data ?? []) as Note[],
    attachments: (atts.data ?? []) as Attachment[],
    activity: (act.data ?? []) as TaskActivity[],
  };
}

/** Lightweight option lists for selects. */
export async function listProjectOptions(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id,name,work_area_id,status")
    .eq("user_id", userId)
    .not("status", "in", "(archived)")
    .order("name");
  return (data ?? []) as { id: string; name: string; work_area_id: string | null; status: string }[];
}
