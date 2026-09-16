"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createTask } from "@/actions/tasks";
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from "@/lib/types";
import { addDays } from "@/lib/dates";
import { AreaSelect, DateInput, Field, ProjectSelect, TimeInput } from "./form-fields";
import { useWorkspace } from "./workspace-provider";
import { useOpenItem } from "@/hooks/use-open-item";
import type { QuickAddPreset } from "./app-shell";

type Draft = {
  title: string;
  due_date: string | null;
  due_time: string | null;
  planned_date: string | null;
  work_area_id: string | null;
  project_id: string | null;
  event_id: string | null;
  priority: Priority;
  status: TaskStatus;
  description: string;
  estimated_minutes: string;
  waiting_person: string;
  waiting_need: string;
  waiting_expected_date: string | null;
  waiting_followup_date: string | null;
};

function emptyDraft(preset?: QuickAddPreset): Draft {
  return {
    title: preset?.title ?? "",
    due_date: preset?.due_date ?? null,
    due_time: null,
    planned_date: preset?.planned_date ?? null,
    work_area_id: preset?.work_area_id ?? null,
    project_id: preset?.project_id ?? null,
    event_id: preset?.event_id ?? null,
    priority: "normal",
    status: preset?.status ?? "todo",
    description: "",
    estimated_minutes: "",
    waiting_person: "",
    waiting_need: "",
    waiting_expected_date: null,
    waiting_followup_date: null,
  };
}

export function QuickAddDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (v: boolean) => void; preset?: QuickAddPreset }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Quick add task</DialogTitle>
          <DialogDescription>Capture it now; refine later. Press Enter to save.</DialogDescription>
        </DialogHeader>
        {/* The form mounts fresh each time the dialog opens, so state resets without effects. */}
        <QuickAddForm preset={preset} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function QuickAddForm({ preset, onClose }: { preset?: QuickAddPreset; onClose: () => void }) {
  const router = useRouter();
  const { today, projects } = useWorkspace();
  const { openTask } = useOpenItem();
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft(preset));
  const [more, setMore] = React.useState(Boolean(preset?.status === "waiting"));
  const [addAnother, setAddAnother] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const titleRef = React.useRef<HTMLInputElement>(null);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function chooseProject(id: string | null) {
    const p = id ? projects.find((x) => x.id === id) : null;
    setDraft((d) => ({ ...d, project_id: id, work_area_id: d.work_area_id ?? p?.work_area_id ?? null }));
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.title.trim()) {
      setError("Give the task a title");
      titleRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTask({
        title: draft.title,
        description: draft.description || null,
        due_date: draft.due_date,
        due_time: draft.due_time,
        planned_date: draft.planned_date,
        work_area_id: draft.work_area_id,
        project_id: draft.project_id,
        event_id: draft.event_id,
        priority: draft.priority,
        status: draft.status,
        estimated_minutes: draft.estimated_minutes || null,
        waiting_person: draft.status === "waiting" ? draft.waiting_person || null : null,
        waiting_need: draft.status === "waiting" ? draft.waiting_need || null : null,
        waiting_expected_date: draft.status === "waiting" ? draft.waiting_expected_date : null,
        waiting_followup_date: draft.status === "waiting" ? draft.waiting_followup_date : null,
        waiting_requested_date: draft.status === "waiting" ? today : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const id = res.data.id;
      toast.success("Task added", { action: { label: "Open", onClick: () => openTask(id) } });
      router.refresh();
      if (addAnother) {
        setDraft((d) => ({ ...emptyDraft(preset), work_area_id: d.work_area_id, project_id: d.project_id, event_id: d.event_id, status: d.status }));
        titleRef.current?.focus();
      } else {
        onClose();
      }
    });
  }

  const quickDates: { label: string; value: string | null }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next week", value: addDays(today, 7) },
    { label: "None", value: null },
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        ref={titleRef}
        autoFocus
        placeholder="What needs to happen?"
        value={draft.title}
        onChange={(e) => set("title", e.target.value)}
        aria-label="Task title"
        className="h-10 text-base"
        autoComplete="off"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs">Due:</span>
        {quickDates.map((q) => (
          <Button key={q.label} type="button" size="sm" variant={draft.due_date === q.value ? "default" : "outline"} onClick={() => set("due_date", q.value)}>
            {q.label}
          </Button>
        ))}
        <DateInput value={draft.due_date} onChange={(v) => set("due_date", v)} className="h-8 w-36 text-xs" aria-label="Due date" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Work area">
          <AreaSelect value={draft.work_area_id} onChange={(v) => set("work_area_id", v)} />
        </Field>
        <Field label="Project">
          <ProjectSelect value={draft.project_id} onChange={chooseProject} />
        </Field>
        <Field label="Priority">
          <NativeSelect value={draft.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <button type="button" onClick={() => setMore((m) => !m)} className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs font-medium">
        {more ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {more ? "Fewer options" : "More options"}
      </button>

      {more ? (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Status">
              <NativeSelect value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                {TASK_STATUSES.filter((s) => s.value !== "completed").map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Planned work date" hint="When you'll do it; separate from the deadline.">
              <DateInput value={draft.planned_date} onChange={(v) => set("planned_date", v)} />
            </Field>
            <Field label="Due time">
              <TimeInput value={draft.due_time} onChange={(v) => set("due_time", v)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Estimated effort (minutes)">
              <Input type="number" min={0} step={5} value={draft.estimated_minutes} onChange={(e) => set("estimated_minutes", e.target.value)} placeholder="e.g. 30" />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Context, links, acceptance criteria…" />
            </Field>
          </div>
          {draft.status === "waiting" ? (
            <div className="grid grid-cols-1 gap-2 rounded-md bg-warning/10 p-2 sm:grid-cols-2">
              <Field label="Waiting on (person)">
                <Input value={draft.waiting_person} onChange={(e) => set("waiting_person", e.target.value)} placeholder="Name" />
              </Field>
              <Field label="What you need from them">
                <Input value={draft.waiting_need} onChange={(e) => set("waiting_need", e.target.value)} placeholder="Approved copy, final logo…" />
              </Field>
              <Field label="Their expected delivery date">
                <DateInput value={draft.waiting_expected_date} onChange={(v) => set("waiting_expected_date", v)} />
              </Field>
              <Field label="My next follow-up date">
                <DateInput value={draft.waiting_followup_date} onChange={(v) => set("waiting_followup_date", v)} />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter className="items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={addAnother} onCheckedChange={(v) => setAddAnother(v === true)} />
          <Label className="text-foreground text-sm">Add another</Label>
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} Add task
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
