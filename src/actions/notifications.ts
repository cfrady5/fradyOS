"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { generateNotificationsForUser } from "@/lib/notifications";
import type { Notification } from "@/lib/types";

export async function markNotificationRead(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function markAllNotificationsRead(): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ws.userId).is("read_at", null);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Generates due-soon / overdue / follow-up notifications (deduplicated). Throttled to every 10 minutes. */
export async function refreshNotifications(force = false): Promise<ActionResult<{ created: number; unread: Notification[] }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const last = ws.profile.notifications_generated_at ? new Date(ws.profile.notifications_generated_at).getTime() : 0;
    let created = 0;
    if (force || Date.now() - last > 10 * 60 * 1000) {
      created = await generateNotificationsForUser(supabase, ws.userId, ws.profile, ws.today);
      await supabase.from("profiles").update({ notifications_generated_at: new Date().toISOString() }).eq("id", ws.userId);
    }
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", ws.userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    if (created > 0) revalidatePath("/", "layout");
    return ok({ created, unread: (data ?? []) as Notification[] });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function listAllNotifications(): Promise<ActionResult<Notification[]>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", ws.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return fail(error.message);
    return ok((data ?? []) as Notification[]);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
