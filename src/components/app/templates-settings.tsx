"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Star, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/app/form-fields";
import { createTemplate, deleteTemplate, deleteTemplateItem, updateTemplate, upsertTemplateItem } from "@/actions/templates";
import { PLATFORMS, type EventTemplate, type EventTemplateItem } from "@/lib/types";

export function TemplatesSettings({ templates, items }: { templates: EventTemplate[]; items: EventTemplateItem[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Event templates</CardTitle>
            <CardDescription className="mt-1">Reusable preparation checklists and social milestones. Offsets are days relative to the event start (negative = before). Every item and offset is editable, and you preview dates before anything is created.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); startTransition(async () => { const r = await createTemplate({ name }); if (!r.ok) toast.error(r.error); else { setName(""); toast.success("Template created"); router.refresh(); } }); }}>
            <Field label="New template">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Webinar" className="w-64" />
            </Field>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus /> Add template
            </Button>
          </form>
        </CardContent>
      </Card>
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} items={items.filter((i) => i.template_id === t.id)} />
      ))}
    </div>
  );
}

function TemplateCard({ template, items }: { template: EventTemplate; items: EventTemplateItem[] }) {
  const router = useRouter();
  const [name, setName] = React.useState(template.name);
  const [adding, setAdding] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-64 font-medium" aria-label="Template name" />
          {name !== template.name ? (
            <Button size="sm" disabled={pending} onClick={() => startTransition(async () => { const r = await updateTemplate(template.id, { name }); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
              <Check /> Save
            </Button>
          ) : null}
          {template.is_default ? <Badge variant="secondary"><Star /> Default</Badge> : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const r = await updateTemplate(template.id, { is_default: true }); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
              Make default
            </Button>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete template" disabled={pending} onClick={() => { if (!window.confirm(`Delete template “${template.name}”? Items already created from it are kept.`)) return; startTransition(async () => { const r = await deleteTemplate(template.id); if (!r.ok) toast.error(r.error); else router.refresh(); }); }}>
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.length === 0 ? <p className="text-muted-foreground text-xs">No milestones yet.</p> : null}
        {items.map((it) => (
          <TemplateItemRow key={it.id} item={it} />
        ))}
        {adding ? (
          <TemplateItemRow templateId={template.id} onDone={() => setAdding(false)} />
        ) : (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
            <Plus /> Add milestone
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateItemRow({ item, templateId, onDone }: { item?: EventTemplateItem; templateId?: string; onDone?: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    kind: item?.kind ?? "social",
    title: item?.title ?? "",
    offset_days: String(item?.offset_days ?? -7),
    platform: item?.platform ?? "",
    brand: item?.brand ?? "",
    draft_lead_days: item?.draft_lead_days?.toString() ?? "3",
    approval_lead_days: item?.approval_lead_days?.toString() ?? "1",
  });
  const [pending, startTransition] = React.useTransition();
  const dirty = !item || form.title !== item.title || form.kind !== item.kind || form.offset_days !== String(item.offset_days) || (form.platform || null) !== item.platform || (form.brand || null) !== item.brand || form.draft_lead_days !== (item.draft_lead_days?.toString() ?? "") || form.approval_lead_days !== (item.approval_lead_days?.toString() ?? "");

  function save() {
    startTransition(async () => {
      const r = await upsertTemplateItem(item?.template_id ?? templateId!, item?.id ?? null, {
        ...form,
        platform: form.platform || null,
        draft_lead_days: form.kind === "social" ? form.draft_lead_days : null,
        approval_lead_days: form.kind === "social" ? form.approval_lead_days : null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(item ? "Milestone saved" : "Milestone added");
      onDone?.();
      router.refresh();
    });
  }

  const off = parseInt(form.offset_days, 10);
  const offsetLabel = Number.isNaN(off) ? "" : off === 0 ? "day of" : off < 0 ? `${-off}d before` : `${off}d after`;

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-12">
      <Field label="Type" className="sm:col-span-2">
        <NativeSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "task" | "social" })}>
          <option value="social">Social post</option>
          <option value="task">Prep task</option>
        </NativeSelect>
      </Field>
      <Field label="Title" className="col-span-2 sm:col-span-4">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. One-week-out reminder" />
      </Field>
      <Field label="Offset (days)" hint={offsetLabel} className="sm:col-span-2">
        <Input type="number" value={form.offset_days} onChange={(e) => setForm({ ...form, offset_days: e.target.value })} />
      </Field>
      {form.kind === "social" ? (
        <>
          <Field label="Platform" className="sm:col-span-2">
            <NativeSelect value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              <option value="">Any</option>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Draft lead" hint="days before publish" className="sm:col-span-1">
            <Input type="number" min={0} value={form.draft_lead_days} onChange={(e) => setForm({ ...form, draft_lead_days: e.target.value })} />
          </Field>
          <Field label="Approval lead" hint="days before" className="sm:col-span-1">
            <Input type="number" min={0} value={form.approval_lead_days} onChange={(e) => setForm({ ...form, approval_lead_days: e.target.value })} />
          </Field>
        </>
      ) : (
        <div className="hidden sm:col-span-4 sm:block" />
      )}
      <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-12">
        {onDone ? <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button> : null}
        {dirty ? (
          <Button size="sm" disabled={pending || !form.title.trim()} onClick={save}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {item ? "Save" : "Add"}
          </Button>
        ) : null}
        {item ? (
          <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete milestone" disabled={pending} onClick={() => startTransition(async () => { const r = await deleteTemplateItem(item.id); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
