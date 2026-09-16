"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { dateOnly, optionalDate, platformSchema } from "@/lib/validation";
import type { Event, EventTemplateItem, SocialPost, Task } from "@/lib/types";
import { proposeDateChanges } from "@/lib/templates";

const templateSchema = z.object({ name: z.string().trim().min(1, "Name the template").max(120), description: z.string().trim().max(2000).nullable().optional(), is_default: z.boolean().optional() });

export async function createTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase.from("event_templates").insert({ user_id: ws.userId, ...parsed.data }).select("id").single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateTemplate(id: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = templateSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    if (parsed.data.is_default) await supabase.from("event_templates").update({ is_default: false }).eq("user_id", ws.userId);
    const { error } = await supabase.from("event_templates").update(parsed.data).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteTemplate(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("event_templates").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const itemSchema = z.object({
  kind: z.enum(["task", "social"]),
  title: z.string().trim().min(1, "Give the milestone a title").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  offset_days: z.coerce.number().int().min(-365).max(365),
  platform: z.preprocess((v) => (v === "" ? null : v), platformSchema.nullable().optional()),
  brand: z.string().trim().max(120).nullable().optional(),
  draft_lead_days: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(120).nullable()),
  approval_lead_days: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(120).nullable()),
  sort_order: z.coerce.number().int().optional(),
});

export async function upsertTemplateItem(templateId: string, itemId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: tpl } = await supabase.from("event_templates").select("id").eq("id", templateId).eq("user_id", ws.userId).maybeSingle();
    if (!tpl) return fail("Template not found");
    const v = { ...parsed.data, brand: parsed.data.brand || null, description: parsed.data.description || null };
    if (itemId) {
      const { error } = await supabase.from("event_template_items").update(v).eq("id", itemId).eq("user_id", ws.userId);
      if (error) return fail(error.message);
      revalidatePath("/", "layout");
      return ok({ id: itemId });
    }
    const { count } = await supabase.from("event_template_items").select("id", { count: "exact", head: true }).eq("template_id", templateId);
    const { data, error } = await supabase.from("event_template_items").insert({ user_id: ws.userId, template_id: templateId, ...v, sort_order: v.sort_order ?? count ?? 0 }).select("id").single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteTemplateItem(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("event_template_items").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function loadTemplateItems(templateId: string): Promise<ActionResult<EventTemplateItem[]>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase.from("event_template_items").select("*").eq("template_id", templateId).eq("user_id", ws.userId).order("sort_order");
    if (error) return fail(error.message);
    return ok((data ?? []) as EventTemplateItem[]);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const applySchema = z.object({
  event_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        template_item_id: z.string().uuid(),
        kind: z.enum(["task", "social"]),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2000).nullable().optional(),
        offset_days: z.number().int(),
        date: dateOnly,
        draft_due_date: optionalDate.optional(),
        approval_due_date: optionalDate.optional(),
        platform: z.preprocess((v) => (v === "" ? null : v), platformSchema.nullable().optional()),
        brand: z.string().max(120).nullable().optional(),
      }),
    )
    .max(100),
});

