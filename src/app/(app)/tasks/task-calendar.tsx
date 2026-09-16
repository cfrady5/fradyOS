"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarClock, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setPlannedDate } from "@/actions/tasks";
import { useWorkspace } from "@/components/app/workspace-provider";
import { useOpenItem } from "@/hooks/use-open-item";
import type { TaskWithRefs } from "@/lib/types";
import { addMonths, formatDate, monthGrid, weekdayNames } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Month calendar of task deadlines and planned work dates.
 * Dragging a task moves its PLANNED date only; deadlines are never changed by drag.
 */
export function TaskCalendar({ tasks, month, onMonthChange }: { tasks: TaskWithRefs[]; month: string; onMonthChange: (m: string) => void }) {
  const router = useRouter();
  const { today, weekStartsOn } = useWorkspace();
  const { openTask } = useOpenItem();
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const anchor = `${month}-01`;
  const weeks = monthGrid(anchor, weekStartsOn);

  function drop(date: string, id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    startTransition(async () => {
      const res = await setPlannedDate(id, date);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Planned for ${formatDate(date, "weekday", today)}. Deadline unchanged${t.due_date ? ` (${formatDate(t.due_date, "medium", today)})` : ""}.`);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => onMonthChange(addMonths(anchor, -1).slice(0, 7))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => onMonthChange(addMonths(anchor, 1).slice(0, 7))}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(today.slice(0, 7))}>
            Today
          </Button>
          <h2 className="ml-2 text-sm font-semibold">{formatDate(anchor, "monthYear")}</h2>
        </div>
        <div className="text-muted-foreground hidden items-center gap-3 text-xs sm:flex">
          <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" /> Deadline</span>
          <span className="inline-flex items-center gap-1"><Hammer className="size-3" /> Planned work (drag to move)</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted/50 grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {weekdayNames(weekStartsOn).map((d) => (
            <div key={d} className="py-1.5">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-t">
            {week.map((date) => {
              const inMonth = date.startsWith(month);
              const due = tasks.filter((t) => t.due_date === date);
              const planned = tasks.filter((t) => t.planned_date === date && t.due_date !== date);
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={cn("min-h-24 border-r p-1 last:border-r-0", !inMonth && "bg-muted/30 text-muted-foreground", dragOver === date && "bg-accent")}
                  onDragOver={(e) => { e.preventDefault(); if (dragOver !== date) setDragOver(date); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/task-id"); if (id) drop(date, id); }}
                >
                  <div className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums", isToday && "bg-primary text-primary-foreground font-semibold")}>{parseInt(date.slice(8), 10)}</div>
                  <div className="flex flex-col gap-0.5">
                    {due.map((t) => (
                      <button key={"d" + t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)} onClick={() => openTask(t.id)} className={cn("truncate rounded px-1 py-0.5 text-left text-[11px] leading-4", t.status === "completed" ? "bg-success/15 text-success line-through" : date < today ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")} title={`Deadline: ${t.title}`}>
                        <CalendarClock className="mr-0.5 inline size-3" /> {t.title}
                      </button>
                    ))}
                    {planned.map((t) => (
                      <button key={"p" + t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)} onClick={() => openTask(t.id)} className="truncate rounded border border-dashed px-1 py-0.5 text-left text-[11px] leading-4" title={`Planned: ${t.title}`}>
                        <Hammer className="mr-0.5 inline size-3" /> {t.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs sm:hidden">
        <Badge variant="muted">Drag</Badge> moves planned work dates only. Deadlines never change from this view.
      </p>
    </div>
  );
}
