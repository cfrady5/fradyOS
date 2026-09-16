"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Circle, Flag, Hourglass, Repeat, Star, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { dueBucket, dueLabel, formatDate, formatTime, relativeDayLabel, formatDateRange } from "@/lib/dates";
import { labelFor, PRIORITIES, SOCIAL_STATUSES, TASK_STATUSES, PLATFORMS, type Priority, type SocialPostWithRefs, type TaskStatus, type TaskWithRefs, type Event } from "@/lib/types";
import { useOpenItem } from "@/hooks/use-open-item";
import { useWorkspace } from "./workspace-provider";

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SectionHeader({ title, count, action, hint, className }: { title: React.ReactNode; count?: number; action?: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {typeof count === "number" ? <span className="text-muted-foreground text-xs tabular-nums">{count}</span> : null}
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function AreaDot({ color, className }: { color?: string | null; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: color ?? "#94a3b8" }} />;
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === "normal") return null;
  const variant = priority === "urgent" ? "destructive" : priority === "high" ? "warning" : "muted";
  return (
    <Badge variant={variant} className={className}>
      <Flag /> {labelFor(PRIORITIES, priority)}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, "muted" | "secondary" | "default" | "warning" | "success"> = {
    inbox: "muted",
    todo: "secondary",
    in_progress: "default",
    waiting: "warning",
    completed: "success",
  };
  return <Badge variant={map[status]}>{labelFor(TASK_STATUSES, status)}</Badge>;
}

export function SocialStatusBadge({ status }: { status: SocialPostWithRefs["status"] }) {
  const map: Record<string, "muted" | "secondary" | "default" | "warning" | "success"> = {
    idea: "muted",
    drafting: "secondary",
    awaiting_approval: "warning",
    ready: "default",
    scheduled: "default",
    published: "success",
  };
  return <Badge variant={map[status] ?? "muted"}>{labelFor(SOCIAL_STATUSES, status)}</Badge>;
}

export function DueBadge({ date, time, today, label = "Due", className }: { date: string | null | undefined; time?: string | null; today: string; label?: string; className?: string }) {
  if (!date) return null;
  const bucket = dueBucket(date, today);
  const variant = bucket === "overdue" ? "destructive" : bucket === "today" ? "warning" : bucket === "tomorrow" || bucket === "week" ? "secondary" : "muted";
  const text = label === "Due" ? dueLabel(date, today) : `${label} ${relativeDayLabel(date, today)}`;
  return (
    <Badge variant={variant} className={cn("tabular-nums", className)}>
      <CalendarClock /> {text}
      {time ? ` · ${formatTime(time)}` : ""}
    </Badge>
  );
}

/** A compact, clickable task row used across Today, Projects, Tasks and Events. */
export function TaskRow({
  task,
  onToggleComplete,
  showProject = true,
  showArea = true,
  dense = false,
  trailing,
  className,
}: {
  task: TaskWithRefs;
  onToggleComplete?: (task: TaskWithRefs) => void;
  showProject?: boolean;
  showArea?: boolean;
  dense?: boolean;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const { today } = useWorkspace();
  const { taskHref } = useOpenItem();
  const done = task.status === "completed";
  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-md border bg-card px-2.5 transition-colors hover:bg-accent/40",
        dense ? "py-1.5" : "py-2",
        done && "opacity-70",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onToggleComplete?.(task)}
        aria-label={done ? "Reopen task" : "Complete task"}
        title={done ? "Reopen" : "Complete"}
        className="text-muted-foreground hover:text-primary mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {done ? <CheckCircle2 className="text-success size-[18px]" /> : <Circle className="size-[18px]" />}
      </button>
      <Link href={taskHref(task.id)} scroll={false} className="min-w-0 flex-1 outline-none focus-visible:underline">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm font-medium leading-5", done && "line-through")}>{task.title}</span>
          {task.focus_rank ? <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Top priority" /> : null}
          {task.recurrence ? <Repeat className="text-muted-foreground size-3.5" aria-label="Repeats" /> : null}
          {task.status === "waiting" ? (
            <Badge variant="warning">
              <Hourglass /> {task.waiting_person ? `Waiting on ${task.waiting_person}` : "Waiting"}
            </Badge>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {showArea && task.work_area ? (
            <span className="inline-flex items-center gap-1">
              <AreaDot color={task.work_area.color} /> {task.work_area.name}
            </span>
          ) : null}
          {showProject && task.project ? <span className="truncate">{task.project.name}</span> : null}
          {task.event ? <span className="truncate">📅 {task.event.name}</span> : null}
          {!done ? <DueBadge date={task.due_date} time={task.due_time} today={today} /> : null}
          {!done && task.planned_date && task.planned_date !== task.due_date ? (
            <span className="inline-flex items-center gap-1">Plan: {relativeDayLabel(task.planned_date, today)}</span>
          ) : null}
          {done && task.completed_at ? <span>Completed {formatDate(task.completed_at.slice(0, 10), "medium", today)}</span> : null}
          <PriorityBadge priority={task.priority} />
          {task.subtask_total ? (
            <span className="tabular-nums">
              {task.subtask_done}/{task.subtask_total} subtasks
            </span>
          ) : null}
          {task.estimated_minutes ? <span>{formatMinutes(task.estimated_minutes)}</span> : null}
        </div>
      </Link>
      {trailing ? <div className="shrink-0 self-center">{trailing}</div> : null}
    </div>
  );
}

export function formatMinutes(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function SocialPostRow({ post, className, dense = false }: { post: SocialPostWithRefs; className?: string; dense?: boolean }) {
  const { today } = useWorkspace();
  const { postHref } = useOpenItem();
  const done = post.status === "published";
  const next = nextSocialMilestone(post, today);
  return (
    <Link
      href={postHref(post.id)}
      scroll={false}
      className={cn(
        "flex items-start gap-2.5 rounded-md border bg-card px-2.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60",
        dense ? "py-1.5" : "py-2",
        done && "opacity-70",
        className,
      )}
    >
      <span className="mt-0.5 text-base leading-5" aria-hidden>
        {platformEmoji(post.platform)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium leading-5">{post.title}</span>
          <SocialStatusBadge status={post.status} />
          {post.monday_item_id ? <Badge variant={post.monday_removed_at ? "destructive" : "muted"}>{post.monday_removed_at ? "Removed from Monday" : "Monday"}</Badge> : null}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {post.platform ? <span>{labelFor(PLATFORMS, post.platform)}</span> : null}
          {post.brand ? <span>{post.brand}</span> : null}
          {post.event ? <span className="truncate">📅 {post.event.name}</span> : null}
          {post.project ? <span className="truncate">{post.project.name}</span> : null}
          {!done && next ? <DueBadge date={next.date} today={today} label={next.label} /> : null}
          {post.publish_date ? (
            <span>
              Publish {relativeDayLabel(post.publish_date, today)}
              {post.publish_time ? ` · ${formatTime(post.publish_time)}` : ""}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function nextSocialMilestone(post: SocialPostWithRefs, today: string): { label: string; date: string } | null {
  const ms: { label: string; date: string | null; active: boolean }[] = [
    { label: "Draft", date: post.draft_due_date, active: ["idea", "drafting"].includes(post.status) },
    { label: "Approval", date: post.approval_due_date, active: ["idea", "drafting", "awaiting_approval"].includes(post.status) },
    { label: "Publish", date: post.publish_date, active: post.status !== "published" },
  ];
  const active = ms.filter((m) => m.active && m.date) as { label: string; date: string }[];
  if (!active.length) return null;
  const overdue = active.filter((m) => m.date < today).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (overdue.length) return overdue[0];
  return active.sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

export function platformEmoji(p: string | null | undefined) {
  switch (p) {
    case "linkedin":
      return "💼";
    case "instagram":
      return "📸";
    case "facebook":
      return "👥";
    case "x":
      return "✖️";
    case "tiktok":
      return "🎵";
    case "youtube":
      return "▶️";
    case "email":
      return "✉️";
    case "website":
      return "🌐";
    default:
      return "📣";
  }
}

export function EventRow({ event, prepOpen, prepTotal, socialOpen, className }: { event: Event; prepOpen?: number; prepTotal?: number; socialOpen?: number; className?: string }) {
  const { today } = useWorkspace();
  const flagged = event.sync_flag !== "none" && !event.review_dismissed_at;
  return (
    <Link
      href={`/events/${event.id}`}
      className={cn(
        "flex items-start gap-3 rounded-md border bg-card px-3 py-2 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      <div className="bg-accent text-accent-foreground flex w-12 shrink-0 flex-col items-center rounded-md py-1 leading-none">
        <span className="text-[10px] font-medium uppercase">{event.start_date ? formatDate(event.start_date, "monthDay").split(" ")[0] : "—"}</span>
        <span className="text-lg font-semibold tabular-nums">{event.start_date ? formatDate(event.start_date, "monthDay").split(" ")[1] : ""}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{event.name}</span>
          {event.source === "monday" ? (
            <Badge variant="muted">
              <Lock /> Monday
            </Badge>
          ) : null}
          {flagged ? <Badge variant="destructive">{event.sync_flag === "removed" ? "Removed in Monday" : "Canceled"}</Badge> : null}
          {event.dates_changed_at && event.previous_start_date ? <Badge variant="warning">Date changed</Badge> : null}
        </div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span>{formatDateRange(event.start_date, event.end_date, today)}</span>
          {event.start_time ? <span>{formatTime(event.start_time)}</span> : null}
          {event.location ? <span className="truncate">{event.location}</span> : null}
          {event.status ? <span>· {event.status}</span> : null}
          {typeof prepTotal === "number" ? (
            <span className="tabular-nums">
              {prepOpen} of {prepTotal} prep open
            </span>
          ) : null}
          {typeof socialOpen === "number" && socialOpen > 0 ? <span className="tabular-nums">{socialOpen} posts pending</span> : null}
          {event.website_url ? <ExternalLink className="size-3" /> : null}
        </div>
      </div>
    </Link>
  );
}
