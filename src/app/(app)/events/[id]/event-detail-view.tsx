"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Lock, Pencil, Plus, Trash2, Archive, AlertTriangle, CalendarClock, Check, Wand2, MapPin, User, Globe, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaTag, DateBlock, MetaRow, PageHeader, RowList, SectionHeader, SocialPostRow, TaskRow } from "@/components/app/items";
import { navCrumb } from "@/components/app/nav";
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
import { sendEventPostsToMonday } from "@/actions/monday";
import type { EventDetail } from "@/lib/data/events";
import type { TaskWithRefs } from "@/lib/types";
import { formatDate, formatDateRange, formatTime, formatTimestamp } from "@/lib/dates";
import { proposeDateChanges } from "@/lib/templates";
import { cn } from "@/lib/utils";

export function EventDetailView({ detail }: { detail: EventDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const { today, timezone } = useWorkspace();
  const { openQuickAdd } = useShell();
  const [editOpen, setEditOpen] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const e = detail.event;
  const isMonday = e.source === "monday";
  const crumb = navCrumb(pathname);

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
  const pendingPosts = detail.posts.filter((p) => p.status !== "published").length;
  const unsentPosts = detail.posts.filter((p) => !p.monday_item_id).length;

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
      <PageHeader
        eyebrow={
          <>
            {crumb?.group.index ? <span className="index">{crumb.group.index}</span> : null}
            {crumb?.group.label ? <span>{crumb.group.label}</span> : null}
            <span className="text-line-3" aria-hidden>
              /
            </span>
            <Link href="/events" className="hover:text-text-1 focus-visible:ring-brand/40 inline-flex items-center gap-1 rounded-sm transition-colors outline-none focus-visible:ring-2">
              <ArrowLeft className="size-3" aria-hidden /> Events
            </Link>
          </>
        }
        title={
          <span className="flex items-center gap-3">
            <DateBlock date={e.start_date} />
            <span className="min-w-0">{e.name}</span>
          </span>
        }
        actions={
          <>
            {!isMonday ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)} disabled={!e.start_date} title={!e.start_date ? "Add a start date first" : undefined}><Wand2 /> Apply template</Button>
            <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const r = await archiveEvent(e.id, !e.is_archived); if (!r.ok) toast.error(r.error); else { toast.success(e.is_archived ? "Restored" : "Archived"); router.refresh(); } })}>
              <Archive /> {e.is_archived ? "Restore" : "Archive"}
            </Button>
            {!isMonday || e.sync_flag === "removed" ? (
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => { if (!window.confirm("Delete this event? Linked tasks and posts are kept.")) return; startTransition(async () => { const r = await deleteEvent(e.id); if (!r.ok) toast.error(r.error); else { toast.success("Event deleted"); router.push("/events"); } }); }}>
                <Trash2 /> Delete
              </Button>
            ) : null}
          </>
        }
      >
        <MetaRow className="-mt-1">
          {isMonday ? (
            <Badge variant="muted"><Lock /> Synced from Monday.com</Badge>
          ) : (
            <Badge variant="secondary">Manual</Badge>
          )}
          {e.status ? <Badge variant="outline">{e.status}</Badge> : null}
          <span className="nums inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {e.start_date ? formatDateRange(e.start_date, e.end_date, today) : "No date"}{e.start_time ? ` · ${formatTime(e.start_time)}` : ""}</span>
          {e.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden /> {e.location}</span> : null}
          {e.owner ? <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden /> {e.owner}</span> : null}
          {e.program ? <span>{e.program}</span> : null}
          {e.website_url ? (
            <a href={e.website_url} target="_blank" rel="noreferrer noopener" className="text-brand-soft inline-flex items-center gap-1 hover:underline"><Globe className="size-3" aria-hidden /> Event website</a>
          ) : null}
          {e.monday_item_url ? (
            <a href={e.monday_item_url} target="_blank" rel="noreferrer noopener" className="text-brand-soft inline-flex items-center gap-1 hover:underline"><ExternalLink className="size-3" aria-hidden /> Open in Monday.com</a>
          ) : null}
        </MetaRow>
      </PageHeader>

      {flagged ? (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>{e.sync_flag === "removed" ? "This item was removed from the Monday.com board" : "This event looks canceled in Monday.com"}</AlertTitle>
          <AlertDescription>
            <p>{e.sync_flag_reason}{e.sync_flag_at ? ` · noticed ${formatTimestamp(e.sync_flag_at, timezone)}` : ""}. Your {openTasks.length} open prep task{openTasks.length === 1 ? "" : "s"} and {pendingPosts} pending post{pendingPosts === 1 ? "" : "s"} were left untouched.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => { const r = await dismissEventFlag(e.id); if (!r.ok) toast.error(r.error); else router.refresh(); })}><Check /> Keep and dismiss</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => { const r = await archiveEvent(e.id); if (!r.ok) toast.error(r.error); else { toast.success("Archived"); router.refresh(); } })}><Archive /> Archive event</Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {e.dates_changed_at && e.previous_start_date !== undefined && (e.previous_start_date !== e.start_date || e.previous_end_date !== e.end_date) ? (
        <Alert variant="info" className="mb-4">
          <CalendarClock />
          <AlertTitle>Event dates changed</AlertTitle>
          <AlertDescription>
            <p className="nums">
              {formatDateRange(e.previous_start_date, e.previous_end_date, today) || "No date"} → {formatDateRange(e.start_date, e.end_date, today) || "No date"} ({formatTimestamp(e.dates_changed_at, timezone)}).
              {proposals.length === 0 ? " No unfinished template-based items need moving." : ""}
            </p>
            <Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => startTransition(async () => { const r = await acknowledgeEventDateChange(e.id); if (!r.ok) toast.error(r.error); else router.refresh(); })}><Check /> Acknowledge</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {proposals.length ? (
        <section className="border-line-1 bg-surface-1 mb-6 rounded-lg border px-4 py-3" aria-labelledby="event-proposals">
          <p id="event-proposals" className="text-heading text-text-1 flex items-center gap-2">
            Proposed date changes <span className="index">{proposals.length}</span>
          </p>
          <p className="text-text-2 text-meta mt-1">The event moved. These unfinished items were created from a template and have not been manually overridden. Completed work and manual dates are never changed.</p>
          <ul className="hairline-rows mt-2">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2 text-sm">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => setDeselected((s) => { const n = new Set(s); if (v) n.delete(p.id); else n.add(p.id); return n; })} aria-label={`Select ${p.title}`} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-text-1 font-medium">{p.title}</span> <span className="text-text-3 text-meta">({p.kind === "task" ? "task" : "post"})</span>
                  <div className="text-text-3 text-meta nums">
                    {p.kind === "task" ? "Due" : "Publish"} {p.current.date ? formatDate(p.current.date, "medium", today) : "none"} → <span className="text-text-1 font-medium">{formatDate(p.proposed.date, "medium", today)}</span>
                    {p.kind === "social" && (p.proposed.draft || p.proposed.approval) ? (
                      <span> · draft {p.proposed.draft ? formatDate(p.proposed.draft, "short", today) : "—"} · approval {p.proposed.approval ? formatDate(p.proposed.approval, "short", today) : "—"}</span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" loading={pending} disabled={pending || selected.size === 0} onClick={() => applyProposals("accept")}>{pending ? null : <Check />} Apply selected</Button>
            <Button size="sm" variant="outline" disabled={pending || selected.size === 0} onClick={() => applyProposals("keep")}>Keep current dates for selected</Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="event-prep">
            <SectionHeader
              title={<span id="event-prep">Preparation checklist</span>}
              count={openTasks.length}
              hint={detail.tasks.length ? `${doneTasks.length}/${detail.tasks.length} done` : undefined}
              action={
                <Button size="sm" variant="ghost" onClick={() => openQuickAdd({ event_id: e.id, work_area_id: e.work_area_id, project_id: e.project_id, due_date: e.start_date })}>
                  <Plus /> Add prep task
                </Button>
              }
            />
            {detail.tasks.length ? <Progress value={pct} className="mt-3 mb-1" aria-label={`${pct}% of preparation tasks done`} /> : null}
            {openTasks.length ? (
              <RowList className="mt-1">
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={toggle} />
                ))}
              </RowList>
            ) : (
              <EmptyState className="mt-3" title="No open preparation tasks" description={e.start_date ? "Apply a template to generate milestones, or add tasks one by one." : "Add a start date to use templates."} action={e.start_date ? <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)}><Wand2 /> Apply template</Button> : undefined} />
            )}
            {doneTasks.length ? (
              <details className="mt-3">
                <summary className="text-text-3 text-meta cursor-pointer">{doneTasks.length} completed</summary>
                <RowList className="mt-1">
                  {doneTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleComplete={toggle} dense />
                  ))}
                </RowList>
              </details>
            ) : null}
          </section>

          <section aria-labelledby="event-social">
            <SectionHeader
              title={<span id="event-social">Social media plan</span>}
              count={detail.posts.length}
              action={
                <>
                  {detail.socialBoard && unsentPosts ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const r = await sendEventPostsToMonday(e.id); if (!r.ok) return void toast.error(r.error, { duration: 8000 }); toast.success(`Sent ${r.data.pushed} post${r.data.pushed === 1 ? "" : "s"} to Monday.com`); if (r.data.errors.length) toast.warning(r.data.errors[0], { duration: 10000 }); router.refresh(); })}>
                      <UploadCloud /> Send {unsentPosts} to Monday
                    </Button>
                  ) : null}
                  <NewSocialPostButton variant="ghost" preset={{ event_id: e.id, work_area_id: e.work_area_id, project_id: e.project_id, publish_date: e.start_date }} />
                </>
              }
            />
            {detail.posts.length ? (
              <RowList className="mt-1">
                {detail.posts.map((p) => (
                  <SocialPostRow key={p.id} post={p} />
                ))}
              </RowList>
            ) : (
              <EmptyState className="mt-3" title="No posts planned" description="Templates can create announcement, reminder, day-of and recap posts with draft and approval deadlines." />
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="event-details">
            <SectionHeader as="h3" title={<span id="event-details">{isMonday ? "Imported details (read-only)" : "Details"}</span>} />
            <dl className="hairline-rows text-sm">
              <DetailRow label="Dates" nums>{e.start_date ? formatDateRange(e.start_date, e.end_date, today) : "—"}</DetailRow>
              <DetailRow label="Time" nums>{e.start_time ? formatTime(e.start_time) : "—"}</DetailRow>
              <DetailRow label="Location">{e.location ?? "—"}</DetailRow>
              <DetailRow label="Program">{e.program ?? "—"}</DetailRow>
              <DetailRow label="Owner">{e.owner ?? "—"}</DetailRow>
              <DetailRow label="Status">{e.status ?? "—"}</DetailRow>
              <DetailRow label="Website">{e.website_url ? <a href={e.website_url} className="text-brand-soft hover:underline" target="_blank" rel="noreferrer noopener">{e.website_url}</a> : "—"}</DetailRow>
              {isMonday ? (
                <>
                  <DetailRow label="Board group">{e.monday_group ?? "—"}</DetailRow>
                  <DetailRow label="Last synced" nums>{e.monday_synced_at ? formatTimestamp(e.monday_synced_at, timezone) : "—"}</DetailRow>
                </>
              ) : null}
            </dl>
            {e.notes ? <p className="text-text-2 mt-3 text-sm whitespace-pre-wrap">{e.notes}</p> : null}
          </section>

          <section className="border-line-1 bg-surface-1 flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="event-local">
            <h3 id="event-local" className="text-heading text-text-1">My local settings</h3>
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
              <Button size="sm" className="w-fit" loading={pending} disabled={pending} onClick={() => startTransition(async () => { const r = await updateEvent(e.id, { work_area_id: local.work_area_id, project_id: local.project_id, local_notes: local.local_notes || null }); if (!r.ok) toast.error(r.error); else { toast.success("Saved"); router.refresh(); } })}>
                {pending ? null : <Check />} Save
              </Button>
            ) : null}
            {e.work_area ? (
              <p className="text-text-3 text-meta flex flex-wrap items-center gap-2">
                <AreaTag name={e.work_area.name} color={e.work_area.color} />
                {e.project ? <span>· {e.project.name}</span> : null}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="event-notes">
            <SectionHeader as="h3" title={<span id="event-notes">Notes</span>} count={detail.notes.length} />
            <div className="mt-3">
              <NotesList parent={{ event_id: e.id }} notes={detail.notes} onChanged={() => router.refresh()} />
            </div>
          </section>
          <section aria-labelledby="event-attachments">
            <SectionHeader as="h3" title={<span id="event-attachments">Attachments</span>} count={detail.attachments.length} />
            <div className="mt-3">
              <AttachmentsList parent={{ event_id: e.id }} attachments={detail.attachments} onChanged={() => router.refresh()} />
            </div>
          </section>
        </aside>
      </div>

      {!isMonday ? <EventDialog open={editOpen} onOpenChange={setEditOpen} event={e} /> : null}
      <ApplyTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} event={e} templates={detail.templates} items={detail.templateItems} existing={{ tasks: detail.tasks, posts: detail.posts }} socialBoardName={detail.socialBoard?.board_name ?? (detail.socialBoard ? `board #${detail.socialBoard.board_id}` : null)} />
    </div>
  );
}

/** One label/value line in the details list. */
function DetailRow({ label, children, nums = false }: { label: string; children: React.ReactNode; nums?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="text-text-3 text-meta w-20 shrink-0">{label}</dt>
      <dd className={cn("text-text-1 min-w-0 flex-1 truncate", nums && "nums")}>{children}</dd>
    </div>
  );
}
