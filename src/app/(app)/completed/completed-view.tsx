"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Copy, Download, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, RowList, SectionHeader, SectionLink, SocialPostRow, SubHeading, TaskRow } from "@/components/app/items";
import { FilterBar } from "@/components/app/filter-bar";
import { Metric, MetricStrip } from "@/components/app/metric";
import { fieldClassName } from "@/components/ui/input";
import { DateInput } from "@/components/app/form-fields";
import { useWorkspace } from "@/components/app/workspace-provider";
import { ProjectCard } from "../projects/projects-view";
import { reopenTask, completeTask } from "@/actions/tasks";
import type { CompletedData } from "@/lib/data/completed";
import type { TaskWithRefs } from "@/lib/types";
import { formatDate, isoToDateOnly } from "@/lib/dates";
import { groupSummary, summaryMarkdown } from "@/lib/summary";

export function CompletedView({ data, range, from, to, area, project }: { data: CompletedData; range: string; from: string; to: string; area: string | null; project: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { workAreas, projects, today, timezone } = useWorkspace();
  const [by, setBy] = React.useState<"project" | "area">("project");
  const [, startTransition] = React.useTransition();

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  function toggle(task: TaskWithRefs) {
    startTransition(async () => {
      const res = task.status === "completed" ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  const groups = groupSummary(data.tasks, data.posts, data.projects, by);
  const markdown = summaryMarkdown({ from, to, groups, carryOver: data.carryOver, timeZone: timezone, by });

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Summary copied");
    } catch {
      toast.error("Could not copy. Select the text below instead.");
    }
  }

  const exportHref = (type: string) => `/api/export?type=${type}&from=${from}&to=${to}${area ? `&area=${area}` : ""}${project ? `&project=${project}` : ""}`;
  const byDay = groupByDay(data.tasks, timezone);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Completed" description="Everything you finished, kept as a record. Counts are activity, not impact.">
        <FilterBar
          activeCount={(area ? 1 : 0) + (project ? 1 : 0)}
          onReset={() => setParams({ area: null, project: null })}
          view={
            <Tabs value={range} onValueChange={(v) => setParams({ range: v, from: null, to: null })}>
              <TabsList aria-label="Range">
                <TabsTrigger value="week">This week</TabsTrigger>
                <TabsTrigger value="lastweek">Last week</TabsTrigger>
                <TabsTrigger value="month">This month</TabsTrigger>
                <TabsTrigger value="30">Last 30 days</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          search={
            range === "custom" ? (
              <div className="flex items-center gap-1.5">
                <DateInput value={from} onChange={(v) => v && setParams({ from: v })} className="w-36" aria-label="From" />
                <span className="text-text-3 text-meta">to</span>
                <DateInput value={to} onChange={(v) => v && setParams({ to: v })} className="w-36" aria-label="To" />
              </div>
            ) : (
              <span className="text-text-3 nums text-meta">
                {formatDate(from, "medium", today)} – {formatDate(to, "medium", today)}
              </span>
            )
          }
        >
          <NativeSelect className="w-40" value={area ?? ""} onChange={(e) => setParams({ area: e.target.value || null, project: null })} aria-label="Work area">
            <option value="">All work areas</option>
            {workAreas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
          <NativeSelect className="w-44" value={project ?? ""} onChange={(e) => setParams({ project: e.target.value || null })} aria-label="Project">
            <option value="">All projects</option>
            {projects.filter((p) => !area || p.work_area_id === area).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </NativeSelect>
        </FilterBar>
      </PageHeader>

      <MetricStrip cols={4} className="mb-7">
        <Metric size="sm" label="Tasks · week" value={data.counts.tasksThisWeek} muted={!data.counts.tasksThisWeek} />
        <Metric size="sm" label="Tasks · month" value={data.counts.tasksThisMonth} muted={!data.counts.tasksThisMonth} />
        <Metric size="sm" label="Posts · week" value={data.counts.postsThisWeek} muted={!data.counts.postsThisWeek} sub="published" />
        <Metric size="sm" label="Posts · month" value={data.counts.postsThisMonth} muted={!data.counts.postsThisMonth} sub="published" />
      </MetricStrip>

      <div className="grid grid-cols-1 gap-x-10 gap-y-7 lg:grid-cols-3">
        <div className="flex flex-col gap-7 lg:col-span-2">
          <section>
            <SectionHeader title="Tasks completed" count={data.tasks.length} />
            {data.tasks.length ? (
              <div className="mt-2">
                {byDay.map((d) => (
                  <React.Fragment key={d.date}>
                    <SubHeading count={d.tasks.length}>{formatDate(d.date, "weekday", today)}</SubHeading>
                    <RowList>
                      {d.tasks.map((t) => (
                        <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                      ))}
                    </RowList>
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Trophy />} title="No tasks completed in this range" description="Completed tasks are kept here with their completion time. Reopen any of them from its detail panel." />
            )}
          </section>

          <section>
            <SectionHeader title="Projects completed" count={data.projects.length} />
            {data.projects.length ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} today={today} />
                ))}
              </div>
            ) : (
              <p className="text-text-3 text-meta py-1.5">No projects marked completed in this range.</p>
            )}
          </section>

          <section>
            <SectionHeader title="Social posts published" count={data.posts.length} />
            {data.posts.length ? (
              <RowList>
                {data.posts.map((p) => (
                  <SocialPostRow key={p.id} post={p} dense />
                ))}
              </RowList>
            ) : (
              <p className="text-text-3 text-meta py-1.5">No posts marked published in this range.</p>
            )}
          </section>

          <section>
            <SectionHeader title="Carrying into next week" count={data.carryOver.length} hint="open tasks due by the end of this week" action={<SectionLink href="/tasks?due=week">Plan them</SectionLink>} />
            {data.carryOver.length ? (
              <RowList>
                {data.carryOver.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                ))}
              </RowList>
            ) : (
              <p className="text-text-3 text-meta py-1.5">Nothing overdue or due this week is still open.</p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-3">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-heading">Weekly summary</p>
                <NativeSelect className="w-36" value={by} onChange={(e) => setBy(e.target.value as "project" | "area")} aria-label="Group summary by">
                  <option value="project">By project</option>
                  <option value="area">By work area</option>
                </NativeSelect>
              </div>
              <textarea readOnly value={markdown} rows={16} className={`${fieldClassName} text-text-2 w-full p-2.5 font-mono text-xs leading-relaxed`} aria-label="Summary text" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copy}>
                  <Copy /> Copy
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={exportHref("tasks")} download>
                    <Download /> Tasks CSV
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={exportHref("posts")} download>
                    <Download /> Posts CSV
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={exportHref("summary")} download>
                    <Download /> Summary CSV
                  </a>
                </Button>
              </div>
              <p className="text-text-3 text-meta">Generated from your records only. Add the outcomes and context yourself before sending.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function groupByDay(tasks: TaskWithRefs[], tz: string) {
  const map = new Map<string, TaskWithRefs[]>();
  for (const t of tasks) {
    const d = t.completed_at ? isoToDateOnly(t.completed_at, tz) : "";
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(t);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a > b ? -1 : 1)).map(([date, ts]) => ({ date, tasks: ts }));
}