/** Creates the reviewed items. Items already created from the same template item for this event are skipped. */
export async function applyTemplateToEvent(input: unknown): Promise<ActionResult<{ tasks: number; posts: number; skipped: number }>> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: ev } = await supabase.from("events").select("*").eq("id", parsed.data.event_id).eq("user_id", ws.userId).maybeSingle();
    if (!ev) return fail("Event not found");
    const event = ev as Event;
    if (!event.start_date) return fail("This event has no start date yet.");

    const [{ data: tRows }, { data: pRows }] = await Promise.all([
      supabase.from("tasks").select("template_item_id").eq("event_id", event.id).not("template_item_id", "is", null),
      supabase.from("social_posts").select("template_item_id").eq("event_id", event.id).not("template_item_id", "is", null),
    ]);
    const applied = new Set([...((tRows ?? []) as { template_item_id: string }[]), ...((pRows ?? []) as { template_item_id: string }[])].map((r) => r.template_item_id));

    let tasks = 0;
    let posts = 0;
    let skipped = 0;
    for (const it of parsed.data.items) {
      if (applied.has(it.template_item_id)) {
        skipped++;
        continue;
      }
      if (it.kind === "task") {
        const { error } = await supabase.from("tasks").insert({
          user_id: ws.userId,
          event_id: event.id,
          work_area_id: event.work_area_id,
          project_id: event.project_id,
          title: it.title,
          description: it.description ?? null,
          status: "todo",
          due_date: it.date,
          template_item_id: it.template_item_id,
          anchor_date: event.start_date,
          offset_days: it.offset_days,
        });
        if (error) return fail(error.message);
        tasks++;
      } else {
        const { error } = await supabase.from("social_posts").insert({
          user_id: ws.userId,
          event_id: event.id,
          work_area_id: event.work_area_id,
          project_id: event.project_id,
          title: it.title,
          notes: it.description ?? null,
          status: "idea",
          platform: it.platform ?? null,
          brand: it.brand ?? null,
          publish_date: it.date,
          draft_due_date: it.draft_due_date ?? null,
          approval_due_date: it.approval_due_date ?? null,
          template_item_id: it.template_item_id,
          anchor_date: event.start_date,
          offset_days: it.offset_days,
        });
        if (error) return fail(error.message);
        posts++;
      }
      applied.add(it.template_item_id);
    }
    revalidatePath("/", "layout");
    return ok({ tasks, posts, skipped });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const proposalSchema = z.object({ event_id: z.string().uuid(), task_ids: z.array(z.string().uuid()).default([]), post_ids: z.array(z.string().uuid()).default([]) });

/** Applies proposed date changes for the selected items (recomputed server-side from the event's current start date). */
export async function acceptDateProposals(input: unknown): Promise<ActionResult<{ updated: number }>> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: ev } = await supabase.from("events").select("*").eq("id", parsed.data.event_id).eq("user_id", ws.userId).maybeSingle();
    if (!ev) return fail("Event not found");
    const event = ev as Event;
    const [{ data: tasks }, { data: posts }] = await Promise.all([
      supabase.from("tasks").select("*").eq("event_id", event.id).eq("user_id", ws.userId),
      supabase.from("social_posts").select("*").eq("event_id", event.id).eq("user_id", ws.userId),
    ]);
    const proposals = proposeDateChanges(event.start_date, (tasks ?? []) as Task[], (posts ?? []) as SocialPost[]);
    let updated = 0;
    for (const p of proposals) {
      if (p.kind === "task" && parsed.data.task_ids.includes(p.id)) {
        const { error } = await supabase.from("tasks").update({ due_date: p.proposed.date, anchor_date: event.start_date }).eq("id", p.id).eq("user_id", ws.userId);
        if (error) return fail(error.message);
        await supabase.from("task_activity").insert({ user_id: ws.userId, task_id: p.id, kind: "rescheduled", detail: `Event moved: due ${p.current.date ?? "none"} → ${p.proposed.date}` });
        updated++;
      } else if (p.kind === "social" && parsed.data.post_ids.includes(p.id)) {
        const { error } = await supabase
          .from("social_posts")
          .update({ publish_date: p.proposed.date, draft_due_date: p.proposed.draft, approval_due_date: p.proposed.approval, anchor_date: event.start_date })
          .eq("id", p.id)
          .eq("user_id", ws.userId);
        if (error) return fail(error.message);
        updated++;
      }
    }
    revalidatePath("/", "layout");
    return ok({ updated });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Keeps current dates for the selected items and stops proposing changes for this move. */
export async function keepDatesForProposals(input: unknown): Promise<ActionResult<{ updated: number }>> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: ev } = await supabase.from("events").select("start_date").eq("id", parsed.data.event_id).eq("user_id", ws.userId).maybeSingle();
    if (!ev?.start_date) return fail("Event not found");
    let updated = 0;
    if (parsed.data.task_ids.length) {
      const { error, count } = await supabase.from("tasks").update({ anchor_date: ev.start_date, date_overridden: true }, { count: "exact" }).in("id", parsed.data.task_ids).eq("user_id", ws.userId);
      if (error) return fail(error.message);
      updated += count ?? 0;
    }
    if (parsed.data.post_ids.length) {
      const { error, count } = await supabase.from("social_posts").update({ anchor_date: ev.start_date, date_overridden: true }, { count: "exact" }).in("id", parsed.data.post_ids).eq("user_id", ws.userId);
      if (error) return fail(error.message);
      updated += count ?? 0;
    }
    revalidatePath("/", "layout");
    return ok({ updated });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
