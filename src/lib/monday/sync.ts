import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, MondayColumnMap, MondayConnection, SyncResult, WorkArea } from "@/lib/types";
import { fetchAllItems, MondayError } from "./client";
import { isCanceledStatus, mapItemToEvent, mappedColumnIds, type MappedEventFields } from "./mapping";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

const SYNCED_FIELDS: (keyof MappedEventFields)[] = ["name", "start_date", "end_date", "start_time", "location", "program", "owner", "status", "website_url", "notes"];

/**
 * Read-only sync: Monday.com is the source of truth for imported fields.
 * - Matches on (user, board, item id) so re-runs never duplicate.
 * - Updates changed fields; records previous dates when an event moves.
 * - Flags canceled (status label) and removed (missing from board) items for review.
 * - Never touches local work: tasks, social posts, notes, work area, project, local_notes.
 */
export async function runMondaySync(supabase: Client, userId: string, connection: MondayConnection, trigger: "manual" | "scheduled"): Promise<SyncResult> {
  const started = Date.now();
  const { data: run } = await supabase.from("monday_sync_runs").insert({ user_id: userId, trigger, status: "running" }).select("id").single();
  const runId = run?.id as string | undefined;
  await supabase.from("monday_connections").update({ last_sync_started_at: new Date().toISOString() }).eq("id", connection.id);

  const result: SyncResult = { items_seen: 0, created: 0, updated: 0, unchanged: 0, dates_changed: 0, flagged_canceled: 0, flagged_removed: 0, duration_ms: 0 };

  try {
    const map = (connection.column_map ?? {}) as MondayColumnMap;
    if (!map.start) throw new MondayError("Map a start date column before syncing.");
    const items = await fetchAllItems(connection.board_id, mappedColumnIds(map));
    result.items_seen = items.length;

    const { data: existingRows, error: exErr } = await supabase.from("events").select("*").eq("user_id", userId).eq("source", "monday").eq("monday_board_id", connection.board_id);
    if (exErr) throw new Error(exErr.message);
    const existing = new Map(((existingRows ?? []) as Event[]).map((e) => [e.monday_item_id as string, e]));

    const { data: areas } = await supabase.from("work_areas").select("id,name").eq("user_id", userId).eq("is_archived", false);
    const areaByName = new Map(((areas ?? []) as Pick<WorkArea, "id" | "name">[]).map((a) => [a.name.trim().toLowerCase(), a.id]));

    const now = new Date().toISOString();
    const seen = new Set<string>();

    for (const item of items) {
      seen.add(item.id);
      const fields = mapItemToEvent(item, map);
      const canceled = isCanceledStatus(fields.status, connection.canceled_labels ?? []) || (item.state && item.state !== "active");
      const prev = existing.get(item.id);
      const autoArea = fields.program ? areaByName.get(fields.program.trim().toLowerCase()) ?? null : null;

      if (!prev) {
        const { error } = await supabase.from("events").insert({
          user_id: userId,
          source: "monday",
          monday_board_id: connection.board_id,
          monday_item_id: item.id,
          monday_item_url: item.url,
          monday_group: item.group?.title ?? null,
          monday_state: item.state ?? "active",
          monday_synced_at: now,
          monday_raw: { updated_at: item.updated_at, column_values: item.column_values },
          work_area_id: autoArea,
          ...fields,
          sync_flag: canceled ? "canceled" : "none",
          sync_flag_reason: canceled ? `Status “${fields.status ?? item.state}” looks canceled` : null,
          sync_flag_at: canceled ? now : null,
        });
        if (error) {
          // Unique violation means a concurrent run inserted it; treat as unchanged.
          if ((error as { code?: string }).code === "23505") result.unchanged++;
          else throw new Error(error.message);
        } else {
          result.created++;
          if (canceled) result.flagged_canceled++;
        }
        continue;
      }

      const update: Record<string, unknown> = {};
      let changed = false;
      for (const k of SYNCED_FIELDS) {
        if ((prev[k] ?? null) !== (fields[k] ?? null)) {
          update[k] = fields[k];
          changed = true;
        }
      }
      const datesMoved = (prev.start_date ?? null) !== (fields.start_date ?? null) || (prev.end_date ?? null) !== (fields.end_date ?? null);
      if (datesMoved) {
        // Keep the earliest "previous" date until the user acknowledges the change.
        if (!prev.dates_changed_at) {
          update.previous_start_date = prev.start_date;
          update.previous_end_date = prev.end_date;
        }
        update.dates_changed_at = now;
        result.dates_changed++;
      }
      if (prev.monday_item_url !== item.url) update.monday_item_url = item.url;
      if ((prev.monday_group ?? null) !== (item.group?.title ?? null)) update.monday_group = item.group?.title ?? null;
      if ((prev.monday_state ?? null) !== (item.state ?? null)) update.monday_state = item.state;
      if (!prev.work_area_id && autoArea) update.work_area_id = autoArea;

      if (canceled && prev.sync_flag !== "canceled") {
        update.sync_flag = "canceled";
        update.sync_flag_reason = `Status “${fields.status ?? item.state}” looks canceled`;
        update.sync_flag_at = now;
        update.review_dismissed_at = null;
        result.flagged_canceled++;
      } else if (!canceled && prev.sync_flag !== "none") {
        // Back to normal (un-canceled or reappeared).
        update.sync_flag = "none";
        update.sync_flag_reason = null;
        update.sync_flag_at = null;
        update.review_dismissed_at = null;
      }

      if (Object.keys(update).length === 0) {
        result.unchanged++;
        continue;
      }
      update.monday_synced_at = now;
      update.monday_raw = { updated_at: item.updated_at, column_values: item.column_values };
      const { error } = await supabase.from("events").update(update).eq("id", prev.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      if (changed || datesMoved) result.updated++;
      else result.unchanged++;
    }

    // Items that disappeared from the board (deleted/archived in Monday): flag, never delete local work.
    for (const [itemId, prev] of existing) {
      if (seen.has(itemId)) continue;
      if (prev.sync_flag === "removed") continue;
      const { error } = await supabase
        .from("events")
        .update({ sync_flag: "removed", sync_flag_reason: "Item no longer on the Monday.com board", sync_flag_at: now, review_dismissed_at: null, monday_synced_at: now })
        .eq("id", prev.id)
        .eq("user_id", userId);
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
