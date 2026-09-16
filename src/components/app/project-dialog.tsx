"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createProject, updateProject } from "@/actions/projects";
import { PRIORITIES, PROJECT_STATUSES, type Link as LinkT, type Priority, type Project, type ProjectStatus } from "@/lib/types";
import { AreaSelect, DateInput, Field, LinksEditor } from "./form-fields";

type Form = {
  name: string;
  description: string;
  work_area_id: string | null;
  status: ProjectStatus;
  priority: Priority;
  target_date: string | null;
  next_action: string;
  links: LinkT[];
};

export function ProjectDialog({ open, onOpenChange, project, defaultAreaId }: { open: boolean; onOpenChange: (v: boolean) => void; project?: Project; defaultAreaId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>Name it, choose a work area, and note the very next action.</DialogDescription>
        </DialogHeader>
        <ProjectForm project={project} defaultAreaId={defaultAreaId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ project, defaultAreaId, onClose }: { project?: Project; defaultAreaId?: string | null; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(() => init(project, defaultAreaId));
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { ...form, description: form.description || null, next_action: form.next_action || null };
      const res = project ? await updateProject(project.id, payload) : await createProject(payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(project ? "Project saved" : "Project created");
      onClose();
      if (!project) router.push(`/projects/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Name" error={fieldErrors.name}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus placeholder="e.g. Website redesign" />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Work area">
              <AreaSelect value={form.work_area_id} onChange={(v) => set("work_area_id", v)} />
            </Field>
            <Field label="Status">
              <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
                {PROJECT_STATUSES.map((s) => (
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
            <Field label="Target deadline">
              <DateInput value={form.target_date} onChange={(v) => set("target_date", v)} />
            </Field>
          </div>
          <Field label="Next action" hint="The single next physical step.">
            <Input value={form.next_action} onChange={(e) => set("next_action", e.target.value)} placeholder="e.g. Send draft sitemap to Sam" />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </Field>
          <LinksEditor value={form.links} onChange={(v) => set("links", v)} />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {project ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
  );
}

function init(project?: Project, defaultAreaId?: string | null): Form {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    work_area_id: project?.work_area_id ?? defaultAreaId ?? null,
    status: project?.status ?? "active",
    priority: project?.priority ?? "normal",
    target_date: project?.target_date ?? null,
    next_action: project?.next_action ?? "",
    links: project?.links ?? [],
  };
}
