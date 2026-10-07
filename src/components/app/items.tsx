"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarClock, CalendarDays, Check, ChevronRight, Flag, Hourglass, Repeat, Star, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { dueBucket, dueLabel, formatDate, formatTime, relativeDayLabel, formatDateRange } from "@/lib/dates";
import { labelFor, PRIORITIES, SOCIAL_STATUSES, TASK_STATUSES, PLATFORMS, type Priority, type SocialPostWithRefs, type TaskStatus, type TaskWithRefs, type Event } from "@/lib/types";
import { useOpenItem } from "@/hooks/use-open-item";
import { navCrumb } from "./nav";
import { useWorkspace } from "./workspace-provider";

/* ------------------------------------------------------------------------------------------------
   Headers
   ------------------------------------------------------------------------------------------------ */

/** Small uppercase label that orients a block ("01 · Work", "Next 7 days"). */
export function Eyebrow({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("eyebrow flex items-center gap-2", className)} {...props}>
      {children}
    </p>
  );
}

/**
 * Page header: numbered eyebrow (derived from the navigation unless overridden), a display-size
 * title, an optional one-line description and the page's primary actions. `children` holds
 * toolbars (filters, view switches) that belong to the page rather than to a section.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Replace the automatic "01 Work / Tasks" eyebrow; pass `null` to hide it. */
  eyebrow?: React.ReactNode | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const crumb = eyebrow === undefined ? navCrumb(pathname) : null;
  return (
    <header className={cn("mb-6 flex flex-col gap-4 md:mb-7", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? (
            <Eyebrow className="mb-2">{eyebrow}</Eyebrow>
          ) : crumb ? (
            <Eyebrow className="mb-2">
              {crumb.group.index ? <span className="index">{crumb.group.index}</span> : null}
              <span>{crumb.group.label ?? crumb.item.label}</span>
              {crumb.group.label && crumb.nested ? (
                <>
                  <span className="text-line-3" aria-hidden>
                    /
                  </span>
                  <span>{crumb.item.label}</span>
                </>
              ) : null}
            </Eyebrow>
          ) : null}
          <h1 className="text-title text-text-1 text-balance md:text-display">{title}</h1>
          {description ? <p className="text-text-2 mt-2 max-w-2xl text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Section header: optional mono index, a 15px heading, a mono count and a trailing action.
 * Sits on a hairline so the rows beneath it read as one list.
 */
export function SectionHeader({
  title,
  count,
  action,
  hint,
  index,
  className,
  as: Tag = "h2",
}: {
  title: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  hint?: React.ReactNode;
  index?: string | number;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("border-line-1 mb-1.5 flex min-h-8 items-center justify-between gap-3 border-b pb-2", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {index != null ? <span className="index">{typeof index === "number" ? String(index).padStart(2, "0") : index}</span> : null}
        <Tag className="text-heading text-text-1 truncate">{title}</Tag>
        {typeof count === "number" ? (
          <span className="index" aria-label={`${count} items`}>
            {count}
          </span>
        ) : null}
        {hint ? <span className="text-text-3 text-meta hidden truncate sm:inline">{hint}</span> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}

/** Quiet "View all →" link used at the end of a section header or list. */
export function SectionLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-text-3 hover:text-text-1 focus-visible:ring-brand/40 inline-flex h-7 items-center gap-1 rounded-sm px-1 text-xs transition-colors outline-none focus-visible:ring-2", className)}>
      {children}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

/** Sub-heading inside a section, for date groups or secondary buckets. */
export function SubHeading({ children, count, tone = "default", className }: { children: React.ReactNode; count?: number; tone?: "default" | "danger" | "warning"; className?: string }) {
  return (
    <p className={cn("eyebrow mt-4 mb-1 flex items-center gap-2 first:mt-0", tone === "danger" && "text-danger", tone === "warning" && "text-warning", className)}>
      {children}
      {typeof count === "number" ? <span className="index">{count}</span> : null}
    </p>
  );
}

/* ------------------------------------------------------------------------------------------------
   Lists and rows
   ------------------------------------------------------------------------------------------------ */

/** Hairline-divided list. Rows bleed 8px into the gutter so hover fills align with headers. */
export function RowList({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("hairline-rows -mx-2", className)} {...props}>
      {children}
    </div>
  );
}

/** Metadata row beneath a row title: 12px, muted, wraps. */
export function MetaRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("text-text-3 text-meta mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5", className)}>{children}</div>;
}

/* ------------------------------------------------------------------------------------------------
   Work-area accents. Stored colors stay untouched; readable text and tints are derived in CSS.
   ------------------------------------------------------------------------------------------------ */

export function areaStyle(color?: string | null): React.CSSProperties {
  return { "--area-color": color ?? undefined } as React.CSSProperties;
}

export function AreaDot({ color, className }: { color?: string | null; className?: string }) {
  return <span aria-hidden className={cn("area-dot inline-block size-1.5 shrink-0 rounded-full", className)} style={areaStyle(color)} />;
}

/** Work-area label: a dot plus the name, tinted from the area color but always carrying the text. */
export function AreaTag({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  return (
    <span className={cn("area-text inline-flex items-center gap-1.5 font-medium", className)} style={areaStyle(color)}>
      <AreaDot color={color} />
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
   Indicators
   ------------------------------------------------------------------------------------------------ */

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === "normal") return null;
  const tone = priority === "urgent" ? "text-danger" : priority === "high" ? "text-warning" : "text-text-3";
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", tone, className)}>
      <Flag className="size-3" aria-hidden /> {labelFor(PRIORITIES, priority)}
    </span>
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

/** Due indicator: text that changes tone (danger / warning / quiet) rather than a pill. */
export function DueBadge({ date, time, today, label = "Due", className }: { date: string | null | undefined; time?: string | null; today: string; label?: string; className?: string }) {
  if (!date) return null;
  const bucket = dueBucket(date, today);
  const tone = bucket === "overdue" ? "text-danger" : bucket === "today" ? "text-warning" : bucket === "tomorrow" || bucket === "week" ? "text-text-2" : "text-text-3";
  const text = label === "Due" ? dueLabel(date, today) : `${label} ${relativeDayLabel(date, today)}`;
  return (
    <span className={cn("nums inline-flex items-center gap-1 font-medium", tone, className)}>
      <CalendarClock className="size-3" aria-hidden />
      {text}
      {time ? ` · ${formatTime(time)}` : ""}
    </span>
  );
}

/** 18px circular completion control with a 32px hit area. */
export function CompleteControl({ done, onToggle, dense = false, className }: { done: boolean; onToggle?: () => void; dense?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      aria-label={done ? "Reopen task" : "Complete task"}
      title={done ? "Reopen" : "Complete"}
      className={cn("focus-visible:ring-brand/40 -mx-1.5 flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:pointer-events-none [&>span]:hover:border-brand-soft", dense ? "-my-[7px]" : "-my-1.5", className)}
    >
      <span className={cn("flex size-[18px] items-center justify-center rounded-full border transition-colors duration-150", done ? "border-success bg-success text-surface-0" : "border-line-3 bg-transparent")}>
        {done ? <Check className="motion-safe:animate-check-pop size-3" strokeWidth={3} aria-hidden /> : null}
      </span>
    </button>
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
  const searchParams = useSearchParams();
  const selected = searchParams.get("task") === task.id;
  const done = task.status === "completed";
  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        "group hover:bg-surface-hover data-[selected]:bg-brand/8 relative flex items-start gap-3 rounded-md px-2 transition-colors duration-150",
        dense ? "py-1.5" : "py-2",
        done && "opacity-75",
        className,
      )}
    >
      <CompleteControl done={done} dense={dense} onToggle={onToggleComplete ? () => onToggleComplete(task) : undefined} className="mt-0" />
      <Link href={taskHref(task.id)} scroll={false} aria-current={selected ? "true" : undefined} className="focus-visible:ring-brand/40 min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2">
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn("text-sm leading-5 font-medium", done ? "text-text-3 decoration-line-3 line-through" : "text-text-1")}>{task.title}</span>
          {task.focus_rank ? <Star className="fill-warning text-warning size-3.5" aria-label="Focus today" /> : null}
          {task.recurrence ? <Repeat className="text-text-3 size-3.5" aria-label="Repeats" /> : null}
          {task.status === "waiting" ? (
            <Badge variant="warning">
              <Hourglass /> {task.waiting_person ? `Waiting on ${task.waiting_person}` : "Waiting"}
            </Badge>
          ) : null}
        </div>
        <MetaRow>
          {showArea && task.work_area ? <AreaTag name={task.work_area.name} color={task.work_area.color} /> : null}
          {showProject && task.project ? <span className="truncate">{task.project.name}</span> : null}
          {task.event ? (
            <span className="inline-flex items-center gap-1 truncate">
              <CalendarDays className="size-3" aria-hidden /> {task.event.name}
            </span>
          ) : null}
          {!done ? <DueBadge date={task.due_date} time={task.due_time} today={today} /> : null}
          {!done && task.planned_date && task.planned_date !== task.due_date ? <span>Planned {relativeDayLabel(task.planned_date, today)}</span> : null}
          {done && task.completed_at ? <span>Completed {formatDate(task.completed_at.slice(0, 10), "medium", today)}</span> : null}
          <PriorityBadge priority={task.priority} />
          {task.subtask_total ? (
            <span className="nums">
              {task.subtask_done}/{task.subtask_total} subtasks
            </span>
          ) : null}
          {task.estimated_minutes ? <span className="nums">{formatMinutes(task.estimated_minutes)}</span> : null}
        </MetaRow>
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
  const searchParams = useSearchParams();
  const selected = searchParams.get("post") === post.id;
  const done = post.status === "published";
  const next = nextSocialMilestone(post, today);
  return (
    <Link
      href={postHref(post.id)}
      scroll={false}
      data-selected={selected || undefined}
      className={cn(
        "group hover:bg-surface-hover data-[selected]:bg-brand/8 focus-visible:ring-brand/40 flex items-start gap-3 rounded-md px-2 transition-colors duration-150 outline-none focus-visible:ring-2",
        dense ? "py-1.5" : "py-2",
        done && "opacity-75",
        className,
      )}
    >
      <span className="bg-surface-2 flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none" aria-hidden>
        {platformEmoji(post.platform)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-text-1 text-sm leading-5 font-medium">{post.title}</span>
          <SocialStatusBadge status={post.status} />
          {post.monday_item_id ? <Badge variant={post.monday_removed_at ? "destructive" : "muted"}>{post.monday_removed_at ? "Removed from Monday" : "Monday"}</Badge> : null}
        </div>
        <MetaRow>
          {post.platform ? <span>{labelFor(PLATFORMS, post.platform)}</span> : null}
          {post.brand ? <span>{post.brand}</span> : null}
          {post.event ? (
            <span className="inline-flex items-center gap-1 truncate">
              <CalendarDays className="size-3" aria-hidden /> {post.event.name}
            </span>
          ) : null}
          {post.project ? <span className="truncate">{post.project.name}</span> : null}
          {!done && next ? <DueBadge date={next.date} today={today} label={next.label} /> : null}
          {post.publish_date ? (
            <span className="nums">
              Publish {relativeDayLabel(post.publish_date, today)}
              {post.publish_time ? ` · ${formatTime(post.publish_time)}` : ""}
            </span>
          ) : null}
        </MetaRow>
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

/** Compact calendar block: month over day, tabular. */
export function DateBlock({ date, className }: { date: string | null | undefined; className?: string }) {
  const [month, day] = date ? formatDate(date, "monthDay").split(" ") : ["—", ""];
  return (
    <span className={cn("border-line-1 bg-surface-2 flex w-10 shrink-0 flex-col items-center rounded-md border py-1 leading-none", className)} aria-hidden>
      <span className="text-text-3 text-[10px] font-semibold tracking-[0.1em] uppercase">{month}</span>
      <span className="nums text-text-1 mt-0.5 text-base font-semibold">{day}</span>
    </span>
  );
}

export function EventRow({ event, prepOpen, prepTotal, socialOpen, className }: { event: Event; prepOpen?: number; prepTotal?: number; socialOpen?: number; className?: string }) {
  const { today } = useWorkspace();
  const flagged = event.sync_flag !== "none" && !event.review_dismissed_at;
  return (
    <Link
      href={`/events/${event.id}`}
      className={cn("group hover:bg-surface-hover focus-visible:ring-brand/40 flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-150 outline-none focus-visible:ring-2", className)}
    >
      <DateBlock date={event.start_date} />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-text-1 text-sm leading-5 font-medium">{event.name}</span>
          {event.source === "monday" ? (
            <Badge variant="muted">
              <Lock /> Monday
            </Badge>
          ) : null}
          {flagged ? <Badge variant="destructive">{event.sync_flag === "removed" ? "Removed in Monday" : "Canceled"}</Badge> : null}
          {event.dates_changed_at && event.previous_start_date ? <Badge variant="warning">Date changed</Badge> : null}
        </div>
        <MetaRow>
          <span className="nums">{formatDateRange(event.start_date, event.end_date, today)}</span>
          {event.start_time ? <span className="nums">{formatTime(event.start_time)}</span> : null}
          {event.location ? <span className="truncate">{event.location}</span> : null}
          {event.status ? <span>{event.status}</span> : null}
          {typeof prepTotal === "number" ? (
            <span className="nums">
              {prepOpen} of {prepTotal} prep open
            </span>
          ) : null}
          {typeof socialOpen === "number" && socialOpen > 0 ? <span className="nums">{socialOpen} posts pending</span> : null}
          {event.website_url ? <ExternalLink className="size-3" aria-label="Has website" /> : null}
        </MetaRow>
      </div>
      <ChevronRight className="text-text-3 mt-1 size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
    </Link>
  );
}
