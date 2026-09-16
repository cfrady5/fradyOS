import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { listTasks, type TaskFilters } from "@/lib/data/tasks";
import { TasksView } from "./tasks-view";
import { addDays, endOfMonth, startOfMonth, isoDaysAgo } from "@/lib/dates";

export const metadata: Metadata = { title: "Tasks" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : null;
}

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const view = (str(sp.view) ?? "list") as "list" | "board" | "calendar";
  const due = str(sp.due) as TaskFilters["due"];
  const status = str(sp.status);
  const month = str(sp.month) ?? ws.today.slice(0, 7);

  const filters: TaskFilters = {
    today: ws.today,
    area: str(sp.area),
    project: str(sp.project),
    status: view === "board" ? "all" : status ?? undefined,
    priority: str(sp.priority),
    due: view === "calendar" ? null : due,
    q: str(sp.q),
    includeCompleted: view === "board" || status === "completed" || status === "all",
    limit: view === "board" ? 600 : 500,
  };

  let tasks = await listTasks(ws.userId, filters);

  if (view === "board") {
    // Board shows recently completed only, to keep the Done column useful.
    const cutoff = isoDaysAgo(14);
    tasks = tasks.filter((t) => t.status !== "completed" || (t.completed_at && t.completed_at >= cutoff));
  }
  if (view === "calendar") {
    const from = addDays(startOfMonth(`${month}-01`), -7);
    const to = addDays(endOfMonth(`${month}-01`), 7);
    tasks = tasks.filter((t) => (t.due_date && t.due_date >= from && t.due_date <= to) || (t.planned_date && t.planned_date >= from && t.planned_date <= to));
  }

  return <TasksView tasks={tasks} view={view} month={month} params={{ area: filters.area ?? null, project: filters.project ?? null, status, priority: filters.priority ?? null, due: due ?? null, q: filters.q ?? null }} />;
}
