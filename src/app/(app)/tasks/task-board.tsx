"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import { TaskRow } from "@/components/app/items";
import { setTaskStatus, completeTask, reopenTask } from "@/actions/tasks";
import { TASK_STATUSES, type TaskStatus, type TaskWithRefs } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Kanban board with native drag-and-drop between status columns. */
export function TaskBoard({ tasks }: { tasks: TaskWithRefs[] }) {
  const router = useRouter();
  const [local, setLocal] = React.useState(tasks);
  const [prevTasks, setPrevTasks] = React.useState(tasks);
  const [dragOver, setDragOver] = React.useState<TaskStatus | null>(null);
  const [, startTransition] = React.useTransition();
  if (prevTasks !== tasks) {
    // Server data changed (after refresh): adopt it as the new optimistic baseline.
    setPrevTasks(tasks);
    setLocal(tasks);
  }

  function move(id: string, status: TaskStatus) {
    const t = local.find((x) => x.id === id);
    if (!t || t.status === status) return;
    setLocal((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
    startTransition(async () => {
      const res = status === "completed" ? await completeTask(id) : t.status === "completed" ? await reopenTask(id).then((r) => (r.ok && status !== "todo" ? setTaskStatus(id, status) : r)) : await setTaskStatus(id, status);
      if (!res.ok) {
        toast.error(res.error);
        setLocal(tasks);
      } else router.refresh();
    });
  }

  function toggle(task: TaskWithRefs) {
    move(task.id, task.status === "completed" ? "todo" : "completed");
  }

  return (
    <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-3 md:-mx-6 md:px-6">
      {TASK_STATUSES.map((col) => {
        const items = local.filter((t) => t.status === col.value);
        return (
          <div
            key={col.value}
            className={cn("bg-muted/40 flex w-72 shrink-0 flex-col rounded-lg border p-2 transition-colors", dragOver === col.value && "bg-accent ring-2 ring-ring/40")}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOver !== col.value) setDragOver(col.value);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/task-id");
              if (id) move(id, col.value);
            }}
            aria-label={`${col.label} column`}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide">{col.label}</h3>
              <span className="text-muted-foreground text-xs tabular-nums">{items.length}</span>
            </div>
            <div className="flex min-h-16 flex-col gap-1.5">
              {items.map((t) => (
                <div key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/task-id", t.id); e.dataTransfer.effectAllowed = "move"; }} className="group/card cursor-grab active:cursor-grabbing">
                  <TaskRow task={t} onToggleComplete={toggle} dense trailing={<GripVertical className="text-muted-foreground/50 size-4" aria-hidden />} />
                </div>
              ))}
              {items.length === 0 ? <p className="text-muted-foreground px-1 py-3 text-center text-xs">Drop tasks here</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
