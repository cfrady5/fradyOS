"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createEvent, updateEvent } from "@/actions/events";
import type { Event } from "@/lib/types";
import { AreaSelect, DateInput, Field, ProjectSelect, TimeInput } from "./form-fields";

type Form = {
  name: string;
  work_area_id: string | null;
  project_id: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  location: string;
  program: string;
  owner: string;
  status: string;
  website_url: string;
  notes: string;
};

export function EventDialog({ open, onOpenChange, event, defaultAreaId }: { open: boolean; onOpenChange: (v: boolean) => void; event?: Event; defaultAreaId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>Manually managed event. Imported Monday.com events are edited in Monday.com.</DialogDescription>
        </DialogHeader>
        <EventForm event={event} defaultAreaId={defaultAreaId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EventForm({ event, defaultAreaId, onClose }: { event?: Event; defaultAreaId?: string | null; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(() => init(event, defaultAreaId));
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { ...form, location: form.location || null, program: form.program || null, owner: form.owner || null, status: form.status || null, website_url: form.website_url || null, notes: form.notes || null };
      const res = event ? await updateEvent(event.id, payload) : await createEvent(payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(event ? "Event saved" : "Event created");
      onClose();
      if (!event) router.push(`/events/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Event name" error={fieldErrors.name}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Start date" error={fieldErrors.start_date}>
              <DateInput value={form.start_date} onChange={(v) => set("start_date", v)} />
            </Field>
            <Field label="End date" error={fieldErrors.end_date}>
              <DateInput value={form.end_date} onChange={(v) => set("end_date", v)} />
            </Field>
            <Field label="Start time">
              <TimeInput value={form.start_time} onChange={(v) => set("start_time", v)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Work area">
              <AreaSelect value={form.work_area_id} onChange={(v) => set("work_area_id", v)} />
            </Field>
            <Field label="Project">
              <ProjectSelect value={form.project_id} onChange={(v) => set("project_id", v)} />
            </Field>
            <Field label="Location">
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field label="Program">
              <Input value={form.program} onChange={(e) => set("program", e.target.value)} />
            </Field>
            <Field label="Event owner">
              <Input value={form.owner} onChange={(e) => set("owner", e.target.value)} />
            </Field>
            <Field label="Status">
              <Input value={form.status} onChange={(e) => set("status", e.target.value)} placeholder="Confirmed, Tentative…" />
            </Field>
          </div>
          <Field label="Registration / event website" error={fieldErrors.website_url}>
            <Input value={form.website_url} onChange={(e) => set("website_url", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {event ? "Save" : "Create event"}
            </Button>
          </DialogFooter>
        </form>
  );
}

function init(event?: Event, defaultAreaId?: string | null): Form {
  return {
    name: event?.name ?? "",
    work_area_id: event?.work_area_id ?? defaultAreaId ?? null,
    project_id: event?.project_id ?? null,
    start_date: event?.start_date ?? null,
    end_date: event?.end_date ?? null,
    start_time: event?.start_time ?? null,
    location: event?.location ?? "",
    program: event?.program ?? "",
    owner: event?.owner ?? "",
    status: event?.status ?? "",
    website_url: event?.website_url ?? "",
    notes: event?.notes ?? "",
  };
}
