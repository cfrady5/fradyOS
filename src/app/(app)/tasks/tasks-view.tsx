"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckSquare, LayoutList, Columns3, CalendarDays, Plus, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, TaskRow, SectionHeader } from "@/components/app/items";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { completeTask, reopenTask } from "@/actions/tasks";
import { PRIORITIES, TASK_STATUSES, type TaskWithRefs } from "@/lib/types";
import { dueBucket, relativeDayLabel } from "@/lib/dates";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";

type Params = { area: string | null; project: string | null; status: string | null; priority: string | null; due: string | null; q: string | null };

export function TasksView({ tasks, view, month, params }: { tasks: TaskWithRefs[]; view: "list" | "board" | "calendar"; month: string; params: Params }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { workAreas, projects, today } = useWorkspace();
  const { openQuickAdd } = useShell();
  const [q, setQ] = React.useState(params.q ?? "");
  const [group, setGroup] = React.useState<"due" | "status" | "project" | "area">("due");
  const [, startTransition] = React.useTransition();

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((q || null) !== params.q) setParams({ q: q || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function toggle(task: TaskWithRefs) {
    startTransition(async () => {
      const res = task.status === "completed" ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  const activeFilters = Object.entries(params).filter(([k, v]) => v && k !== "q").length;
  const visibleProjects = projects.filter((p) => !params.area || p.work_area_id === params.area);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Tasks"
        actions={
          <Button onClick={() => openQuickAdd({ project_id: params.project, work_area_id: params.area })}>
            <Plus /> New task
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setParams({ view: v === "list" ? null : v })}>
              <TabsList>
                <TabsTrigger value="list"><LayoutList /> List</TabsTrigger>
                <TabsTrigger value="board"><Columns3 /> Board</TabsTrigger>
                <TabsTrigger value="calendar"><CalendarDays /> Calendar</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles…" className="pl-8" aria-label="Search tasks" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="w-40" value={params.area ?? ""} onChange={(e) => setParams({ area: e.target.value || null, project: null })} aria-label="Work area">
              <option value="">All work areas</option>
              {workAreas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-44" value={params.project ?? ""} onChange={(e) => setParams({ project: e.target.value || null })} aria-label="Project">
              <option value="">All projects</option>
              {visibleProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </NativeSelect>
            {view !== "board" ? (
              <NativeSelect className="w-40" value={params.status ?? ""} onChange={(e) => setParams({ status: e.target.value || null })} aria-label="Status">
                <option value="">Open</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
                <option value="all">All incl. completed</option>
              </NativeSelect>
            ) : null}
            <NativeSelect className="w-32" value={params.priority ?? ""} onChange={(e) => setParams({ priority: e.target.value || null })} aria-label="Priority">
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </NativeSelect>
            {view !== "calendar" ? (
              <NativeSelect className="w-36" value={params.due ?? ""} onChange={(e) => setParams({ due: e.target.value || null })} aria-label="Due date">
                <option value="">Any due date</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due today</option>
                <option value="week">Next 7 days</option>
                <option value="month">Next 30 days</option>
                <option value="none">No due date</option>
              </NativeSelect>
            ) : null}
            {view === "list" ? (
              <NativeSelect className="w-40" value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label="Group by">
                <option value="due">Group: due date</option>
                <option value="status">Group: status</option>
                <option value="project">Group: project</option>
                <option value="area">Group: work area</option>
              </NativeSelect>
            ) : null}
            {activeFilters ? (
              <Button variant="ghost" size="sm" onClick={() => setParams({ area: null, project: null, status: null, priority: null, due: null })}>
                <X /> Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </PageHeader>

      {view === "list" ? (
        tasks.length === 0 ? (
          <EmptyState icon={<CheckSquare />} title={activeFilters || params.q ? "No tasks match these filters" : "No open tasks"} description={activeFilters || params.q ? "Try clearing a filter." : "Press N anywhere to capture a task."} action={<Button onClick={() => openQuickAdd()}><Plus /> New task</Button>} />
        ) : (
          <div className="flex flex-col gap-5">
            {groupTasks(tasks, group, today).map((g) => (
              <section key={g.key}>
                <SectionHeader title={g.label} count={g.tasks.length} />
                <div className="flex flex-col gap-1.5">
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : view === "board" ? (
        <TaskBoard tasks={tasks} />
      ) : (
        <TaskCalendar tasks={tasks} month={month} onMonthChange={(m) => setParams({ month: m })} />
      )}
    </div>
  );
}

function groupTasks(tasks: TaskWithRefs[], group: "due" | "status" | "project" | "area", today: string) {
  const buckets = new Map<string, { key: string; label: string; order: number; tasks: TaskWithRefs[] }>();
  const add = (key: string, label: string, order: number, t: TaskWithRefs) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, order, tasks: [] });
    buckets.get(key)!.tasks.push(t);
  };
  for (const t of tasks) {
    if (group === "due") {
      const b = t.status === "completed" ? "done" : dueBucket(t.due_date, today);
      const labels: Record<string, [string, number]> = { overdue: ["Overdue", 0], today: ["Due today", 1], tomorrow: ["Due tomorrow", 2], week: ["Next 7 days", 3], later: ["Later", 4], none: ["No due date", 5], done: ["Completed", 6] };
      const [label, order] = labels[b];
      if (b === "week" || b === "later") add(b + (t.due_date ?? ""), b === "week" ? relativeDayLabel(t.due_date!, today) : label, order + (b === "week" ? 0 : 0), t);
      else add(b, label, order, t);
    } else if (group === "status") {
      const i = TASK_STATUSES.findIndex((s) => s.value === t.status);
      add(t.status, TASK_STATUSES[i]?.label ?? t.status, i, t);
    } else if (group === "project") {
      add(t.project?.id ?? "none", t.project?.name ?? "No project", t.project ? 0 : 1, t);
    } else {
      add(t.work_area?.id ?? "none", t.work_area?.name ?? "No work area", t.work_area ? 0 : 1, t);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
