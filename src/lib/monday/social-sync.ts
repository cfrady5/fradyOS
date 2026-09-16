import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, MondayConnection, SocialColumnMap, SocialPost, SyncResult } from "@/lib/types";
import { changeColumnValues, createItem, fetchAllItems, MondayError } from "./client";
import { NAME_COLUMN } from "./mapping";
import { buildColumnValues, mapItemToSocialPost } from "./social-mapping";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

function mappedIds(map: SocialColumnMap): string[] {
  return Array.from(new Set(Object.values(map).filter((v): v is string => Boolean(v) && v !== NAME_COLUMN)));
}

/**
 * Social board → FRADY OS. Items are matched by (user, board, item id) so re-runs never duplicate.
 * For linked posts, Monday is the source of truth for mapped fields; local-only fields
 * (assets, follow-up date, template linkage, notes not mapped) are never touched.
 */
export async function runMondaySocialSync(supabase: Client, userId: string, connection: MondayConnection, trigger: "manual" | "scheduled" | "webhook"): Promise<SyncResult> {
  const started = Date.now();
  const { data: run } = await supabase.from("monday_sync_runs").insert({ user_id: userId, trigger, status: "running", connection_id: connection.id, purpose: "social" }).select("id").single();
  const runId = run?.id as string | undefined;
  await supabase.from("monday_connections").update({ last_sync_started_at: new Date().toISOString() }).eq("id", connection.id);
  const result: SyncResult = { items_seen: 0, created: 0, updated: 0, unchanged: 0, dates_changed: 0, flagged_canceled: 0, flagged_removed: 0, duration_ms: 0 };

  try {
    const map = (connection.column_map ?? {}) as SocialColumnMap;
    const statusMap = connection.status_map ?? {};
    if (!map.publish_date) throw new MondayError("Map a publish date column before syncing the social board.");
    const items = await fetchAllItems(connection.board_id, mappedIds(map));
    result.items_seen = items.length;

    const [{ data: existingRows, error: exErr }, { data: eventRows }] = await Promise.all([
      supabase.from("social_posts").select("*").eq("user_id", userId).eq("monday_board_id", connection.board_id),
      supabase.from("events").select("id,name,monday_item_id,work_area_id,project_id").eq("user_id", userId).eq("source", "monday"),
    ]);
    if (exErr) throw new Error(exErr.message);
    const existing = new Map(((existingRows ?? []) as SocialPost[]).map((p) => [p.monday_item_id as string, p]));
    const eventsByItem = new Map(((eventRows ?? []) as Pick<Event, "id" | "name" | "monday_item_id" | "work_area_id" | "project_id">[]).map((e) => [e.monday_item_id as string, e]));

    const now = new Date().toISOString();
    const seen = new Set<string>();

    for (const item of items) {
      seen.add(item.id);
      const f = mapItemToSocialPost(item, map, statusMap);
      const linkedEvent = f.linked_event_item_ids.map((id) => eventsByItem.get(id)).find(Boolean) ?? null;
      const prev = existing.get(item.id);
      const status = f.status ?? prev?.status ?? "idea";

      if (!prev) {
        const { error } = await supabase.from("social_posts").insert({
          user_id: userId,
          title: f.title,
          publish_date: f.publish_date,
          publish_time: f.publish_time,
          draft_due_date: f.draft_due_date,
          approval_due_date: f.approval_due_date,
          status,
          published_at: status === "published" ? now : null,
          platform: f.platform,
          brand: f.brand,
          caption: f.caption,
          published_url: f.published_url,
          approver: f.approver,
          notes: f.notes,
          event_id: linkedEvent?.id ?? null,
          work_area_id: linkedEvent?.work_area_id ?? null,
          project_id: linkedEvent?.project_id ?? null,
          monday_board_id: connection.board_id,
          monday_item_id: item.id,
          monday_item_url: item.url,
          monday_synced_at: now,
          monday_raw: { updated_at: item.updated_at, status_label: f.status_label, column_values: item.column_values },
        });
        if (error) {
          if ((error as { code?: string }).code === "23505") result.unchanged++;
          else throw new Error(error.message);
        } else result.created++;
        continue;
      }

      const update: Record<string, unknown> = {};
      const fields: [keyof SocialPost, unknown][] = [
        ["title", f.title], ["publish_date", f.publish_date], ["publish_time", f.publish_time], ["draft_due_date", f.draft_due_date], ["approval_due_date", f.approval_due_date],
        ["platform", f.platform], ["brand", f.brand], ["caption", f.caption], ["published_url", f.published_url], ["approver", f.approver], ["notes", f.notes],
      ];
      for (const [k, v] of fields) {
        // Only overwrite mapped fields; skip fields whose column isn't mapped.
        const mappedKey: Record<string, keyof SocialColumnMap> = { title: "name", publish_date: "publish_date", publish_time: "publish_date", draft_due_date: "draft_due", approval_due_date: "approval_due", platform: "platform", brand: "brand", caption: "caption", published_url: "published_url", approver: "approver", notes: "notes" };
        const mk = mappedKey[k];
        if (mk !== "name" && !map[mk]) continue;
        if ((prev[k] ?? null) !== (v ?? null)) update[k] = v;
      }
      if (f.status && f.status !== prev.status) {
        update.status = f.status;
        update.published_at = f.status === "published" ? (prev.published_at ?? now) : null;
      }
      if (linkedEvent && prev.event_id !== linkedEvent.id) update.event_id = linkedEvent.id;
      if (prev.monday_item_url !== item.url) update.monday_item_url = item.url;
      if (prev.monday_removed_at) update.monday_removed_at = null;
      if ((update.publish_date !== undefined && update.publish_date !== prev.publish_date)) result.dates_changed++;

      if (Object.keys(update).length === 0) {
        result.unchanged++;
        continue;
      }
      update.monday_synced_at = now;
      update.monday_raw = { updated_at: item.updated_at, status_label: f.status_label, column_values: item.column_values };
      const { error } = await supabase.from("social_posts").update(update).eq("id", prev.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      result.updated++;
    }

    for (const [itemId, prev] of existing) {
      if (seen.has(itemId) || prev.monday_removed_at) continue;
      const { error } = await supabase.from("social_posts").update({ monday_removed_at: now, monday_synced_at: now }).eq("id", prev.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      result.flagged_removed++;
    }

    result.duration_ms = Date.now() - started;
    await supabase.from("monday_connections").update({ last_success_at: new Date().toISOString(), last_error: null, last_result: result }).eq("id", connection.id);
    if (runId) await supabase.from("monday_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), result }).eq("id", runId);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    result.duration_ms = Date.now() - started;
    await supabase.from("monday_connections").update({ last_error: message, last_result: result }).eq("id", connection.id);
    if (runId) await supabase.from("monday_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: message, result }).eq("id", runId);
    throw e;
  }
}

/** FRADY OS → social board: creates the item on first push, updates mapped columns afterwards. */
export async function pushSocialPostToMonday(supabase: Client, userId: string, connection: MondayConnection, postId: string): Promise<{ item_id: string; url: string | null; created: boolean }> {
  const { data: postRow, error } = await supabase.from("social_posts").select("*").eq("id", postId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!postRow) throw new Error("Post not found");
  const post = postRow as SocialPost;
  const map = (connection.column_map ?? {}) as SocialColumnMap;
  let event: { mondayItemId: string | null; name: string | null } | null = null;
  if (post.event_id) {
    const { data: ev } = await supabase.from("events").select("name,monday_item_id").eq("id", post.event_id).maybeSingle();
    if (ev) event = { mondayItemId: (ev.monday_item_id as string | null) ?? null, name: ev.name as string };
  }
  const values = buildColumnValues(post, map, connection.status_map ?? {}, connection.columns_snapshot ?? [], event);
  try {
    if (post.monday_item_id && post.monday_board_id === connection.board_id) {
      await changeColumnValues(connection.board_id, post.monday_item_id, { ...values, name: post.title });
      await supabase.from("social_posts").update({ monday_pushed_at: new Date().toISOString(), monday_push_error: null, monday_removed_at: null }).eq("id", post.id);
      return { item_id: post.monday_item_id, url: post.monday_item_url, created: false };
    }
    const created = await createItem(connection.board_id, connection.group_id, post.title, values);
    const { error: upErr } = await supabase
      .from("social_posts")
      .update({ monday_board_id: connection.board_id, monday_item_id: String(created.id), monday_item_url: created.url, monday_pushed_at: new Date().toISOString(), monday_synced_at: new Date().toISOString(), monday_push_error: null })
      .eq("id", post.id);
    if (upErr) throw new Error(upErr.message);
    return { item_id: String(created.id), url: created.url, created: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Push failed";
    await supabase.from("social_posts").update({ monday_push_error: message }).eq("id", post.id);
    throw e;
  }
}
