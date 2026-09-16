"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { fetchBoardSchema, fetchMe, isMondayConfigured, listBoards, mondayTokenProblem, type MondayBoardSchema, type MondayBoardSummary, type MondayMe } from "@/lib/monday/client";
import { runMondaySync } from "@/lib/monday/sync";
import { getMondayWebhookUrl } from "@/lib/monday/webhook";
import { mondayQuery } from "@/lib/monday/client";
import type { MondayConnection, SyncResult } from "@/lib/types";

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
    const boards = await listBoards();
    return ok(boards);
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
  board_id: z.string().regex(/^\d+$/, "Pick a board"),
  board_name: z.string().max(300).nullable().optional(),
  column_map: z.object({ name: colId, start: colId, end: colId, location: colId, program: colId, owner: colId, status: colId, website: colId, notes: colId }),
  columns_snapshot: z.array(z.object({ id: z.string(), title: z.string(), type: z.string() })).max(300).default([]),
  canceled_labels: z.array(z.string().trim().min(1).max(60)).max(20).default(["canceled", "cancelled"]),
  auto_sync_enabled: z.boolean().default(true),
});

export async function saveMondayConnection(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (!parsed.data.column_map.start) return fail("Map a start date column (Date or Timeline).");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("monday_connections")
      .upsert({ user_id: ws.userId, ...parsed.data }, { onConflict: "user_id" })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setMondayAutoSync(enabled: boolean): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("monday_connections").update({ auto_sync_enabled: enabled }).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function disconnectMonday(): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("monday_connections").delete().eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function syncMondayNow(): Promise<ActionResult<SyncResult>> {
  try {
    const ws = await requireWorkspace();
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const supabase = await createClient();
    const { data: conn } = await supabase.from("monday_connections").select("*").eq("user_id", ws.userId).maybeSingle();
    if (!conn) return fail("Choose a board and map its columns first.");
    const result = await runMondaySync(supabase, ws.userId, conn as MondayConnection, "manual");
    revalidatePath("/", "layout");
    return ok(result);
  } catch (e) {
    revalidatePath("/", "layout");
    return fail(errorMessage(e));
  }
}

const WEBHOOK_EVENTS = ["create_item", "change_column_value", "change_name", "item_deleted", "item_archived", "item_restored"] as const;

/** Creates the Monday.com webhooks for the connected board so changes sync within seconds. */
export async function registerMondayWebhooks(): Promise<ActionResult<{ created: number }>> {
  try {
    const ws = await requireWorkspace();
    if (!isMondayConfigured()) return fail("MONDAY_API_TOKEN is not set on the server.");
    const url = await getMondayWebhookUrl();
    if (!url) return fail("Set MONDAY_WEBHOOK_SECRET (16+ characters) on the server first.");
    const supabase = await createClient();
    const { data: conn } = await supabase.from("monday_connections").select("*").eq("user_id", ws.userId).maybeSingle();
    if (!conn) return fail("Connect a board first.");
    const existing = ((conn as MondayConnection).webhook_ids ?? []) as string[];
    const ids: string[] = [...existing];
    for (const event of WEBHOOK_EVENTS) {
      const data = await mondayQuery<{ create_webhook: { id: string } | null }>(
        `mutation ($board: ID!, $url: String!, $event: WebhookEventType!) { create_webhook(board_id: $board, url: $url, event: $event) { id } }`,
        { board: conn.board_id, url, event },
      );
      if (data.create_webhook?.id) ids.push(String(data.create_webhook.id));
    }
    const { error } = await supabase.from("monday_connections").update({ webhook_ids: ids }).eq("id", conn.id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ created: ids.length - existing.length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function removeMondayWebhooks(): Promise<ActionResult<{ removed: number }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: conn } = await supabase.from("monday_connections").select("*").eq("user_id", ws.userId).maybeSingle();
    if (!conn) return fail("No connection.");
    const ids = ((conn as MondayConnection).webhook_ids ?? []) as string[];
    let removed = 0;
    for (const id of ids) {
      try {
        await mondayQuery(`mutation ($id: ID!) { delete_webhook(id: $id) { id } }`, { id });
        removed++;
      } catch (e) {
        console.error("delete_webhook failed", id, e instanceof Error ? e.message : e);
      }
    }
    const { error } = await supabase.from("monday_connections").update({ webhook_ids: [] }).eq("id", conn.id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ removed });
  } catch (e) {
    return fail(errorMessage(e));
  }
}
