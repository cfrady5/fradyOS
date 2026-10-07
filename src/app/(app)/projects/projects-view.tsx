"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FolderKanban, Plus, AlertCircle, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { AreaTag, PageHeader, PriorityBadge, SectionHeader } from "@/components/app/items";
import { FilterBar } from "@/components/app/filter-bar";
import { ProjectDialog } from "@/components/app/project-dialog";
import { useWorkspace } from "@/components/app/workspace-provider";
import { labelFor, PROJECT_STATUSES, type ProjectWithStats, type WorkArea } from "@/lib/types";
import { formatDate, dueBucket } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function ProjectsView({ projects, area, status, workAreas }: { projects: ProjectWithStats[]; area: string | null; status: string | null; workAreas: WorkArea[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { today } = useWorkspace();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  function setParam(k: string, v: string | null) {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  }

  const groups = [...workAreas.filter((a) => !a.is_archived).map((a) => ({ key: a.id, name: a.name, color: a.color, items: projects.filter((p) => p.work_area_id === a.id) })), { key: "none", name: "No work area", color: "#94a3b8", items: projects.filter((p) => !p.work_area_id) }].filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Projects"
        description="Grouped by work area. Progress reflects completed tasks."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> New project
          </Button>
        }
      >
        <FilterBar activeCount={(area ? 1 : 0) + (status ? 1 : 0)} onReset={() => router.push(pathname)}>
          <NativeSelect className="w-44" value={area ?? ""} onChange={(e) => setParam("area", e.target.value || null)} aria-label="Filter by work area">
            <option value="">All work areas</option>
            {workAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="w-40" value={status ?? ""} onChange={(e) => setParam("status", e.target.value || null)} aria-label="Filter by status">
            <option value="">Active & planned</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="all">Everything</option>
          </NativeSelect>
        </FilterBar>
      </PageHeader>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description="Projects group tasks, events, social posts and notes. Create one for each initiative you're driving."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus /> New project
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.name}>
              <SectionHeader title={<AreaTag name={g.name} color={g.color} className="text-heading" />} count={g.items.length} />
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((p) => (
                  <ProjectCard key={p.id} project={p} today={today} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultAreaId={area} />
    </div>
  );
}

export function ProjectCard({ project: p, today }: { project: ProjectWithStats; today: string }) {
  const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;
  const targetBucket = dueBucket(p.target_date, today);
  return (
    <Link href={`/projects/${p.id}`} className="bg-surface-1 border-line-1 hover:border-line-2 hover:bg-surface-hover focus-visible:ring-brand/40 flex flex-col gap-3 rounded-lg border p-4 transition-colors duration-150 outline-none focus-visible:ring-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-text-1 truncate text-sm font-medium">{p.name}</p>
          {p.next_action ? <p className="text-text-2 text-meta mt-0.5 line-clamp-2">Next: {p.next_action}</p> : p.description ? <p className="text-text-2 text-meta mt-0.5 line-clamp-2">{p.description}</p> : null}
        </div>
        <Badge variant={p.status === "active" ? "default" : p.status === "completed" ? "success" : p.status === "on_hold" ? "warning" : "muted"}>{labelFor(PROJECT_STATUSES, p.status)}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="flex-1" aria-label={`${pct}% of tasks complete`} />
        <span className="text-text-3 nums text-meta">
          {p.task_done}/{p.task_total}
        </span>
      </div>
      <div className="text-text-3 text-meta flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <PriorityBadge priority={p.priority} />
        {p.target_date ? (
          <span className={cn("nums", targetBucket === "overdue" && p.status !== "completed" ? "text-danger" : "")}>
            Target {formatDate(p.target_date, "medium", today)}
          </span>
        ) : null}
        {p.overdue_count ? (
          <span className="text-danger inline-flex items-center gap-1">
            <AlertCircle className="size-3" /> {p.overdue_count} overdue
          </span>
        ) : null}
        {p.waiting_count ? (
          <span className="inline-flex items-center gap-1">
            <Hourglass className="size-3" /> {p.waiting_count} waiting
          </span>
        ) : null}
      </div>
    </Link>
  );
}
