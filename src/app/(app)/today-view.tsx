"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Hourglass, Inbox, Megaphone, Plus, Sun, Target, Trophy, Wallet, Flag, FolderKanban, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { EventRow, SocialPostRow, TaskRow, SectionHeader, PageHeader, AreaDot } from "@/components/app/items";
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
  const attention = data.overdue.length + data.followups.length;
  const todayCount = data.dueToday.length + data.plannedToday.length;
  const summary = [
    data.overdue.length ? `${data.overdue.length} overdue` : null,
    todayCount ? `${todayCount} for today` : null,
    data.followups.length ? `${data.followups.length} follow-up${data.followups.length === 1 ? "" : "s"} due` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={greeting}
        description={
          <span>
            {dateLabel}
            {summary.length ? <span className="text-foreground/80"> · {summary.join(" · ")}</span> : <span className="text-success"> · Nothing overdue</span>}
          </span>
        }
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

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
        {/* Left column (desktop). On mobile both columns dissolve and blocks follow their `order`. */}
        <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-6">
          {/* 1. What needs my attention? */}
          <section aria-label="Needs attention" className="order-1 grid grid-cols-2 gap-3 md:grid-cols-4 lg:order-none">
            <AttentionTile icon={AlertCircle} label="Overdue" value={data.overdue.length} tone={data.overdue.length ? "critical" : "quiet"} href="/tasks?due=overdue" hint={data.overdue.length ? "to decide" : "all clear"} />
            <AttentionTile icon={Sun} label="Due today" value={data.dueToday.length} tone={data.dueToday.length ? "warning" : "quiet"} href="/tasks?due=today" hint={data.plannedToday.length ? `+${data.plannedToday.length} planned` : "nothing due"} />
            <AttentionTile icon={Hourglass} label="Follow-ups" value={data.followups.length} tone={data.followups.length ? "warning" : "quiet"} href="/waiting" hint={data.followups.length ? "due now" : "none due"} />
            <AttentionTile icon={Inbox} label="Inbox" value={data.counts.inbox} tone="quiet" href="/tasks?status=inbox" hint={data.counts.inbox ? "to triage" : "inbox zero"} />
          </section>

          {/* 4. What should I do next? — focus first */}
          <Card className="order-2 gap-3 border-primary/35 lg:order-none">
            <CardHeader className="items-center">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="bg-primary/15 text-primary flex size-7 items-center justify-center rounded-md">
                  <Target className="size-4" />
                </span>
                Focus today
                <span className="text-muted-foreground text-xs font-normal">Your top three</span>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                {data.focus.length ? "Change" : "Choose"}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {data.focus.length ? (
                data.focus.map((t) => <TaskRow key={t.id} task={t} onToggleComplete={toggle} trailing={<span className="text-subtle-foreground nums mr-1 text-xs font-semibold">#{t.focus_rank}</span>} />)
              ) : (
                <EmptyState compact icon={<Target />} title="Pick what matters most today" description="Choose up to three tasks to keep front and center. Everything else waits below." action={<Button size="sm" onClick={() => setPickerOpen(true)}>Choose priorities</Button>} />
              )}
            </CardContent>
          </Card>

          <section className="order-3 lg:order-none">
            <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Sun className="text-muted-foreground size-4" /> Today</span>} count={todayCount} action={<Button variant="ghost" size="sm" onClick={() => openQuickAdd({ due_date: today })}><Plus /> Add for today</Button>} />
            {todayCount ? (
              <div className="flex flex-col gap-1.5">
                {data.dueToday.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                ))}
                {data.plannedToday.length ? (
                  <>
                    <p className="text-subtle-foreground mt-1 text-xs font-medium">Planned for today · no deadline today</p>
                    {data.plannedToday.map((t) => (
                      <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                    ))}
                  </>
                ) : null}
              </div>
            ) : (
              <EmptyState compact icon={<CheckCircle2 />} title="Nothing due today" description="Pull something forward from this week, or capture a new task." />
            )}
          </section>

          {data.overdue.length ? (
            <section className="order-4 lg:order-none">
              <SectionHeader title={<span className="text-destructive inline-flex items-center gap-1.5"><AlertCircle className="size-4" /> Overdue</span>} count={data.overdue.length} action={<Link href="/tasks?due=overdue" className="text-muted-foreground hover:text-foreground text-xs">View all</Link>} />
              <div className="flex flex-col gap-1.5">
                {data.overdue.slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                ))}
                {data.overdue.length > 6 ? (
                  <Link href="/tasks?due=overdue" className="text-muted-foreground hover:text-foreground text-xs">
                    +{data.overdue.length - 6} more overdue
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="order-6 lg:order-none">
            <SectionHeader title="Next 7 days" count={data.dueWeek.length} action={<Link href="/tasks?due=week" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">Open tasks <ArrowRight className="size-3" /></Link>} />
            {data.dueWeek.length ? (
              <div className="flex flex-col gap-3">
                {weekGroups.map((g) => (
                  <div key={g.date}>
                    <p className="text-subtle-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">{relativeDayLabel(g.date, today)}</p>
                    <div className="flex flex-col gap-1.5">
                      {g.tasks.map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No deadlines in the next week" description="Deadlines you add will show up here as they approach." />
            )}
          </section>

          <section className="order-10 lg:order-none">
            <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Trophy className="text-muted-foreground size-4" /> Recently completed</span>} count={data.recentlyCompleted.length} action={<Link href="/completed" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">Weekly review <ArrowRight className="size-3" /></Link>} />
            {data.recentlyCompleted.length ? (
              <div className="flex flex-col gap-1.5">
                {data.recentlyCompleted.slice(0, 4).map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                ))}
              </div>
            ) : (
              <EmptyState compact title="Nothing completed in the last 7 days yet" description="Completed tasks are kept here and in the Completed view." />
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          {/* 2. Where do I stand? */}
          <Card className="order-7 gap-3 lg:order-none">
            <CardHeader className="items-center">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="text-muted-foreground size-4" /> Where you stand
              </CardTitle>
              <Link href="/finances" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
                Finances <ArrowRight className="size-3" />
              </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {standing.finance ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Stat label="Net worth" value={fmtMoney(standing.finance.netWorth)} sub={standing.finance.netWorthDelta != null ? <span className={cn(standing.finance.netWorthDelta >= 0 ? "text-success" : "text-destructive")}>{fmtMoney(standing.finance.netWorthDelta, { sign: true, compact: true })} since last month</span> : "first snapshot"} href="/finances" />
                    <Stat label="Free cash / mo" value={fmtMoney(standing.finance.freeCashFlow)} tone={standing.finance.freeCashFlow < 0 ? "critical" : undefined} sub={standing.finance.unallocated > 0 ? `${fmtMoney(standing.finance.unallocated)} unallocated` : standing.finance.unallocated < 0 ? "over-committed" : "fully allocated"} href="/finances/budget" />
                    <Stat label="Debt" value={fmtMoney(standing.finance.debt)} sub={standing.finance.debtFreeMonth === 0 ? "debt-free" : standing.finance.debtFreeDate ? `free ${formatDate(standing.finance.debtFreeDate, "monthYear")}` : "not cleared in 10 yrs"} href="/finances/debt" />
                    <Stat label="Projects" value={String(standing.projects.active)} sub={standing.projects.overdue ? <span className="text-destructive">{standing.projects.overdue} overdue task{standing.projects.overdue === 1 ? "" : "s"}</span> : standing.projects.waiting ? `${standing.projects.waiting} waiting` : "on schedule"} href="/projects" />
                  </div>
                  {standing.finance.firstShortfallDate ? (
                    <p className="text-xs">
                      <Badge variant="destructive">Cash shortfall</Badge> <span className="text-muted-foreground">checking goes negative in {formatDate(standing.finance.firstShortfallDate, "monthYear")} at the current plan.</span>
                    </p>
                  ) : null}
                  <p className="text-subtle-foreground text-[11px]">{standing.finance.lastSyncedAt ? `Bank balances synced ${timeAgo(standing.finance.lastSyncedAt)}` : "Balances entered by hand"}</p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Stat label="Projects" value={String(standing.projects.active)} sub={standing.projects.overdue ? <span className="text-destructive">{standing.projects.overdue} overdue</span> : "active"} href="/projects" />
                    <Stat label="Events" value={String(data.events.length)} sub="next 30 days" href="/events" />
                  </div>
                  <EmptyState compact title="No financial picture yet" description="Add income, expenses and accounts to see net worth and cash flow here." action={<Button asChild size="sm" variant="outline"><Link href="/finances">Set up finances</Link></Button>} />
                </>
              )}
            </CardContent>
          </Card>

          {/* 3. What am I working toward? */}
          <Card className="order-8 gap-3 lg:order-none">
            <CardHeader className="items-center">
              <CardTitle className="flex items-center gap-2">
                <Flag className="text-muted-foreground size-4" /> Working toward
              </CardTitle>
              <Link href="/finances/goals" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
                Goals <ArrowRight className="size-3" />
              </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {standing.finance?.goals.length ? (
                <ul className="flex flex-col gap-3">
                  {standing.finance.goals.map((g) => (
                    <li key={g.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link href="/finances/goals" className="min-w-0 truncate text-sm font-medium hover:underline">
                          {g.name}
                        </Link>
                        <GoalStatusBadge status={g.status} />
                      </div>
                      <ProgressMeter value={g.startAmount} target={g.targetAmount} tone={GOAL_STATUS_META[g.status].tone} />
                      <div className="text-subtle-foreground nums flex justify-between text-[11px]">
                        <span>{g.progressPct.toFixed(0)}% of {fmtMoney(g.targetAmount, { compact: true })}</span>
                        <span>{g.projectedDate ? `projected ${formatDate(g.projectedDate, "monthYear")}` : "no projection"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No financial goals yet. <Link href="/finances/goals" className="text-primary-soft hover:underline">Add one</Link> to see projected dates here.</p>
              )}
              {standing.projects.upcoming.length ? (
                <div className="border-border/70 border-t pt-3">
                  <p className="text-subtle-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">Projects with target dates</p>
                  <ul className="flex flex-col gap-2.5">
                    {standing.projects.upcoming.map((p) => {
                      const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;
                      const days = p.target_date ? diffDays(today, p.target_date) : null;
                      return (
                        <li key={p.id} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <Link href={`/projects/${p.id}`} className="flex min-w-0 items-center gap-1.5 font-medium hover:underline">
                              <FolderKanban className="text-muted-foreground size-3.5 shrink-0" />
                              <span className="truncate">{p.name}</span>
                            </Link>
                            <span className={cn("nums shrink-0 text-xs", days != null && days < 0 ? "text-destructive" : days != null && days <= 7 ? "text-warning" : "text-muted-foreground")}>{p.target_date ? (days === 0 ? "today" : days! < 0 ? `${-days!}d late` : `${days}d left`) : "no date"}</span>
                          </div>
                          <ProgressMeter value={pct} target={100} tone={p.overdue_count ? "serious" : "neutral"} />
                          <div className="text-subtle-foreground flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1 truncate">{p.area ? <AreaDot color={p.area.color} /> : null}{p.next_action ?? `${p.task_done}/${p.task_total} tasks`}</span>
                            <span className="nums shrink-0">{pct}%</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <section className="order-5 lg:order-none">
            <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Hourglass className="text-muted-foreground size-4" /> Follow-ups due</span>} count={data.followups.length} action={<Link href="/waiting" className="text-muted-foreground hover:text-foreground text-xs">Waiting On</Link>} />
            {data.followups.length ? (
              <div className="flex flex-col gap-1.5">
                {data.followups.map((t) => (
                  <div key={t.id} className="border-border/70 bg-card rounded-lg border p-3">
                    <TaskRow task={t} onToggleComplete={toggle} dense className="border-0 bg-transparent px-0 py-0 hover:bg-transparent" />
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      {t.waiting_expected_date ? <Badge variant={t.waiting_expected_date < today ? "destructive" : "muted"}>Their deadline: {relativeDayLabel(t.waiting_expected_date, today)}</Badge> : null}
                      {t.waiting_followup_date ? <Badge variant={t.waiting_followup_date <= today ? "warning" : "muted"}>My follow-up: {relativeDayLabel(t.waiting_followup_date, today)}</Badge> : null}
                    </div>
                    <div className="mt-2">
                      <WaitingActions task={t} compact />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No follow-ups due" description="Tasks marked “Waiting on Someone” show up here when a follow-up is due." />
            )}
          </section>

          <section className="order-9 lg:order-none">
            <SectionHeader title={<span className="inline-flex items-center gap-1.5"><CalendarDays className="text-muted-foreground size-4" /> Upcoming events</span>} count={data.events.length} hint="next 30 days" action={<Link href="/events" className="text-muted-foreground hover:text-foreground text-xs">All events</Link>} />
            {data.events.length ? (
              <div className="flex flex-col gap-1.5">
                {data.events.slice(0, 5).map((e) => (
                  <EventRow key={e.id} event={e} prepOpen={e.prep_open} prepTotal={e.prep_total} socialOpen={e.social_open} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<CalendarDays />} title="No events in the next 30 days" description="Connect Monday.com in Settings or add an event manually." action={<Button asChild size="sm" variant="outline"><Link href="/events">Go to Events</Link></Button>} />
            )}
          </section>

          <section className="order-9 lg:order-none">
            <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Megaphone className="text-muted-foreground size-4" /> Social deadlines</span>} count={data.socialSoon.length} hint="next 7 days" action={<Link href="/calendar?preset=content" className="text-muted-foreground hover:text-foreground text-xs">Content calendar</Link>} />
            {data.socialSoon.length ? (
              <div className="flex flex-col gap-1.5">
                {data.socialSoon.slice(0, 6).map((p) => (
                  <SocialPostRow key={p.id} post={p} dense />
                ))}
              </div>
            ) : (
              <EmptyState compact title="No social deadlines this week" description="Posts with draft, approval or publish dates in the next 7 days appear here." />
            )}
          </section>
        </div>
      </div>

      <FocusPicker open={pickerOpen} onOpenChange={setPickerOpen} current={data.focus.map((t) => t.id)} />
      {attention === 0 && todayCount === 0 ? <p className="sr-only">Nothing needs attention right now.</p> : null}
    </div>
  );
}

function AttentionTile({ icon: Icon, label, value, hint, tone, href }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; hint: string; tone: "critical" | "warning" | "quiet"; href: string }) {
  return (
    <Link href={href} className={cn("group bg-card border-border/80 hover:bg-accent/40 flex items-center gap-3 rounded-xl border px-3.5 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", tone === "critical" && "border-destructive/40", tone === "warning" && "border-warning/40")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone === "critical" ? "bg-destructive/12 text-destructive" : tone === "warning" ? "bg-warning/12 text-warning" : "bg-secondary text-muted-foreground")}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="text-subtle-foreground block text-[11px] font-semibold tracking-wide uppercase">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={cn("nums text-xl leading-tight font-semibold", tone === "critical" && value > 0 ? "text-destructive" : tone === "warning" && value > 0 ? "text-warning" : "text-foreground")}>{value}</span>
          <span className="text-muted-foreground truncate text-xs">{hint}</span>
        </span>
      </span>
    </Link>
  );
}

function Stat({ label, value, sub, tone, href }: { label: string; value: string; sub?: React.ReactNode; tone?: "critical"; href: string }) {
  return (
    <Link href={href} className="hover:bg-accent/40 -mx-1.5 flex flex-col gap-0.5 rounded-lg px-1.5 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring">
      <span className="text-subtle-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className={cn("nums text-lg leading-tight font-semibold", tone === "critical" ? "text-destructive" : "text-foreground")}>{value}</span>
      {sub ? <span className="text-muted-foreground text-[11px]">{sub}</span> : null}
    </Link>
  );
}

function groupByDate(tasks: TaskWithRefs[]) {
  const map = new Map<string, TaskWithRefs[]>();
  for (const t of tasks) {
    const k = t.due_date ?? "";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, ts]) => ({ date, tasks: ts }));
}

export { fmtMonths as _fmtMonths };
