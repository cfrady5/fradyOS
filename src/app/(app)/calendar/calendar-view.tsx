"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app/items";
import { useWorkspace } from "@/components/app/workspace-provider";
import { useOpenItem } from "@/hooks/use-open-item";
import { setPlannedDate } from "@/actions/tasks";
import { KIND_META, type CalendarItem, type CalendarItemKind } from "@/lib/calendar-kinds";
import { addDays, addMonths, eachDay, formatDate, monthGrid, weekdayNames, relativeDayLabel, formatTime, startOfWeek, endOfWeek } from "@/lib/dates";
import { cn } from "@/lib/utils";

const ALL_KINDS = Object.keys(KIND_META) as CalendarItemKind[];
const PRESETS: Record<string, CalendarItemKind[]> = {
  all: ALL_KINDS,
  content: ["event", "social_publish", "social_draft", "social_approval"],
  work: ["due", "planned", "followup", "delivery"],
};

export function CalendarView({ items, view, date, from, to, preset, types }: { items: CalendarItem[]; view: "month" | "week" | "agenda"; date: string; from: string; to: string; preset: string | null; types: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { today, weekStartsOn } = useWorkspace();
  const { openTask, openPost } = useOpenItem();
  const [, startTransition] = React.useTransition();

  const active = React.useMemo<Set<CalendarItemKind>>(() => {
    if (types) return new Set(types.split(",").filter((k): k is CalendarItemKind => ALL_KINDS.includes(k as CalendarItemKind)));
    if (preset && PRESETS[preset]) return new Set(PRESETS[preset]);
    return new Set(ALL_KINDS);
  }, [types, preset]);

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function toggleKind(k: CalendarItemKind) {
    const next = new Set(active);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setParams({ types: next.size === ALL_KINDS.length ? null : Array.from(next).join(","), preset: null });
  }

  function open(item: CalendarItem) {
    if (item.entityType === "task") openTask(item.entityId);
    else if (item.entityType === "social") openPost(item.entityId);
    else if (item.entityType === "finance") router.push(item.id.startsWith("finance_goal") ? "/finances/goals" : "/finances/timeline");
    else router.push(`/events/${item.entityId}`);
  }

  function dropPlanned(dateStr: string, taskId: string) {
    startTransition(async () => {
      const res = await setPlannedDate(taskId, dateStr);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Planned for ${formatDate(dateStr, "weekday", today)}. Deadline unchanged.`);
      router.refresh();
    });
  }

  const visible = items.filter((i) => active.has(i.kind));
  const step = view === "month" ? (d: string, n: number) => addMonths(d, n) : view === "week" ? (d: string, n: number) => addDays(d, 7 * n) : (d: string, n: number) => addDays(d, 30 * n);
  const title = view === "month" ? formatDate(date, "monthYear") : view === "week" ? `${formatDate(startOfWeek(date, weekStartsOn), "medium", today)} – ${formatDate(endOfWeek(date, weekStartsOn), "medium", today)}` : `${formatDate(from, "medium", today)} – ${formatDate(to, "medium", today)}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Calendar"
        description="Events, deadlines, planned work, follow-ups and social publishing in one place. Monday.com dates are read-only here."
        actions={
          <Tabs value={view} onValueChange={(v) => setParams({ view: v === "month" ? null : v })}>
            <TabsList aria-label="View">
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="agenda">Agenda</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => setParams({ date: step(date, -1) })}><ChevronLeft /></Button>
            <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => setParams({ date: step(date, 1) })}><ChevronRight /></Button>
            <Button variant="ghost" size="sm" onClick={() => setParams({ date: null })}>Today</Button>
            <h2 className="text-heading nums ml-1">{title}</h2>
            <div className="ml-auto flex items-center gap-1" role="group" aria-label="Preset">
              {(["all", "content", "work"] as const).map((p) => (
                <Button key={p} size="sm" variant={preset === p || (!preset && !types && p === "all") ? "secondary" : "ghost"} onClick={() => setParams({ preset: p === "all" ? null : p, types: null })}>
                  {p === "all" ? "Everything" : p === "content" ? "Content" : "My work"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Item types">
            {ALL_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={active.has(k)} onClick={() => toggleKind(k)} className={cn("focus-visible:ring-brand/40 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity outline-none focus-visible:ring-2", KIND_META[k].className, !active.has(k) && "opacity-35")}>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      {view === "month" ? (
        <MonthGrid date={date} items={visible} today={today} weekStartsOn={weekStartsOn} onOpen={open} onDropPlanned={dropPlanned} />
      ) : view === "week" ? (
        <WeekGrid date={date} items={visible} today={today} weekStartsOn={weekStartsOn} onOpen={open} onDropPlanned={dropPlanned} />
      ) : (
        <Agenda from={from} to={to} items={visible} today={today} onOpen={open} />
      )}
    </div>
  );
}

function Chip({ item, onOpen, compact = false }: { item: CalendarItem; onOpen: (i: CalendarItem) => void; compact?: boolean }) {
  const meta = KIND_META[item.kind];
  const draggable = item.kind === "planned";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData("text/task-id", item.entityId) : undefined}
      onClick={() => onOpen(item)}
      title={`${meta.short}: ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      className={cn("focus-visible:ring-brand/40 flex w-full items-center gap-1 truncate rounded-sm border px-1 py-0.5 text-left text-[11px] leading-4 outline-none focus-visible:ring-2", meta.className, item.done && "line-through opacity-60", draggable && "cursor-grab")}
    >
      {item.readOnly ? <Lock className="size-2.5 shrink-0" aria-label="Read-only" /> : null}
      {!compact ? <span className="shrink-0 opacity-70">{meta.short}</span> : null}
      <span className="truncate">{item.title}</span>
      {item.time ? <span className="ml-auto shrink-0 nums opacity-70">{formatTime(item.time).replace(":00", "")}</span> : null}
    </button>
  );
}

function itemsOn(items: CalendarItem[], day: string) {
  return items.filter((i) => (i.kind === "event" ? i.date <= day && (i.endDate ?? i.date) >= day : i.date === day));
}

function MonthGrid({ date, items, today, weekStartsOn, onOpen, onDropPlanned }: { date: string; items: CalendarItem[]; today: string; weekStartsOn: 0 | 1; onOpen: (i: CalendarItem) => void; onDropPlanned: (d: string, id: string) => void }) {
  const weeks = monthGrid(date, weekStartsOn);
  const month = date.slice(0, 7);
  const [over, setOver] = React.useState<string | null>(null);
  return (
    <div className="border-line-1 bg-surface-1 overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 text-center">
        {weekdayNames(weekStartsOn).map((d) => <div key={d} className="eyebrow py-2">{d}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="border-line-1 grid grid-cols-7 border-t">
          {week.map((day) => {
            const dayItems = itemsOn(items, day);
            const inMonth = day.startsWith(month);
            const shown = dayItems.slice(0, 5);
            return (
              <div key={day} className={cn("border-line-1 min-h-20 border-r p-1 transition-colors last:border-r-0 md:min-h-28", !inMonth && "bg-surface-0/60", over === day && "bg-surface-hover")}
                onDragOver={(e) => { e.preventDefault(); if (over !== day) setOver(day); }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task-id"); if (id) onDropPlanned(day, id); }}
              >
                <div className={cn("nums mb-1 flex size-6 items-center justify-center rounded-full text-xs", day === today ? "bg-brand font-semibold text-white" : inMonth ? "text-text-2" : "text-text-3")}>{parseInt(day.slice(8), 10)}</div>
                <div className="flex flex-col gap-0.5">
                  {shown.map((i) => <Chip key={i.id} item={i} onOpen={onOpen} compact />)}
                  {dayItems.length > shown.length ? <Link href={`/calendar?view=agenda&date=${day}`} className="index hover:text-text-1 px-1 hover:underline">+{dayItems.length - shown.length} more</Link> : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekGrid({ date, items, today, weekStartsOn, onOpen, onDropPlanned }: { date: string; items: CalendarItem[]; today: string; weekStartsOn: 0 | 1; onOpen: (i: CalendarItem) => void; onDropPlanned: (d: string, id: string) => void }) {
  const days = eachDay(startOfWeek(date, weekStartsOn), endOfWeek(date, weekStartsOn));
  const [over, setOver] = React.useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day) => {
        const dayItems = itemsOn(items, day);
        return (
          <div key={day} className={cn("bg-surface-1 border-line-1 min-h-40 rounded-lg border p-2.5 transition-colors", over === day && "bg-surface-hover")}
            onDragOver={(e) => { e.preventDefault(); if (over !== day) setOver(day); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task-id"); if (id) onDropPlanned(day, id); }}
          >
            <p className={cn("eyebrow mb-2", day === today && "text-brand-soft")}>{relativeDayLabel(day, today) === formatDate(day, "medium", today) ? formatDate(day, "weekday", today) : `${relativeDayLabel(day, today)} · ${formatDate(day, "monthDay")}`}</p>
            <div className="flex flex-col gap-1">
              {dayItems.map((i) => <Chip key={i.id} item={i} onOpen={onOpen} />)}
              {dayItems.length === 0 ? <p className="text-text-3 text-[11px]">—</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ from, to, items, today, onOpen }: { from: string; to: string; items: CalendarItem[]; today: string; onOpen: (i: CalendarItem) => void }) {
  const days = eachDay(from, to).map((day) => ({ day, items: itemsOn(items, day) })).filter((d) => d.items.length);
  if (!days.length) return <EmptyState icon={<CalendarRange />} title="Nothing scheduled in this range" description="Adjust the filters or move to another period." />;
  return (
    <div className="hairline-rows">
      {days.map(({ day, items: dayItems }) => (
        <section key={day} className="grid grid-cols-1 gap-2 py-3 first:pt-0 sm:grid-cols-[10rem_1fr]">
          <h3 className={cn("text-heading", day === today && "text-brand-soft")}>
            {relativeDayLabel(day, today)}
            <span className="text-text-3 text-meta block font-normal">{formatDate(day, "weekday", today)}</span>
          </h3>
          <div className="flex flex-col gap-1">
            {dayItems.map((i) => (
              <button key={i.id} type="button" onClick={() => onOpen(i)} className={cn("hover:bg-surface-hover focus-visible:ring-brand/40 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-2", i.done && "opacity-60")}>
                <span className={cn("rounded-sm border px-1.5 py-0.5 text-[10px] font-medium", KIND_META[i.kind].className)}>{KIND_META[i.kind].short}</span>
                {i.readOnly ? <Lock className="text-text-3 size-3" aria-label="Read-only" /> : null}
                <span className={cn("text-text-1 min-w-0 flex-1 truncate", i.done && "line-through")}>{i.title}</span>
                {i.subtitle ? <span className="text-text-3 text-meta hidden truncate sm:inline">{i.subtitle}</span> : null}
                {i.time ? <span className="text-text-3 nums text-meta">{formatTime(i.time)}</span> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
