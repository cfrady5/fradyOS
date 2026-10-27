"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Crosshair, FolderKanban, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { AreaDot, EventRow, PageHeader, RowList, SectionHeader, SectionLink, SocialPostRow, SubHeading, TaskRow } from "@/components/app/items";
import { Metric, MetricStrip, MetricTag } from "@/components/app/metric";
import { FocusPicker } from "@/components/app/focus-picker";
import { WaitingActions } from "@/components/app/waiting-actions";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { GoalStatusBadge } from "@/components/finance/bits";
import { ProgressMeter } from "@/components/finance/charts";
import { completeTask, reopenTask } from "@/actions/tasks";
import type { TodayData } from "@/lib/data/today";
import type { TaskWithRefs } from "@/lib/types";
import type { GoalStatusKey } from "@/lib/finance/engine";
import { GOAL_STATUS_META } from "@/lib/finance/model";
import { fmtMoney, fmtMonths } from "@/lib/finance/format";
import { relativeDayLabel, formatDate, timeAgo, diffDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type Standing = {
  finance: {
    netWorth: number;
    netWorthDelta: number | null;
    freeCashFlow: number;
    unallocated: number;
    debt: number;
    debtFreeDate: string | null;
    debtFreeMonth: number | null;
    firstShortfallDate: string | null;
    lastSyncedAt: string | null;
    goals: { id: string; name: string; progressPct: number; status: GoalStatusKey; projectedDate: string | null; targetDate: string | null; startAmount: number; targetAmount: number }[];
  } | null;
  projects: {
    active: number;
    overdue: number;
    waiting: number;
    upcoming: { id: string; name: string; target_date: string | null; task_done: number; task_total: number; overdue_count: number; next_action: string | null; area: { name: string; color: string } | null }[];
  };
};

/**
 * Today answers five questions in order: what needs attention, what I'm focusing on, what's
 * next, what's coming up, and where I stand. Sections are numbered so the order is explicit.
 */
export function TodayView({ data, standing, greeting, dateLabel }: { data: TodayData; standing: Standing; greeting: string; dateLabel: string }) {
  const router = useRouter();
  const { openQuickAdd } = useShell();
  const { today } = useWorkspace();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();

  function toggle(task: TaskWithRefs) {
    startTransition(async () => {
      const res = task.status === "completed" ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(task.status === "completed" ? "Reopened" : "Completed", { action: { label: "Undo", onClick: () => (task.status === "completed" ? completeTask(task.id) : reopenTask(task.id)).then(() => router.refresh()) } });
        router.refresh();
      }
    });
  }

  const weekGroups = groupByDate(data.dueWeek);
  const todayCount = data.dueToday.length + data.plannedToday.length;
  const nextCount = todayCount + data.overdue.length + data.followups.length;
  const comingCount = data.dueWeek.length + data.events.length + data.socialSoon.length;
  const clear = data.overdue.length === 0 && data.followups.length === 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={dateLabel}
        title={greeting}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Crosshair /> {data.focus.length ? "Change focus" : "Choose focus"}
            </Button>
            <Button size="sm" className="md:hidden" onClick={() => openQuickAdd({ due_date: today })}>
              <Plus /> Add task
            </Button>
          </>
        }
      />

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="flex min-w-0 flex-col gap-8">
          {/* 01 — What needs my attention? */}
          <section aria-labelledby="today-attention">
            <SectionHeader index="01" title={<span id="today-attention">Needs attention</span>} hint={clear ? "nothing overdue, no follow-ups due" : undefined} />
            <MetricStrip cols={4} className="mt-3">
              <Metric size="sm" label="Overdue" value={data.overdue.length} muted={!data.overdue.length} tone={data.overdue.length ? "critical" : "neutral"} sub={data.overdue.length ? "to decide" : "all clear"} href="/tasks?due=overdue" />
              <Metric size="sm" label="Due today" value={data.dueToday.length} muted={!data.dueToday.length} tone={data.dueToday.length ? "warning" : "neutral"} sub={data.plannedToday.length ? `+${data.plannedToday.length} planned` : "nothing due"} href="/tasks?due=today" />
              <Metric size="sm" label="Follow-ups" value={data.followups.length} muted={!data.followups.length} tone={data.followups.length ? "warning" : "neutral"} sub={data.followups.length ? "due now" : "none due"} href="/waiting" />
              <Metric size="sm" label="Inbox" value={data.counts.inbox} muted={!data.counts.inbox} sub={data.counts.inbox ? "to triage" : "inbox zero"} href="/tasks?status=inbox" />
            </MetricStrip>
          </section>

          {/* 02 — What am I focusing on? */}
          <section aria-labelledby="today-focus">
            <SectionHeader
              index="02"
              title={<span id="today-focus">Focus today</span>}
              hint="your top three"
              action={
                <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                  {data.focus.length ? "Change" : "Choose"}
                </Button>
              }
            />
            {data.focus.length ? (
              <div className="border-brand/30 bg-surface-1 mt-3 rounded-lg border px-4 py-1">
                <RowList>
                  {data.focus.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleComplete={toggle} trailing={<span className="index pr-1">{String(t.focus_rank ?? 0).padStart(2, "0")}</span>} />
                  ))}
                </RowList>
              </div>
            ) : (
              <EmptyState className="mt-3" icon={<Target />} title="Pick what matters most today" description="Up to three tasks stay front and center." action={<Button size="sm" onClick={() => setPickerOpen(true)}>Choose priorities</Button>} />
            )}
          </section>

          {/* 03 — What should I do next? */}
          <section aria-labelledby="today-next">
            <SectionHeader
              index="03"
              title={<span id="today-next">Up next</span>}
              count={nextCount}
              action={
                <Button variant="ghost" size="sm" onClick={() => openQuickAdd({ due_date: today })}>
                  <Plus /> Add for today
                </Button>
              }
            />
            {nextCount === 0 ? (
              <EmptyState className="mt-3" icon={<CheckCircle2 />} title="Nothing due today" description="Pull something forward from this week, or capture a new task." />
            ) : (
              <div className="mt-2">
                {data.overdue.length ? (
                  <>
                    <SubHeading tone="danger" count={data.overdue.length}>
                      Overdue
                    </SubHeading>
                    <RowList>
                      {data.overdue.slice(0, 6).map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                      ))}
                    </RowList>
                    {data.overdue.length > 6 ? <SectionLink href="/tasks?due=overdue">{data.overdue.length - 6} more overdue</SectionLink> : null}
                  </>
                ) : null}
                {data.dueToday.length ? (
                  <>
                    <SubHeading count={data.dueToday.length}>Due today</SubHeading>
                    <RowList>
                      {data.dueToday.map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                      ))}
                    </RowList>
                  </>
                ) : null}
                {data.plannedToday.length ? (
                  <>
                    <SubHeading count={data.plannedToday.length}>Planned for today</SubHeading>
                    <RowList>
                      {data.plannedToday.map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                      ))}
                    </RowList>
                  </>
                ) : null}
                {data.followups.length ? (
                  <>
                    <SubHeading tone="warning" count={data.followups.length}>
                      Follow-ups due
                    </SubHeading>
                    <div className="flex flex-col gap-2">
                      {data.followups.map((t) => (
                        <div key={t.id} className="border-line-1 bg-surface-1 rounded-lg border px-4 py-2">
                          <RowList>
                            <TaskRow task={t} onToggleComplete={toggle} dense />
                          </RowList>
                          <div className="text-text-3 text-meta mt-1 flex flex-wrap items-center gap-2">
                            {t.waiting_expected_date ? <Badge variant={t.waiting_expected_date < today ? "destructive" : "muted"}>Their deadline {relativeDayLabel(t.waiting_expected_date, today)}</Badge> : null}
                            {t.waiting_followup_date ? <Badge variant={t.waiting_followup_date <= today ? "warning" : "muted"}>My follow-up {relativeDayLabel(t.waiting_followup_date, today)}</Badge> : null}
                          </div>
                          <div className="mt-2 pb-1">
                            <WaitingActions task={t} compact />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          {/* 04 — What's coming up? */}
          <section aria-labelledby="today-coming">
            <SectionHeader index="04" title={<span id="today-coming">Coming up</span>} count={comingCount} action={<SectionLink href="/calendar">Calendar</SectionLink>} />
            {comingCount === 0 ? (
              <EmptyState className="mt-3" title="Quiet week ahead" description="Deadlines, events and posts in the next 7 days land here." />
            ) : (
              <div className="mt-2">
                {weekGroups.length ? (
                  weekGroups.map((g) => (
                    <React.Fragment key={g.date}>
                      <SubHeading count={g.tasks.length}>{relativeDayLabel(g.date, today)}</SubHeading>
                      <RowList>
                        {g.tasks.map((t) => (
                          <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense showProject={false} />
                        ))}
                      </RowList>
                    </React.Fragment>
                  ))
                ) : (
                  <p className="text-text-3 text-meta py-1.5">No deadlines in the next 7 days.</p>
                )}
                {data.events.length ? (
                  <>
                    <SubHeading count={data.events.length}>Events · 30 days</SubHeading>
                    <RowList>
                      {data.events.slice(0, 5).map((e) => (
                        <EventRow key={e.id} event={e} prepOpen={e.prep_open} prepTotal={e.prep_total} socialOpen={e.social_open} />
                      ))}
                    </RowList>
                    {data.events.length > 5 ? <SectionLink href="/events">All events</SectionLink> : null}
                  </>
                ) : null}
                {data.socialSoon.length ? (
                  <>
                    <SubHeading count={data.socialSoon.length}>Social deadlines · 7 days</SubHeading>
                    <RowList>
                      {data.socialSoon.slice(0, 6).map((p) => (
                        <SocialPostRow key={p.id} post={p} dense />
                      ))}
                    </RowList>
                  </>
                ) : null}
              </div>
            )}
          </section>

          {/* 05 — Where do I stand? */}
          <section aria-labelledby="today-standing">
            <SectionHeader index="05" title={<span id="today-standing">Where I stand</span>} action={<SectionLink href="/finances">Finances</SectionLink>} />
            <div className="mt-3 flex flex-col gap-5">
              {standing.finance ? (
                <>
                  <MetricStrip cols={2}>
                    <Metric
                      size="sm"
                      label="Net worth"
                      value={fmtMoney(standing.finance.netWorth)}
                      sub={standing.finance.netWorthDelta != null ? <span className={cn(standing.finance.netWorthDelta >= 0 ? "text-success" : "text-danger")}>{fmtMoney(standing.finance.netWorthDelta, { sign: true, compact: true })} vs last month</span> : "first snapshot"}
                      href="/finances"
                    />
                    <Metric size="sm" label="Free cash / mo" value={fmtMoney(standing.finance.freeCashFlow)} tone={standing.finance.freeCashFlow < 0 ? "critical" : "neutral"} sub={standing.finance.unallocated > 0 ? `${fmtMoney(standing.finance.unallocated)} unallocated` : standing.finance.unallocated < 0 ? "over-committed" : "fully allocated"} href="/finances/budget" />
                    <Metric size="sm" label="Debt" value={fmtMoney(standing.finance.debt)} muted={standing.finance.debt === 0} sub={standing.finance.debtFreeMonth === 0 ? "debt-free" : standing.finance.debtFreeDate ? `free ${formatDate(standing.finance.debtFreeDate, "monthYear")}` : "not cleared in 10 yrs"} href="/finances/debt" />
                    <Metric size="sm" label="Projects" value={standing.projects.active} muted={!standing.projects.active} sub={standing.projects.overdue ? <span className="text-danger">{standing.projects.overdue} overdue task{standing.projects.overdue === 1 ? "" : "s"}</span> : standing.projects.waiting ? `${standing.projects.waiting} waiting` : "on schedule"} href="/projects" />
                  </MetricStrip>
                  {standing.finance.firstShortfallDate ? (
                    <p className="text-meta flex flex-wrap items-center gap-2">
                      <Badge variant="destructive">Cash shortfall</Badge>
                      <span className="text-text-2">Checking goes negative in {formatDate(standing.finance.firstShortfallDate, "monthYear")} at the current plan.</span>
                    </p>
                  ) : null}
                  <p className="text-text-3 text-meta flex items-center gap-2">
                    <MetricTag>{standing.finance.lastSyncedAt ? "Connected" : "Manual"}</MetricTag>
                    {standing.finance.lastSyncedAt ? `Bank balances synced ${timeAgo(standing.finance.lastSyncedAt)}` : "Balances entered by hand"}
                  </p>
                </>
              ) : (
                <>
                  <MetricStrip cols={2}>
                    <Metric size="sm" label="Projects" value={standing.projects.active} muted={!standing.projects.active} sub={standing.projects.overdue ? <span className="text-danger">{standing.projects.overdue} overdue</span> : "active"} href="/projects" />
                    <Metric size="sm" label="Events" value={data.events.length} muted={!data.events.length} sub="next 30 days" href="/events" />
                  </MetricStrip>
                  <EmptyState title="No financial picture yet" description="Add income, expenses and accounts to see net worth and cash flow here." action={<Button asChild size="sm" variant="outline"><Link href="/finances">Set up finances</Link></Button>} />
                </>
              )}

              {standing.finance?.goals.length ? (
                <div>
                  <SubHeading>Goals</SubHeading>
                  <ul className="flex flex-col gap-3">
                    {standing.finance.goals.map((g) => (
                      <li key={g.id} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Link href="/finances/goals" className="text-text-1 min-w-0 truncate text-sm font-medium hover:underline">
                            {g.name}
                          </Link>
                          <GoalStatusBadge status={g.status} />
                        </div>
                        <ProgressMeter value={g.startAmount} target={g.targetAmount} tone={GOAL_STATUS_META[g.status].tone} />
                        <div className="text-text-3 nums text-meta flex justify-between">
                          <span>
                            {g.progressPct.toFixed(0)}% of {fmtMoney(g.targetAmount, { compact: true })}
                          </span>
                          <span>{g.projectedDate ? `projected ${formatDate(g.projectedDate, "monthYear")}` : "no projection"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : standing.finance ? (
                <p className="text-text-3 text-meta">
                  No financial goals yet.{" "}
                  <Link href="/finances/goals" className="text-brand-soft hover:underline">
                    Add one
                  </Link>{" "}
                  to see projected dates here.
                </p>
              ) : null}

              {standing.projects.upcoming.length ? (
                <div>
                  <SubHeading>Projects with target dates</SubHeading>
                  <ul className="flex flex-col gap-3">
                    {standing.projects.upcoming.map((p) => {
                      const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;
                      const days = p.target_date ? diffDays(today, p.target_date) : null;
                      return (
                        <li key={p.id} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <Link href={`/projects/${p.id}`} className="text-text-1 flex min-w-0 items-center gap-1.5 font-medium hover:underline">
                              <FolderKanban className="text-text-3 size-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{p.name}</span>
                            </Link>
                            <span className={cn("nums text-meta shrink-0", days != null && days < 0 ? "text-danger" : days != null && days <= 7 ? "text-warning" : "text-text-3")}>{p.target_date ? (days === 0 ? "today" : days! < 0 ? `${-days!}d late` : `${days}d left`) : "no date"}</span>
                          </div>
                          <ProgressMeter value={pct} target={100} tone={p.overdue_count ? "serious" : "neutral"} />
                          <div className="text-text-3 text-meta flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              {p.area ? <AreaDot color={p.area.color} /> : null}
                              {p.next_action ?? `${p.task_done}/${p.task_total} tasks`}
                            </span>
                            <span className="nums shrink-0">{pct}%</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div>
                <SubHeading count={data.recentlyCompleted.length}>Completed this week</SubHeading>
                {data.recentlyCompleted.length ? (
                  <>
                    <RowList>
                      {data.recentlyCompleted.slice(0, 4).map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense showProject={false} />
                      ))}
                    </RowList>
                    <SectionLink href="/completed">Weekly review</SectionLink>
                  </>
                ) : (
                  <p className="text-text-3 text-meta py-1.5">Nothing completed in the last 7 days yet.</p>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>

      <FocusPicker open={pickerOpen} onOpenChange={setPickerOpen} current={data.focus.map((t) => t.id)} />
      {clear && todayCount === 0 ? <p className="sr-only">Nothing needs attention right now.</p> : null}
    </div>
  );
}

function groupByDate(tasks: TaskWithRefs[]) {
  const map = new Map<string, TaskWithRefs[]>();
  for (const t of tasks) {
    const k = t.due_date ?? "";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, ts]) => ({ date, tasks: ts }));
}

export { fmtMonths as _fmtMonths };
