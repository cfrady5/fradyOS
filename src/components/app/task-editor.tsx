"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, RotateCcw, Star, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { completeTask, deleteTask, reopenTask, toggleFocus, updateTask } from "@/actions/tasks";
import type { TaskDetail } from "@/lib/data/tasks";
import { PRIORITIES, TASK_STATUSES, type Link as LinkT, type Priority, type RecurrenceRule, type TaskStatus } from "@/lib/types";
import { formatTimestamp, formatDate } from "@/lib/dates";
import { AreaSelect, DateInput, Field, LinksEditor, ProjectSelect, TimeInput } from "./form-fields";
import { RecurrenceEditor } from "./recurrence-editor";
import { AttachmentsList, NotesList, SubtasksList } from "./detail-parts";
import { useWorkspace } from "./workspace-provider";
import { PriorityBadge, TaskStatusBadge, DueBadge } from "./items";

type Form = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  work_area_id: string | null;
  project_id: string | null;
  planned_date: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: string;
  links: LinkT[];
  recurrence: RecurrenceRule | null;
  waiting_person: string;
  waiting_need: string;
  waiting_requested_date: string | null;
  waiting_expected_date: string | null;
  waiting_followup_date: string | null;
  waiting_notes: string;
};

export function TaskEditor({ detail, onChanged, onClose }: { detail: TaskDetail; onChanged: () => void; onClose: () => void }) {
  const { today, timezone } = useWorkspace();
  const t = detail.task;
  const [form, setForm] = React.useState<Form>({
    title: t.title,
    description: t.description ?? "",
    status: t.status,
    priority: t.priority,
    work_area_id: t.work_area_id,
    project_id: t.project_id,
    planned_date: t.planned_date,
    due_date: t.due_date,
    due_time: t.due_time,
    estimated_minutes: t.estimated_minutes?.toString() ?? "",
    links: t.links ?? [],
    recurrence: t.recurrence,
    waiting_person: t.waiting_person ?? "",
    waiting_need: t.waiting_need ?? "",
    waiting_requested_date: t.waiting_requested_date,
    waiting_expected_date: t.waiting_expected_date,
    waiting_followup_date: t.waiting_followup_date,
    waiting_notes: t.waiting_notes ?? "",
  });
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(Boolean(t.recurrence || t.estimated_minutes || (t.links ?? []).length));
  const [showHistory, setShowHistory] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }

  function save() {
    if (!form.title.trim()) return setError("Give the task a title");
    setError(null);
    startTransition(async () => {
      const res = await updateTask(t.id, {
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        work_area_id: form.work_area_id,
        project_id: form.project_id,
        planned_date: form.planned_date,
        due_date: form.due_date,
        due_time: form.due_time,
        estimated_minutes: form.estimated_minutes || null,
        links: form.links,
        recurrence: form.recurrence,
        waiting_person: form.waiting_person || null,
        waiting_need: form.waiting_need || null,
        waiting_requested_date: form.waiting_requested_date,
        waiting_expected_date: form.waiting_expected_date,
        waiting_followup_date: form.waiting_followup_date,
        waiting_notes: form.waiting_notes || null,
      });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      toast.success("Saved");
      onChanged();
    });
  }

  function complete() {
    startTransition(async () => {
      const res = await completeTask(t.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.nextId ? "Completed. Next occurrence created." : "Completed");
      onChanged();
    });
  }

  function reopen() {
    startTransition(async () => {
      const res = await reopenTask(t.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Reopened");
      onChanged();
    });
  }

  function remove() {
    if (!window.confirm("Delete this task? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteTask(t.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Task deleted");
      onClose();
    });
  }

  const isDone = t.status === "completed";
  const eventLinked = t.event;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <TaskStatusBadge status={t.status} />
        <PriorityBadge priority={t.priority} />
        {!isDone ? <DueBadge date={t.due_date} time={t.due_time} today={today} /> : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.focus_rank ? "Remove from top priorities" : "Add to top priorities"}
            title={t.focus_rank ? "Remove from top priorities" : "Add to top priorities"}
            disabled={isDone}
            onClick={() =>
              startTransition(async () => {
                const res = await toggleFocus(t.id);
                if (!res.ok) toast.error(res.error);
                else onChanged();
              })
            }
          >
            <Star className={t.focus_rank ? "fill-amber-400 text-amber-400" : ""} />
          </Button>
          {isDone ? (
            <Button variant="outline" size="sm" onClick={reopen} disabled={pending}>
              <RotateCcw /> Reopen
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={complete} disabled={pending}>
              <CheckCircle2 /> Complete
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="h-10 text-base font-medium" aria-label="Title" />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Status">
            <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Priority">
            <NativeSelect value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Work area">
            <AreaSelect value={form.work_area_id} onChange={(v) => set("work_area_id", v)} />
          </Field>
          <Field label="Project">
            <ProjectSelect value={form.project_id} onChange={(v) => set("project_id", v)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Deadline (due date)">
            <DateInput value={form.due_date} onChange={(v) => set("due_date", v)} />
          </Field>
          <Field label="Due time">
            <TimeInput value={form.due_time} onChange={(v) => set("due_time", v)} />
          </Field>
          <Field label="Planned work date" hint="Moving this never changes the deadline.">
            <DateInput value={form.planned_date} onChange={(v) => set("planned_date", v)} />
          </Field>
        </div>

        {t.template_item_id && t.anchor_date ? (
          <p className="text-muted-foreground text-xs">
            Created from an event template ({(t.offset_days ?? 0) >= 0 ? "+" : ""}{t.offset_days ?? 0} days from the event start).{" "}
            {t.date_overridden ? "Date manually overridden; it will not be moved automatically." : "If the event moves, a new date will be proposed."}
          </p>
        ) : null}
        {eventLinked ? (
          <p className="text-muted-foreground text-xs">
            Event:{" "}
            <Link href={`/events/${eventLinked.id}`} className="text-primary hover:underline">
              {eventLinked.name}
            </Link>
            {eventLinked.start_date ? ` · ${formatDate(eventLinked.start_date, "medium", today)}` : ""}
          </p>
        ) : null}

        {form.status === "waiting" ? (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 sm:grid-cols-2">
            <p className="text-xs font-semibold sm:col-span-2">Waiting on someone</p>
            <Field label="Person responsible">
              <Input value={form.waiting_person} onChange={(e) => set("waiting_person", e.target.value)} placeholder="Name" />
            </Field>
            <Field label="What I need from them">
              <Input value={form.waiting_need} onChange={(e) => set("waiting_need", e.target.value)} placeholder="Deliverable" />
            </Field>
            <Field label="Date requested">
              <DateInput value={form.waiting_requested_date} onChange={(v) => set("waiting_requested_date", v)} />
            </Field>
            <Field label="Their expected delivery date" hint="Their deadline, not yours.">
              <DateInput value={form.waiting_expected_date} onChange={(v) => set("waiting_expected_date", v)} />
            </Field>
            <Field label="My next follow-up date" hint="When you will check in.">
              <DateInput value={form.waiting_followup_date} onChange={(v) => set("waiting_followup_date", v)} />
            </Field>
            <Field label="Last follow-up">
              <Input value={t.waiting_last_followup_date ? formatDate(t.waiting_last_followup_date, "medium", today) : "Not yet"} readOnly className="bg-muted/50" />
            </Field>
            <Field label="Follow-up notes" className="sm:col-span-2">
              <Textarea value={form.waiting_notes} onChange={(e) => set("waiting_notes", e.target.value)} rows={3} />
            </Field>
          </div>
        ) : null}

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Details, context, definition of done…" />
        </Field>

        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs font-medium">
          {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {showAdvanced ? "Hide" : "Show"} effort, links and recurrence
        </button>
        {showAdvanced ? (
          <div className="flex flex-col gap-4">
            <Field label="Estimated effort (minutes)">
              <Input type="number" min={0} step={5} value={form.estimated_minutes} onChange={(e) => set("estimated_minutes", e.target.value)} className="w-40" />
            </Field>
            <LinksEditor value={form.links} onChange={(v) => set("links", v)} />
            <RecurrenceEditor value={form.recurrence} onChange={(v) => set("recurrence", v)} />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={remove} disabled={pending}>
            <Trash2 /> Delete
          </Button>
          <div className="flex items-center gap-2">
            {dirty ? <span className="text-muted-foreground text-xs">Unsaved changes</span> : null}
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          </div>
        </div>

        <Separator />

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtasks</h3>
          <SubtasksList taskId={t.id} subtasks={detail.subtasks} onChanged={onChanged} />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
          <NotesList parent={{ task_id: t.id }} notes={detail.notes} onChanged={onChanged} />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h3>
          <AttachmentsList parent={{ task_id: t.id }} attachments={detail.attachments} onChanged={onChanged} />
        </section>

        <Separator />
        <section className="text-muted-foreground text-xs">
          <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-3.5" /> History {showHistory ? "▾" : "▸"}
          </button>
          <p className="mt-1">
            Created {formatTimestamp(t.created_at, timezone, { withYear: true })}
            {t.completed_at ? ` · Completed ${formatTimestamp(t.completed_at, timezone, { withYear: true })}` : ""}
          </p>
          {showHistory ? (
            <ul className="mt-2 flex flex-col gap-1">
              {detail.activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="muted">{a.kind.replace(/_/g, " ")}</Badge>
                  {a.from_status || a.to_status ? (
                    <span>
                      {a.from_status ?? "—"} → {a.to_status ?? "—"}
                    </span>
                  ) : null}
                  {a.detail ? <span>{a.detail}</span> : null}
                  <span className="ml-auto tabular-nums">{formatTimestamp(a.created_at, timezone, { withYear: true })}</span>
                </li>
              ))}
              {detail.activity.length === 0 ? <li>No activity yet.</li> : null}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
