"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { eventInputSchema, firstZodMessage, zodFieldErrors, optionalUuid, optionalText } from "@/lib/validation";
import type { Event } from "@/lib/types";

export async function createEvent(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = eventInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    if (v.start_date && v.end_date && v.end_date < v.start_date) return fail("End date must be on or after the start date", { end_date: "Must be after start" });
    const supabase = await createClient();
    const { data, error } = await supabase.from("events").insert({ user_id: ws.userId, source: "manual", ...v }).select("id").single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Manual events: everything editable. Monday events: only local fields (work area, project, local notes). */
export async function updateEvent(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("events").select("*").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Event not found");
    const prev = existing as Event;

    let update: Record<string, unknown>;
    if (prev.source === "monday") {
      const local = z.object({ work_area_id: optionalUuid.optional(), project_id: optionalUuid.optional(), local_notes: optionalText(20000) }).safeParse(input);
      if (!local.success) return fail(firstZodMessage(local.error));
      update = local.data;
    } else {
      const parsed = eventInputSchema.partial().safeParse(input);
      if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
      update = parsed.data;
      const start = (update.start_date as string | null | undefined) ?? prev.start_date;
      const end = (update.end_date as string | null | undefined) ?? prev.end_date;
      if (start && end && end < start) return fail("End date must be on or after the start date", { end_date: "Must be after start" });
      if (update.start_date !== undefined && update.start_date !== prev.start_date) {
        update.previous_start_date = prev.dates_changed_at ? prev.previous_start_date : prev.start_date;
        update.previous_end_date = prev.dates_changed_at ? prev.previous_end_date : prev.end_date;
        update.dates_changed_at = new Date().toISOString();
      }
    }
    const { error } = await supabase.from("events").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function acknowledgeEventDateChange(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("events").update({ previous_start_date: null, previous_end_date: null, dates_changed_at: null }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function dismissEventFlag(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("events").update({ review_dismissed_at: new Date().toISOString() }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function archiveEvent(id: string, archived = true): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("events").update({ is_archived: archived, review_dismissed_at: archived ? new Date().toISOString() : null }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Deletes an event. Linked tasks and posts are kept (their event link is cleared). Monday items are excluded from future syncs. */
export async function deleteEvent(id: string): Promise<ActionResult<undefined>> {
  const res = await bulkDeleteEvents([id]);
  return res.ok ? ok(undefined) : fail(res.error);
}

// Ids are validated for shape only; Postgres rejects malformed uuids and RLS plus the user_id filter scope every write.
const idListSchema = z.array(z.string().min(1).max(64)).min(1, "Select at least one event").max(500);
const optionalId = z.preprocess((v) => (v === "" || v === undefined || v === "none" ? null : v), z.string().min(1).max(64).nullable());
const bulkPatchSchema = z.object({
  work_area_id: optionalId.optional(),
  project_id: optionalId.optional(),
  is_archived: z.boolean().optional(),
  dismiss_review: z.boolean().optional(),
});

/** Applies the same local changes (work area, project, archive, dismiss review flag) to many events at once. */
export async function bulkUpdateEvents(ids: unknown, patch: unknown): Promise<ActionResult<{ updated: number }>> {
  try {
    const ws = await requireWorkspace();
    const idList = idListSchema.safeParse(ids);
    if (!idList.success) return fail(firstZodMessage(idList.error));
    const parsed = bulkPatchSchema.safeParse(patch);
    if (!parsed.success) return fail(firstZodMessage(parsed.error));
    const update: Record<string, unknown> = {};
    if (parsed.data.work_area_id !== undefined) update.work_area_id = parsed.data.work_area_id;
    if (parsed.data.project_id !== undefined) update.project_id = parsed.data.project_id;
    if (parsed.data.is_archived !== undefined) {
      update.is_archived = parsed.data.is_archived;
      if (parsed.data.is_archived) update.review_dismissed_at = new Date().toISOString();
    }
    if (parsed.data.dismiss_review) update.review_dismissed_at = new Date().toISOString();
    if (!Object.keys(update).length) return fail("Nothing to change");
    const supabase = await createClient();
    const { data, error } = await supabase.from("events").update(update).eq("user_id", ws.userId).in("id", idList.data).select("id");
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ updated: (data ?? []).length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/**
 * Deletes many events. Linked tasks and posts are kept (their event link is cleared); notes and
 * attachments go with the event. Monday.com items are recorded as excluded so the next sync does
 * not bring them back; Settings → Monday.com can restore them.
 */
export async function bulkDeleteEvents(ids: unknown): Promise<ActionResult<{ deleted: number; excluded: number }>> {
  try {
    const ws = await requireWorkspace();
    const idList = idListSchema.safeParse(ids);
    if (!idList.success) return fail(firstZodMessage(idList.error));
    const supabase = await createClient();
    const { data: rows, error: loadErr } = await supabase.from("events").select("id,name,source,monday_board_id,monday_item_id").eq("user_id", ws.userId).in("id", idList.data);
    if (loadErr) return fail(loadErr.message);
    const events = (rows ?? []) as Pick<Event, "id" | "name" | "source" | "monday_board_id" | "monday_item_id">[];
    if (!events.length) return fail("No matching events");
    const monday = events.filter((e) => e.source === "monday" && e.monday_board_id && e.monday_item_id);
    if (monday.length) {
      const { error } = await supabase
        .from("monday_excluded_items")
        .upsert(monday.map((e) => ({ user_id: ws.userId, board_id: e.monday_board_id, item_id: e.monday_item_id, title: e.name })), { onConflict: "user_id,board_id,item_id" });
      if (error) return fail(error.message);
    }
    const { error } = await supabase.from("events").delete().eq("user_id", ws.userId).in("id", events.map((e) => e.id));
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ deleted: events.length, excluded: monday.length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Forgets locally deleted Monday.com items so the next sync imports them again. */
export async function restoreExcludedMondayItems(boardId?: string | null): Promise<ActionResult<{ restored: number }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    let q = supabase.from("monday_excluded_items").delete().eq("user_id", ws.userId);
    if (boardId) q = q.eq("board_id", boardId);
    const { data, error } = await q.select("id");
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ restored: (data ?? []).length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
