"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Lock, Pencil, Plus, Trash2, Archive, AlertTriangle, CalendarClock, Check, Loader2, Wand2, MapPin, User, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaDot, SectionHeader, SocialPostRow, TaskRow } from "@/components/app/items";
import { EventDialog } from "@/components/app/event-dialog";
import { AttachmentsList, NotesList } from "@/components/app/detail-parts";
import { AreaSelect, Field, ProjectSelect } from "@/components/app/form-fields";
import { NewSocialPostButton } from "@/components/app/new-social-post-dialog";
import { ApplyTemplateDialog } from "@/components/app/apply-template-dialog";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { completeTask, reopenTask } from "@/actions/tasks";
import { acknowledgeEventDateChange, archiveEvent, deleteEvent, dismissEventFlag, updateEvent } from "@/actions/events";
import { acceptDateProposals, keepDatesForProposals } from "@/actions/templates";
import type { EventDetail } from "@/lib/data/events";
import type { TaskWithRefs } from "@/lib/types";
import { formatDate, formatDateRange, formatTime, formatTimestamp } from "@/lib/dates";
import { proposeDateChanges } from "@/lib/templates";

export function EventDetailView({ detail }: { detail: EventDetail }) {
  const router = useRouter();
  const { today, timezone } = useWorkspace();
  const { openQuickAdd } = useShell();
  const [editOpen, setEditOpen] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const e = detail.event;
  const isMonday = e.source === "monday";

  const [local, setLocal] = React.useState({ work_area_id: e.work_area_id, project_id: e.project_id, local_notes: e.local_notes ?? "" });
  const localDirty = local.work_area_id !== e.work_area_id || local.project_id !== e.project_id || local.local_notes !== (e.local_notes ?? "");

  function toggle(task: TaskWithRefs) {
    startTransition(async () => {
      const res = task.status === "completed" ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  const openTasks = detail.tasks.filter((t) => t.status !== "completed");
  const doneTasks = detail.tasks.filter((t) => t.status === "completed");
  const pct = detail.tasks.length ? Math.round((doneTasks.length / detail.tasks.length) * 100) : 0;
  const proposals = proposeDateChanges(e.start_date, detail.tasks, detail.posts);
  // Everything is selected by default; the user can deselect individual proposals.
  const [deselected, setDeselected] = React.useState<Set<string>>(new Set());
  const selected = new Set(proposals.map((p) => p.id).filter((id) => !deselected.has(id)));
  const flagged = e.sync_flag !== "none" && !e.review_dismissed_at;

  function applyProposals(mode: "accept" | "keep") {
    const task_ids = proposals.filter((p) => p.kind === "task" && selected.has(p.id)).map((p) => p.id);
    const post_ids = proposals.filter((p) => p.kind === "social" && selected.has(p.id)).map((p) => p.id);
    startTransition(async () => {
      const res = mode === "accept" ? await acceptDateProposals({ event_id: e.id, task_ids, post_ids }) : await keepDatesForProposals({ event_id: e.id, task_ids, post_ids });
      if (!res.ok) return void toast.error(res.error);
      toast.success(mode === "accept" ? `Updated ${res.data.updated} item${res.data.updated === 1 ? "" : "s"}` : `Kept current dates for ${res.data.updated} item${res.data.updated === 1 ? "" : "s"}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <Link href="/events" className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline">
          <ArrowLeft className="size-3" /> Events
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{e.name}</h1>
            {isMonday ? (
              <Badge variant="muted"><Lock /> Synced from Monday.com</Badge>
            ) : (
              <Badge variant="secondary">Manual</Badge>
            )}
            {e.status ? <Badge variant="outline">{e.status}</Badge> : null}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" /> {e.start_date ? formatDateRange(e.start_date, e.end_date, today) : "No date"}{e.start_time ? ` · ${formatTime(e.start_time)}` : ""}</span>
            {e.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {e.location}</span> : null}
            {e.owner ? <span className="inline-flex items-center gap-1"><User className="size-3.5" /> {e.owner}</span> : null}
            {e.program ? <span>{e.program}</span> : null}
            {e.website_url ? (
              <a href={e.website_url} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex items-center gap-1 hover:underline"><Globe className="size-3.5" /> Event website</a>
            ) : null}
            {e.monday_item_url ? (
              <a href={e.monday_item_url} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex items-center gap-1 hover:underline"><ExternalLink className="size-3.5" /> Open in Monday.com</a>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isMonday ? (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)} disabled={!e.start_date} title={!e.start_date ? "Add a start date first" : undefined}><Wand2 /> Apply template</Button>
          <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const r = await archiveEvent(e.id, !e.is_archived); if (!r.ok) toast.error(r.error); else { toast.success(e.is_archived ? "Restored" : "Archived"); router.refresh(); } })}>
            <Archive /> {e.is_archived ? "Restore" : "Archive"}
          </Button>
          {!isMonday || e.sync_flag === "removed" ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (!window.confirm("Delete this event? Linked tasks and posts are kept.")) return; startTransition(async () => { const r = await deleteEvent(e.id); if (!r.ok) toast.error(r.error); else { toast.success("Event deleted"); router.push("/events"); } }); }}>
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      {flagged ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>{e.sync_flag === "removed" ? "This item was removed from the Monday.com board" : "This event looks canceled in Monday.com"}</AlertTitle>
          <AlertDescription>
            <p>{e.sync_flag_reason}{e.sync_flag_at ? ` · noticed ${formatTimestamp(e.sync_flag_at, timezone)}` : ""}. Your {openTasks.length} open prep task{openTasks.length === 1 ? "" : "s"} and {detail.posts.filter((p) => p.status !== "published").length} pending post{detail.posts.filter((p) => p.status !== "published").length === 1 ? "" : "s"} were left untouched.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => { const r = await dismissEventFlag(e.id); if (!r.ok) toast.error(r.error); else router.refresh(); })}><Check /> Keep and dismiss</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => { const r = await archiveEvent(e.id); if (!r.ok) toast.error(r.error); else { toast.success("Archived"); router.refresh(); } })}><Archive /> Archive event</Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {e.dates_changed_at && e.previous_start_date !== undefined && (e.previous_start_date !== e.start_date || e.previous_end_date !== e.end_date) ? (
        <Alert variant="warning" className="mb-4">
          <CalendarClock />
          <AlertTitle>Event dates changed</AlertTitle>
          <AlertDescription>
            <p>
              {formatDateRange(e.previous_start_date, e.previous_end_date, today) || "No date"} → {formatDateRange(e.start_date, e.end_date, today) || "No date"} ({formatTimestamp(e.dates_changed_at, timezone)}).
              {proposals.length === 0 ? " No unfinished template-based items need moving." : ""}
            </p>
            <Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => startTransition(async () => { const r = await acknowledgeEventDateChange(e.id); if (!r.ok) toast.error(r.error); else router.refresh(); })}><Check /> Acknowledge</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {proposals.length ? (
        <div className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-3">
          <p className="text-sm font-semibold">Proposed date changes ({proposals.length})</p>
          <p className="text-muted-foreground mb-2 text-xs">The event moved. These unfinished items were created from a template and have not been manually overridden. Completed work and manual dates are never changed.</p>
          <ul className="flex flex-col gap-1">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-start gap-2 rounded-md bg-card px-2 py-1.5 text-sm">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => setDeselected((s) => { const n = new Set(s); if (v) n.delete(p.id); else n.add(p.id); return n; })} aria-label={`Select ${p.title}`} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{p.title}</span> <span className="text-muted-foreground text-xs">({p.kind === "task" ? "task" : "post"})</span>
                  <div className="text-muted-foreground text-xs tabular-nums">
                    {p.kind === "task" ? "Due" : "Publish"} {p.current.date ? formatDate(p.current.date, "medium", today) : "none"} → <span className="text-foreground font-medium">{formatDate(p.proposed.date, "medium", today)}</span>
                    {p.kind === "social" && (p.proposed.draft || p.proposed.approval) ? (
                      <span> · draft {p.proposed.draft ? formatDate(p.proposed.draft, "short", today) : "—"} · approval {p.proposed.approval ? formatDate(p.proposed.approval, "short", today) : "—"}</span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || selected.size === 0} onClick={() => applyProposals("accept")}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Apply selected</Button>
            <Button size="sm" variant="outline" disabled={pending || selected.size === 0} onClick={() => applyProposals("keep")}>Keep current dates for selected</Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <section>
            <SectionHeader title="Preparation checklist" count={openTasks.length} hint={detail.tasks.length ? `${doneTasks.length}/${detail.tasks.length} done` : undefined} action={<Button size="sm" variant="outline" onClick={() => openQuickAdd({ event_id: e.id, work_area_id: e.work_area_id, project_id: e.project_id, due_date: e.start_date })}><Plus /> Add prep task</Button>} />
            {detail.tasks.length ? <Progress value={pct} className="mb-2" /> : null}
            {openTasks.length ? (
              <div className="flex flex-col gap-1.5">
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                ))}
              </div>
            ) : (
              <EmptyState compact title="No open preparation tasks" description={e.start_date ? "Apply a template to generate milestones, or add tasks one by one." : "Add a start date to use templates."} action={e.start_date ? <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)}><Wand2 /> Apply template</Button> : undefined} />
            )}
            {doneTasks.length ? (
              <details className="mt-2">
                <summary className="text-muted-foreground cursor-pointer text-xs">{doneTasks.length} completed</summary>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {doneTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          <section>
            <SectionHeader title="Social media plan" count={detail.posts.length} action={<NewSocialPostButton preset={{ event_id: e.id, work_area_id: e.work_area_id, project_id: e.project_id, publish_date: e.start_date }} />} />
            {detail.posts.length ? (
              <div className="flex flex-col gap-1.5">
                {detail.posts.map((p) => (
                  <SocialPostRow key={p.id} post={p} />
                ))}
              </div>
            ) : (
              <EmptyState compact title="No posts planned" description="Templates can create announcement, reminder, day-of and recap posts with draft and approval deadlines." />
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="bg-card rounded-lg border p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{isMonday ? "Imported details (read-only)" : "Details"}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Dates</dt><dd>{e.start_date ? formatDateRange(e.start_date, e.end_date, today) : "—"}</dd>
              <dt className="text-muted-foreground">Time</dt><dd>{e.start_time ? formatTime(e.start_time) : "—"}</dd>
              <dt className="text-muted-foreground">Location</dt><dd>{e.location ?? "—"}</dd>
              <dt className="text-muted-foreground">Program</dt><dd>{e.program ?? "—"}</dd>
              <dt className="text-muted-foreground">Owner</dt><dd>{e.owner ?? "—"}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{e.status ?? "—"}</dd>
              <dt className="text-muted-foreground">Website</dt><dd className="truncate">{e.website_url ? <a href={e.website_url} className="text-primary hover:underline" target="_blank" rel="noreferrer noopener">{e.website_url}</a> : "—"}</dd>
              {isMonday ? (<><dt className="text-muted-foreground">Board group</dt><dd>{e.monday_group ?? "—"}</dd><dt className="text-muted-foreground">Last synced</dt><dd>{e.monday_synced_at ? formatTimestamp(e.monday_synced_at, timezone) : "—"}</dd></>) : null}
            </dl>
            {e.notes ? <p className="mt-2 whitespace-pre-wrap text-sm">{e.notes}</p> : null}
          </section>

          <section className="bg-card flex flex-col gap-3 rounded-lg border p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My local settings</h2>
            <Field label="Work area">
              <AreaSelect value={local.work_area_id} onChange={(v) => setLocal({ ...local, work_area_id: v })} />
            </Field>
            <Field label="Project">
              <ProjectSelect value={local.project_id} onChange={(v) => setLocal({ ...local, project_id: v })} />
            </Field>
            <Field label="My notes" hint="Never overwritten by sync.">
              <Textarea value={local.local_notes} onChange={(ev) => setLocal({ ...local, local_notes: ev.target.value })} rows={3} />
            </Field>
            {localDirty ? (
              <Button size="sm" disabled={pending} onClick={() => startTransition(async () => { const r = await updateEvent(e.id, { work_area_id: local.work_area_id, project_id: local.project_id, local_notes: local.local_notes || null }); if (!r.ok) toast.error(r.error); else { toast.success("Saved"); router.refresh(); } })}>
                {pending ? <Loader2 className="animate-spin" /> : <Check />} Save
              </Button>
            ) : null}
            {e.work_area ? <p className="text-muted-foreground inline-flex items-center gap-1 text-xs"><AreaDot color={e.work_area.color} /> {e.work_area.name}{e.project ? ` · ${e.project.name}` : ""}</p> : null}
          </section>

          <Separator />
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
            <NotesList parent={{ event_id: e.id }} notes={detail.notes} onChanged={() => router.refresh()} />
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h2>
            <AttachmentsList parent={{ event_id: e.id }} attachments={detail.attachments} onChanged={() => router.refresh()} />
          </section>
        </div>
      </div>

      {!isMonday ? <EventDialog open={editOpen} onOpenChange={setEditOpen} event={e} /> : null}
      <ApplyTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} event={e} templates={detail.templates} items={detail.templateItems} existing={{ tasks: detail.tasks, posts: detail.posts }} />
    </div>
  );
}
