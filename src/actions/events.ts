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

/** Deletes an event. Linked tasks and posts are kept (their event link is cleared). */
export async function deleteEvent(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("events").select("source,sync_flag").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Event not found");
    if (existing.source === "monday" && existing.sync_flag !== "removed") return fail("This event still exists in Monday.com and would be re-imported. Archive it instead, or remove it from the board.");
    const { error } = await supabase.from("events").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
