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
            className={cn("bg-surface-1 border-line-1 flex w-72 shrink-0 flex-col rounded-lg border p-2 transition-colors duration-150", dragOver === col.value && "border-brand/50 bg-surface-2")}
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
            <div className="border-line-1 mb-2 flex h-8 items-center justify-between border-b px-1.5">
              <h3 className="eyebrow">{col.label}</h3>
              <span className="index">{items.length}</span>
            </div>
            <div className="flex min-h-16 flex-col gap-1.5">
              {items.map((t) => (
                <div key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/task-id", t.id); e.dataTransfer.effectAllowed = "move"; }} className="group/card border-line-1 bg-surface-0/40 hover:border-line-2 cursor-grab rounded-md border px-1 transition-colors active:cursor-grabbing">
                  <TaskRow task={t} onToggleComplete={toggle} dense trailing={<GripVertical className="text-text-3 size-4 opacity-50 group-hover/card:opacity-100" aria-hidden />} />
                </div>
              ))}
              {items.length === 0 ? <p className="text-text-3 border-line-1 rounded-md border border-dashed px-1 py-3 text-center text-xs">Drop tasks here</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
