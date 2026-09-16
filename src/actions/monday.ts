"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { fetchBoardSchema, fetchMe, isMondayConfigured, listBoards, mondayQuery, mondayTokenProblem, type MondayBoardSchema, type MondayBoardSummary, type MondayMe } from "@/lib/monday/client";
import { runMondaySync } from "@/lib/monday/sync";
import { pushSocialPostToMonday, runMondaySocialSync } from "@/lib/monday/social-sync";
import { getMondayWebhookUrl } from "@/lib/monday/webhook";
import type { MondayConnection, MondayPurpose, SyncResult } from "@/lib/types";

const purposeSchema = z.enum(["events", "social"]);

async function loadConnection(purpose: MondayPurpose) {
  const ws = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase.from("monday_connections").select("*").eq("user_id", ws.userId).eq("purpose", purpose).maybeSingle();
  return { ws, supabase, connection: (data ?? null) as MondayConnection | null };
}

export async function testMondayConnection(): Promise<ActionResult<MondayMe>> {
  try {
    await requireWorkspace();
    const problem = mondayTokenProblem(process.env.MONDAY_API_TOKEN);
    if (problem) return fail(`${problem} Then redeploy.`);
    const me = await fetchMe();
    return ok(me);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function listMondayBoards(): Promise<ActionResult<MondayBoardSummary[]>> {
  try {
    await requireWorkspace();
    return ok(await listBoards());
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function inspectMondayBoard(boardId: string): Promise<ActionResult<MondayBoardSchema>> {
  const id = z.string().regex(/^\d+$/).safeParse(boardId);
  if (!id.success) return fail("Invalid board id");
  try {
    await requireWorkspace();
    const schema = await fetchBoardSchema(id.data);
    if (!schema) return fail("Board not found or not accessible with this token");
    return ok(schema);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const colId = z.preprocess((v) => (v === "" ? null : v), z.string().max(200).nullable().optional());
const saveSchema = z.object({
  purpose: purposeSchema.default("events"),
  board_id: z.string().regex(/^\d+$/, "Pick a board"),
  board_name: z.string().max(300).nullable().optional(),
  board_url: z.string().max(2000).nullable().optional(),
  column_map: z.record(z.string(), colId),
  columns_snapshot: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), settings_str: z.string().nullable().optional() })).max(300).default([]),
  canceled_labels: z.array(z.string().trim().min(1).max(60)).max(20).default(["canceled", "cancelled"]),
  group_id: z.preprocess((v) => (v === "" ? null : v), z.string().max(200).nullable().optional()),
  status_map: z.record(z.string(), z.string().max(100)).default({}),
  auto_sync_enabled: z.boolean().default(true),
});

export async function saveMondayConnection(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.purpose === "events" && !v.column_map.start) return fail("Map a start date column (Date or Timeline).");
  if (v.purpose === "social" && !v.column_map.publish_date) return fail("Map the publish date column.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("monday_connections")
      .upsert({ user_id: ws.userId, ...v, status_map: Object.fromEntries(Object.entries(v.status_map).filter(([, l]) => l && l.trim())) }, { onConflict: "user_id,purpose" })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setMondayAutoSync(purpose: MondayPurpose, enabled: boolean): Promise<ActionResult<undefined>> {
  try {
    const { ws, supabase } = await loadConnection(purpose);
    const { error } = await supabase.from("monday_connections").update({ auto_sync_enabled: enabled }).eq("user_id", ws.userId).eq("purpose", purpose);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function disconnectMonday(purpose: MondayPurpose): Promise<ActionResult<undefined>> {
  try {
    const { ws, supabase } = await loadConnection(purpose);
    const { error } = await supabase.from("monday_connections").delete().eq("user_id", ws.userId).eq("purpose", purpose);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function syncMondayNow(purpose: MondayPurpose = "events"): Promise<ActionResult<SyncResult>> {
  try {
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const { ws, supabase, connection } = await loadConnection(purpose);
    if (!connection) return fail("Choose a board and map its columns first.");
    const result = purpose === "social" ? await runMondaySocialSync(supabase, ws.userId, connection, "manual") : await runMondaySync(supabase, ws.userId, connection, "manual");
    revalidatePath("/", "layout");
    return ok(result);
  } catch (e) {
    revalidatePath("/", "layout");
    return fail(errorMessage(e));
  }
}

const WEBHOOK_EVENTS = ["create_item", "change_column_value", "change_name", "item_deleted", "item_archived", "item_restored"] as const;

/** Creates the Monday.com webhooks for a connected board so changes sync within seconds. */
export async function registerMondayWebhooks(purpose: MondayPurpose = "events"): Promise<ActionResult<{ created: number }>> {
  try {
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const url = await getMondayWebhookUrl();
    if (!url) return fail("Set MONDAY_WEBHOOK_SECRET (16+ characters) on the server first.");
    const { supabase, connection } = await loadConnection(purpose);
    if (!connection) return fail("Connect a board first.");
    const existing = (connection.webhook_ids ?? []) as string[];
    const ids = [...existing];
    for (const event of WEBHOOK_EVENTS) {
      const data = await mondayQuery<{ create_webhook: { id: string } | null }>(
        `mutation ($board: ID!, $url: String!, $event: WebhookEventType!) { create_webhook(board_id: $board, url: $url, event: $event) { id } }`,
        { board: connection.board_id, url, event },
      );
      if (data.create_webhook?.id) ids.push(String(data.create_webhook.id));
    }
    const { error } = await supabase.from("monday_connections").update({ webhook_ids: ids }).eq("id", connection.id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ created: ids.length - existing.length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function removeMondayWebhooks(purpose: MondayPurpose = "events"): Promise<ActionResult<{ removed: number }>> {
  try {
    const { supabase, connection } = await loadConnection(purpose);
    if (!connection) return fail("No connection.");
    let removed = 0;
    for (const id of (connection.webhook_ids ?? []) as string[]) {
      try {
        await mondayQuery(`mutation ($id: ID!) { delete_webhook(id: $id) { id } }`, { id });
        removed++;
      } catch (e) {
        console.error("delete_webhook failed", id, e instanceof Error ? e.message : e);
      }
    }
    const { error } = await supabase.from("monday_connections").update({ webhook_ids: [] }).eq("id", connection.id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ removed });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Creates or updates one post on the social board. */
export async function sendPostToMonday(postId: string): Promise<ActionResult<{ item_id: string; url: string | null; created: boolean }>> {
  const id = z.string().uuid().safeParse(postId);
  if (!id.success) return fail("Invalid post");
  try {
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const { ws, supabase, connection } = await loadConnection("social");
    if (!connection) return fail("Connect the social media board in Settings → Monday.com first.");
    const res = await pushSocialPostToMonday(supabase, ws.userId, connection, id.data);
    revalidatePath("/", "layout");
    return ok(res);
  } catch (e) {
    revalidatePath("/", "layout");
    return fail(errorMessage(e));
  }
}

/** Pushes every not-yet-linked post of an event to the social board. */
export async function sendEventPostsToMonday(eventId: string): Promise<ActionResult<{ pushed: number; failed: number; errors: string[] }>> {
  const id = z.string().uuid().safeParse(eventId);
  if (!id.success) return fail("Invalid event");
  try {
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const { ws, supabase, connection } = await loadConnection("social");
    if (!connection) return fail("Connect the social media board in Settings → Monday.com first.");
    const { data: posts } = await supabase.from("social_posts").select("id,title").eq("user_id", ws.userId).eq("event_id", id.data).is("monday_item_id", null);
    let pushed = 0;
    const errors: string[] = [];
    for (const p of (posts ?? []) as { id: string; title: string }[]) {
      try {
        await pushSocialPostToMonday(supabase, ws.userId, connection, p.id);
        pushed++;
      } catch (e) {
        errors.push(`${p.title}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    revalidatePath("/", "layout");
    return ok({ pushed, failed: errors.length, errors });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
