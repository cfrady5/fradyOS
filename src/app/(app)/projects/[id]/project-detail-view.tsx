"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Pencil, Plus, Trash2, AlertCircle, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";
import { AreaDot, EventRow, PriorityBadge, SectionHeader, SocialPostRow, TaskRow } from "@/components/app/items";
import { ProjectDialog } from "@/components/app/project-dialog";
import { AttachmentsList, NotesList } from "@/components/app/detail-parts";
import { WaitingActions } from "@/components/app/waiting-actions";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { completeTask, reopenTask } from "@/actions/tasks";
import { deleteProject } from "@/actions/projects";
import type { ProjectDetail } from "@/lib/data/projects";
import { labelFor, PROJECT_STATUSES, type TaskWithRefs } from "@/lib/types";
import { formatDate, dueBucket, formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { NewSocialPostButton } from "@/components/app/new-social-post-dialog";

export function ProjectDetailView({ detail }: { detail: ProjectDetail }) {
  const router = useRouter();
  const { today, timezone } = useWorkspace();
  const { openQuickAdd } = useShell();
  const [editOpen, setEditOpen] = React.useState(false);
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [, startTransition] = React.useTransition();
  const p = detail.project;

  function toggle(task: TaskWithRefs) {
    startTransition(async () => {
      const res = task.status === "completed" ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete “${p.name}”? Tasks stay but lose their project link.`)) return;
    startTransition(async () => {
      const res = await deleteProject(p.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Project deleted");
      router.push("/projects");
    });
  }

  const open = detail.tasks.filter((t) => t.status !== "completed" && t.status !== "waiting");
  const waiting = detail.tasks.filter((t) => t.status === "waiting");
  const done = detail.tasks.filter((t) => t.status === "completed");
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;
  const targetBucket = dueBucket(p.target_date, today);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <Link href="/projects" className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline">
          <ArrowLeft className="size-3" /> Projects
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{p.name}</h1>
            <Badge variant={p.status === "active" ? "default" : p.status === "completed" ? "success" : p.status === "on_hold" ? "warning" : "muted"}>{labelFor(PROJECT_STATUSES, p.status)}</Badge>
            <PriorityBadge priority={p.priority} />
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {p.work_area ? (
              <span className="inline-flex items-center gap-1">
                <AreaDot color={p.work_area.color} /> {p.work_area.name}
              </span>
            ) : null}
            {p.target_date ? (
              <span className={cn(targetBucket === "overdue" && p.status !== "completed" ? "text-destructive" : "")}>Target {formatDate(p.target_date, "weekday", today)}</span>
            ) : null}
            {p.completed_at ? <span>Completed {formatTimestamp(p.completed_at, timezone, { withYear: true })}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil /> Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="bg-card rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Progress value={pct} className="flex-1" />
              <span className="text-sm tabular-nums">{pct}%</span>
            </div>
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                {p.task_done} of {p.task_total} tasks complete
              </span>
              {overdue.length ? (
                <span className="text-destructive inline-flex items-center gap-1">
                  <AlertCircle className="size-3" /> {overdue.length} overdue
                </span>
              ) : null}
              {waiting.length ? (
                <span className="inline-flex items-center gap-1">
                  <Hourglass className="size-3" /> {waiting.length} waiting on others
                </span>
              ) : null}
            </div>
            {p.next_action ? (
              <p className="mt-3 text-sm">
                <span className="text-muted-foreground">Next action:</span> <span className="font-medium">{p.next_action}</span>
              </p>
            ) : null}
          </div>

          <section>
            <SectionHeader title="Tasks" count={open.length} action={<Button size="sm" variant="outline" onClick={() => openQuickAdd({ project_id: p.id, work_area_id: p.work_area_id })}><Plus /> Add task</Button>} />
            {open.length ? (
              <div className="flex flex-col gap-1.5">
                {open.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} showProject={false} />
                ))}
              </div>
            ) : (
              <EmptyState compact title="No open tasks" description="Add the next concrete step for this project." />
            )}
          </section>

          {waiting.length ? (
            <section>
              <SectionHeader title="Waiting on others" count={waiting.length} />
              <div className="flex flex-col gap-1.5">
                {waiting.map((t) => (
                  <div key={t.id} className="rounded-md border bg-card p-2.5">
                    <TaskRow task={t} onToggleComplete={toggle} showProject={false} className="border-0 bg-transparent px-0 py-0 hover:bg-transparent" />
                    <div className="mt-2">
                      <WaitingActions task={t} compact />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <SectionHeader title="Completed" count={done.length} action={done.length ? <Button variant="ghost" size="sm" onClick={() => setShowCompleted((v) => !v)}>{showCompleted ? "Hide" : "Show"}</Button> : undefined} />
            {showCompleted && done.length ? (
              <div className="flex flex-col gap-1.5">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} showProject={false} dense />
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {p.description ? (
            <section className="bg-card rounded-lg border p-3">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</h2>
              <p className="whitespace-pre-wrap text-sm">{p.description}</p>
            </section>
          ) : null}
          {p.links.length ? (
            <section className="bg-card rounded-lg border p-3">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</h2>
              <ul className="flex flex-col gap-1">
                {p.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex items-center gap-1 text-sm hover:underline">
                      <ExternalLink className="size-3.5" /> {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <SectionHeader title="Events" count={detail.events.length} />
            {detail.events.length ? (
              <div className="flex flex-col gap-1.5">
                {detail.events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Link events to this project from the event page.</p>
            )}
          </section>

          <section>
            <SectionHeader title="Social posts" count={detail.posts.length} action={<NewSocialPostButton preset={{ project_id: p.id, work_area_id: p.work_area_id }} size="sm" variant="outline" />} />
            {detail.posts.length ? (
              <div className="flex flex-col gap-1.5">
                {detail.posts.map((post) => (
                  <SocialPostRow key={post.id} post={post} dense />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">No social posts linked yet.</p>
            )}
          </section>

          <Separator />
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
            <NotesList parent={{ project_id: p.id }} notes={detail.notes} onChanged={() => router.refresh()} />
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h2>
            <AttachmentsList parent={{ project_id: p.id }} attachments={detail.attachments} onChanged={() => router.refresh()} />
          </section>
        </div>
      </div>

      <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={p} />
    </div>
  );
}
