"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { applyTemplateToEvent } from "@/actions/templates";
import { previewTemplate, type TemplatePreviewItem } from "@/lib/templates";
import { PLATFORMS, type Event, type EventTemplate, type EventTemplateItem, type SocialPost, type Task } from "@/lib/types";
import { formatDate, diffDays } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";

type Existing = { tasks: Pick<Task, "template_item_id">[]; posts: Pick<SocialPost, "template_item_id">[] };
type Edit = Partial<Pick<TemplatePreviewItem, "title" | "date" | "draft_due_date" | "approval_due_date" | "platform">> & { selected?: boolean };

export function ApplyTemplateDialog({ open, onOpenChange, event, templates, items, existing }: { open: boolean; onOpenChange: (v: boolean) => void; event: Event; templates: EventTemplate[]; items: EventTemplateItem[]; existing: Existing }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Apply an event template</DialogTitle>
          <DialogDescription>Preview and adjust every date before anything is created. Items already created from this template are skipped, so re-applying never duplicates.</DialogDescription>
        </DialogHeader>
        {templates.length === 0 ? (
          <Alert>
            <AlertDescription>
              No templates yet. <Link href="/settings?tab=templates" className="text-primary hover:underline">Create one in Settings</Link>.
            </AlertDescription>
          </Alert>
        ) : (
          <ApplyTemplateBody event={event} templates={templates} items={items} existing={existing} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApplyTemplateBody({ event, templates, items, existing, onClose }: { event: Event; templates: EventTemplate[]; items: EventTemplateItem[]; existing: Existing; onClose: () => void }) {
  const router = useRouter();
  const { today } = useWorkspace();
  const [templateId, setTemplateId] = React.useState(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const [includePast, setIncludePast] = React.useState(false);
  // Per-template edits keyed by template item id; switching templates starts from a clean preview.
  const [edits, setEdits] = React.useState<Record<string, Record<string, Edit>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const preview = React.useMemo(() => (event.start_date ? previewTemplate(items.filter((i) => i.template_id === templateId), event.start_date, today, existing) : []), [items, templateId, event.start_date, today, existing]);
  const rows = preview.map((p) => {
    const e = edits[templateId]?.[p.template_item_id] ?? {};
    const date = e.date ?? p.date;
    const inPast = date < today;
    return { ...p, ...e, date, in_past: inPast, selected: p.already_applied ? false : (e.selected ?? (!inPast || includePast)) };
  });

  function update(id: string, patch: Edit) {
    setEdits((all) => ({ ...all, [templateId]: { ...(all[templateId] ?? {}), [id]: { ...(all[templateId]?.[id] ?? {}), ...patch } } }));
  }

  function apply() {
    const chosen = rows.filter((r) => r.selected && !r.already_applied);
    if (!chosen.length) return setError("Select at least one item to create.");
    startTransition(async () => {
      const res = await applyTemplateToEvent({
        event_id: event.id,
        items: chosen.map((r) => ({
          template_item_id: r.template_item_id,
          kind: r.kind,
          title: r.title,
          description: r.description,
          offset_days: event.start_date ? diffDays(event.start_date, r.date) : r.offset_days,
          date: r.date,
          draft_due_date: r.draft_due_date,
          approval_due_date: r.approval_due_date,
          platform: r.platform,
          brand: r.brand,
        })),
      });
      if (!res.ok) return setError(res.error);
      toast.success(`Created ${res.data.tasks} task${res.data.tasks === 1 ? "" : "s"} and ${res.data.posts} post${res.data.posts === 1 ? "" : "s"}${res.data.skipped ? ` (${res.data.skipped} already existed)` : ""}`);
      onClose();
      router.refresh();
    });
  }

  const pastCount = rows.filter((r) => r.in_past && !r.already_applied).length;
  const chosenCount = rows.filter((r) => r.selected && !r.already_applied).length;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label>Template</Label>
          <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>
            ))}
          </NativeSelect>
        </div>
        <p className="text-muted-foreground text-xs">Event start: <span className="text-foreground font-medium">{event.start_date ? formatDate(event.start_date, "weekday", today) : "—"}</span></p>
        {pastCount ? (
          <label className="ml-auto flex items-center gap-2 text-xs">
            <Checkbox checked={includePast} onCheckedChange={(v) => setIncludePast(v === true)} />
            Include {pastCount} item{pastCount === 1 ? "" : "s"} dated in the past
          </label>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">This template has no milestones. <Link href="/settings?tab=templates" className="text-primary hover:underline">Add some</Link>.</p>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2 text-left">Item</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Draft / approval</th>
                <th className="p-2 text-left">Platform</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.template_item_id} className={r.already_applied ? "opacity-50" : r.in_past && !r.selected ? "opacity-60" : ""}>
                  <td className="p-2 align-top"><Checkbox checked={r.selected} disabled={r.already_applied} onCheckedChange={(v) => update(r.template_item_id, { selected: v === true })} aria-label={`Include ${r.title}`} /></td>
                  <td className="p-2 align-top">
                    <Input value={r.title} onChange={(e) => update(r.template_item_id, { title: e.target.value })} className="h-8" disabled={r.already_applied} />
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="muted">{r.kind === "task" ? "task" : "post"}</Badge>
                      {r.already_applied ? <Badge variant="secondary">already created</Badge> : null}
                      {r.in_past ? <Badge variant="warning">in the past</Badge> : null}
                    </div>
                  </td>
                  <td className="p-2 align-top">
                    <Input type="date" value={r.date} onChange={(e) => e.target.value && update(r.template_item_id, { date: e.target.value })} className="h-8 w-36 tabular-nums" disabled={r.already_applied} />
                  </td>
                  <td className="p-2 align-top">
                    {r.kind === "social" ? (
                      <div className="flex flex-col gap-1">
                        <Input type="date" value={r.draft_due_date ?? ""} onChange={(e) => update(r.template_item_id, { draft_due_date: e.target.value || null })} className="h-8 w-36 tabular-nums" disabled={r.already_applied} aria-label="Draft deadline" />
                        <Input type="date" value={r.approval_due_date ?? ""} onChange={(e) => update(r.template_item_id, { approval_due_date: e.target.value || null })} className="h-8 w-36 tabular-nums" disabled={r.already_applied} aria-label="Approval deadline" />
                      </div>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="p-2 align-top">
                    {r.kind === "social" ? (
                      <NativeSelect value={r.platform ?? ""} onChange={(e) => update(r.template_item_id, { platform: e.target.value || null })} className="h-8 w-32" disabled={r.already_applied}>
                        <option value="">Any</option>
                        {PLATFORMS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </NativeSelect>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={apply} disabled={pending || chosenCount === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Wand2 />} Create {chosenCount} item{chosenCount === 1 ? "" : "s"}
        </Button>
      </DialogFooter>
    </>
  );
}
