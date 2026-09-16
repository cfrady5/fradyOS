import { addDays, type DateOnly } from "@/lib/dates";
import type { EventTemplateItem, SocialPost, Task } from "@/lib/types";

export type TemplatePreviewItem = {
  template_item_id: string;
  kind: "task" | "social";
  title: string;
  description: string | null;
  offset_days: number;
  date: DateOnly; // task due date or social publish date
  draft_due_date: DateOnly | null;
  approval_due_date: DateOnly | null;
  platform: string | null;
  brand: string | null;
  in_past: boolean;
  already_applied: boolean;
};

/** Computes what applying a template to an event would create, relative to the event start date. */
export function previewTemplate(items: EventTemplateItem[], eventStart: DateOnly, today: DateOnly, existing: { tasks: Pick<Task, "template_item_id">[]; posts: Pick<SocialPost, "template_item_id">[] }): TemplatePreviewItem[] {
  const applied = new Set([...existing.tasks.map((t) => t.template_item_id), ...existing.posts.map((p) => p.template_item_id)].filter(Boolean));
  return items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.offset_days - b.offset_days)
    .map((it) => {
      const date = addDays(eventStart, it.offset_days);
      const draft = it.kind === "social" && it.draft_lead_days !== null ? addDays(date, -Math.max(0, it.draft_lead_days)) : null;
      const approval = it.kind === "social" && it.approval_lead_days !== null ? addDays(date, -Math.max(0, it.approval_lead_days)) : null;
      return {
        template_item_id: it.id,
        kind: it.kind,
        title: it.title,
        description: it.description,
        offset_days: it.offset_days,
        date,
        draft_due_date: draft,
        approval_due_date: approval,
        platform: it.platform,
        brand: it.brand,
        in_past: date < today,
        already_applied: applied.has(it.id),
      };
    });
}

export type DateProposal = {
  kind: "task" | "social";
  id: string;
  title: string;
  current: { date: DateOnly | null; draft: DateOnly | null; approval: DateOnly | null };
  proposed: { date: DateOnly; draft: DateOnly | null; approval: DateOnly | null };
};

/**
 * When an event's start date differs from the anchor date its template-derived items were built from,
 * propose new dates for unfinished, non-overridden items. Completed work and manual overrides are left alone.
 */
export function proposeDateChanges(eventStart: DateOnly | null, tasks: Task[], posts: SocialPost[]): DateProposal[] {
  if (!eventStart) return [];
  const out: DateProposal[] = [];
  for (const t of tasks) {
    if (t.status === "completed" || t.date_overridden || !t.template_item_id || t.offset_days === null || !t.anchor_date) continue;
    if (t.anchor_date === eventStart) continue;
    const proposed = addDays(eventStart, t.offset_days);
    if (proposed === t.due_date) continue;
    out.push({ kind: "task", id: t.id, title: t.title, current: { date: t.due_date, draft: null, approval: null }, proposed: { date: proposed, draft: null, approval: null } });
  }
  for (const p of posts) {
    if (p.status === "published" || p.date_overridden || !p.template_item_id || p.offset_days === null || !p.anchor_date) continue;
    if (p.anchor_date === eventStart) continue;
    const proposed = addDays(eventStart, p.offset_days);
    const delta = p.publish_date ? daysBetween(p.publish_date, proposed) : 0;
    const draft = p.draft_due_date ? addDays(p.draft_due_date, delta) : null;
    const approval = p.approval_due_date ? addDays(p.approval_due_date, delta) : null;
    if (proposed === p.publish_date && draft === p.draft_due_date && approval === p.approval_due_date) continue;
    out.push({ kind: "social", id: p.id, title: p.title, current: { date: p.publish_date, draft: p.draft_due_date, approval: p.approval_due_date }, proposed: { date: proposed, draft, approval } });
  }
  return out;
}

function daysBetween(a: DateOnly, b: DateOnly): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
