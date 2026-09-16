"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CalendarDays, CheckCircle2, Hourglass, Megaphone, Star, Sun, Trophy, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { EventRow, SocialPostRow, TaskRow, SectionHeader } from "@/components/app/items";
import { FocusPicker } from "@/components/app/focus-picker";
import { WaitingActions } from "@/components/app/waiting-actions";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { completeTask, reopenTask } from "@/actions/tasks";
import type { TodayData } from "@/lib/data/today";
import type { TaskWithRefs } from "@/lib/types";
import { relativeDayLabel } from "@/lib/dates";

export function TodayView({ data }: { data: TodayData }) {
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Left column: what to work on */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="size-4 fill-amber-400 text-amber-400" /> Top three priorities
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              {data.focus.length ? "Change" : "Choose"}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {data.focus.length ? (
              data.focus.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggleComplete={toggle}
                  trailing={<span className="text-muted-foreground mr-1 text-xs font-semibold tabular-nums">#{t.focus_rank}</span>}
                />
              ))
            ) : (
              <EmptyState
                compact
                icon={<Star />}
                title="Pick what matters most today"
                description="Choose up to three tasks to keep front and center."
                action={
                  <Button size="sm" onClick={() => setPickerOpen(true)}>
                    Choose priorities
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        {data.overdue.length ? (
          <section>
            <SectionHeader title={<span className="text-destructive inline-flex items-center gap-1.5"><AlertCircle className="size-4" /> Overdue</span>} count={data.overdue.length} action={<Link href="/tasks?due=overdue" className="text-muted-foreground text-xs hover:underline">View all</Link>} />
            <div className="flex flex-col gap-1.5">
              {data.overdue.slice(0, 8).map((t) => (
                <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
              ))}
              {data.overdue.length > 8 ? (
                <Link href="/tasks?due=overdue" className="text-muted-foreground text-xs hover:underline">
                  +{data.overdue.length - 8} more overdue
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        <section>
          <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Sun className="size-4" /> Today</span>} count={data.dueToday.length + data.plannedToday.length} action={<Button variant="ghost" size="sm" onClick={() => openQuickAdd({ due_date: today })}><Plus /> Add for today</Button>} />
          {data.dueToday.length || data.plannedToday.length ? (
            <div className="flex flex-col gap-1.5">
              {data.dueToday.map((t) => (
                <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
              ))}
              {data.plannedToday.length ? (
                <>
                  <p className="text-muted-foreground mt-1 text-xs font-medium">Planned for today (no deadline today)</p>
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

        <section>
          <SectionHeader title="Next 7 days" count={data.dueWeek.length} action={<Link href="/tasks?due=week" className="text-muted-foreground text-xs hover:underline">Open tasks</Link>} />
          {data.dueWeek.length ? (
            <div className="flex flex-col gap-2">
              {weekGroups.map((g) => (
                <div key={g.date}>
                  <p className="text-muted-foreground mb-1 text-xs font-medium">{relativeDayLabel(g.date, today)}</p>
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

        <section>
          <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Trophy className="size-4" /> Recently completed</span>} count={data.recentlyCompleted.length} action={<Link href="/completed" className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline">Weekly review <ArrowRight className="size-3" /></Link>} />
          {data.recentlyCompleted.length ? (
            <div className="flex flex-col gap-1.5">
              {data.recentlyCompleted.slice(0, 6).map((t) => (
                <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
              ))}
            </div>
          ) : (
            <EmptyState compact title="Nothing completed in the last 7 days yet" description="Completed tasks are kept here and in the Completed view." />
          )}
        </section>
      </div>

      {/* Right column: events, social, follow-ups */}
      <div className="flex flex-col gap-4">
        <section>
          <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Hourglass className="size-4" /> Follow-ups due</span>} count={data.followups.length} action={<Link href="/waiting" className="text-muted-foreground text-xs hover:underline">Waiting On</Link>} />
          {data.followups.length ? (
            <div className="flex flex-col gap-1.5">
              {data.followups.map((t) => (
                <div key={t.id} className="rounded-md border bg-card p-2.5">
                  <TaskRow task={t} onToggleComplete={toggle} dense className="border-0 bg-transparent px-0 py-0 hover:bg-transparent" />
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {t.waiting_expected_date ? (
                      <Badge variant={t.waiting_expected_date < today ? "destructive" : "muted"}>Their deadline: {relativeDayLabel(t.waiting_expected_date, today)}</Badge>
                    ) : null}
                    {t.waiting_followup_date ? (
                      <Badge variant={t.waiting_followup_date <= today ? "warning" : "muted"}>My follow-up: {relativeDayLabel(t.waiting_followup_date, today)}</Badge>
                    ) : null}
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

        <section>
          <SectionHeader title={<span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" /> Upcoming events</span>} count={data.events.length} hint="next 30 days" action={<Link href="/events" className="text-muted-foreground text-xs hover:underline">All events</Link>} />
          {data.events.length ? (
            <div className="flex flex-col gap-1.5">
              {data.events.slice(0, 6).map((e) => (
                <EventRow key={e.id} event={e} prepOpen={e.prep_open} prepTotal={e.prep_total} socialOpen={e.social_open} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<CalendarDays />} title="No events in the next 30 days" description="Connect Monday.com in Settings or add an event manually." action={<Button asChild size="sm" variant="outline"><Link href="/events">Go to Events</Link></Button>} />
          )}
        </section>

        <section>
          <SectionHeader title={<span className="inline-flex items-center gap-1.5"><Megaphone className="size-4" /> Social deadlines</span>} count={data.socialSoon.length} hint="next 7 days" action={<Link href="/calendar?preset=content" className="text-muted-foreground text-xs hover:underline">Content calendar</Link>} />
          {data.socialSoon.length ? (
            <div className="flex flex-col gap-1.5">
              {data.socialSoon.slice(0, 8).map((p) => (
                <SocialPostRow key={p.id} post={p} dense />
              ))}
            </div>
          ) : (
            <EmptyState compact title="No social deadlines this week" description="Posts with draft, approval or publish dates in the next 7 days appear here." />
          )}
        </section>
      </div>

      <FocusPicker open={pickerOpen} onOpenChange={setPickerOpen} current={data.focus.map((t) => t.id)} />
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
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, ts]) => ({ date, tasks: ts }));
}
