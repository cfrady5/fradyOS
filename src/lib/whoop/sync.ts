import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/plaid/crypto";
import { exchangeCode, paginate, refreshTokens, whoopGet, WhoopError, type TokenSet } from "./client";
import type { WhoopCycle, WhoopRecovery, WhoopSleep, WhoopWorkout } from "./normalize";
import type { WhoopWebhookEvent } from "./webhook";
import { runHealthIntelligence } from "@/lib/intel/pipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface WhoopConnection {
  user_id: string;
  whoop_user_id: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scopes: string;
  status: "active" | "error" | "reauth_required" | "disconnected";
  error_message: string | null;
  last_synced_at: string | null;
  last_webhook_at: string | null;
  backfill_done: boolean;
}

const BACKFILL_DAYS = 180;

export async function storeTokens(admin: Client, userId: string, tokens: TokenSet, whoopUserId: string | null) {
  const row = {
    user_id: userId,
    whoop_user_id: whoopUserId,
    access_token_enc: encryptToken(tokens.access_token),
    refresh_token_enc: encryptToken(tokens.refresh_token),
    expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in - 60) * 1000).toISOString(),
    scopes: tokens.scope ?? "",
    status: "active",
    error_message: null,
  };
  const { error } = await admin.from("whoop_connections").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function connectWithCode(admin: Client, userId: string, code: string, redirectUri: string) {
  const tokens = await exchangeCode(code, redirectUri);
  let whoopUserId: string | null = null;
  try {
    const profile = await whoopGet<{ user_id?: number | string }>(tokens.access_token, "/user/profile/basic");
    whoopUserId = profile.user_id != null ? String(profile.user_id) : null;
  } catch {
    whoopUserId = null;
  }
  await storeTokens(admin, userId, tokens, whoopUserId);
}

/** A valid access token, refreshing when it expires within a minute. */
export async function accessTokenFor(admin: Client, conn: WhoopConnection): Promise<string> {
  if (Date.parse(conn.expires_at) - Date.now() > 60_000) return decryptToken(conn.access_token_enc);
  const tokens = await refreshTokens(decryptToken(conn.refresh_token_enc));
  await storeTokens(admin, conn.user_id, tokens, conn.whoop_user_id);
  return tokens.access_token;
}

async function markError(admin: Client, conn: WhoopConnection, e: unknown) {
  const status = e instanceof WhoopError && e.status === 401 ? "reauth_required" : "error";
  await admin.from("whoop_connections").update({ status, error_message: e instanceof Error ? e.message.slice(0, 500) : String(e) }).eq("user_id", conn.user_id);
}

async function upsertRecords(admin: Client, userId: string, kind: string, records: { id?: unknown; cycle_id?: unknown; updated_at?: string }[]) {
  if (!records.length) return;
  const rows = records.map((rec) => ({
    user_id: userId,
    kind,
    record_id: String(kind === "recovery" ? rec.cycle_id : rec.id),
    raw: rec,
    record_updated_at: rec.updated_at ?? null,
    synced_at: new Date().toISOString(),
    deleted_at: null,
  }));
  const { error } = await admin.from("whoop_records").upsert(rows, { onConflict: "user_id,kind,record_id" });
  if (error) throw new Error(error.message);
}

export interface SyncResult {
  cycles: number;
  recoveries: number;
  sleeps: number;
  workouts: number;
}

/**
 * Pulls every collection for a window. The first run backfills 180 days; later runs fetch records
 * updated since the last sync (minus a day of slack) so corrected records are picked up.
 */
export async function syncConnection(admin: Client, conn: WhoopConnection, opts: { timezone: string; today: string; trigger: "backfill" | "scheduled" | "manual" | "webhook" }): Promise<SyncResult> {
  const token = await accessTokenFor(admin, conn);
  const start = conn.backfill_done && conn.last_synced_at ? new Date(Date.parse(conn.last_synced_at) - 86_400_000) : new Date(Date.now() - BACKFILL_DAYS * 86_400_000);
  const params = { start: start.toISOString() };
  const counts: SyncResult = { cycles: 0, recoveries: 0, sleeps: 0, workouts: 0 };
  try {
    for await (const page of paginate<WhoopCycle>(token, "/cycle", params)) {
      await upsertRecords(admin, conn.user_id, "cycle", page);
      counts.cycles += page.length;
    }
    for await (const page of paginate<WhoopRecovery>(token, "/recovery", params)) {
      await upsertRecords(admin, conn.user_id, "recovery", page);
      counts.recoveries += page.length;
    }
    for await (const page of paginate<WhoopSleep>(token, "/activity/sleep", params)) {
      await upsertRecords(admin, conn.user_id, "sleep", page);
      counts.sleeps += page.length;
    }
    for await (const page of paginate<WhoopWorkout>(token, "/activity/workout", params)) {
      await upsertRecords(admin, conn.user_id, "workout", page);
      counts.workouts += page.length;
    }
    try {
      const body = await whoopGet<Record<string, unknown>>(token, "/user/measurement/body");
      await upsertRecords(admin, conn.user_id, "body", [{ id: "current", ...body }]);
    } catch {
      // Body measurements are optional.
    }
    await admin.from("whoop_connections").update({ status: "active", error_message: null, last_synced_at: new Date().toISOString(), backfill_done: true }).eq("user_id", conn.user_id);
  } catch (e) {
    await markError(admin, conn, e);
    throw e;
  }
  await runHealthIntelligence(admin, conn.user_id, { kind: "whoop_sync", today: opts.today, timezone: opts.timezone });
  return counts;
}

/** Applies one webhook: re-fetches the record it names (or marks it deleted), then recomputes. */
export async function applyWebhook(admin: Client, conn: WhoopConnection, evt: WhoopWebhookEvent, opts: { timezone: string; today: string }) {
  const [resource, action] = evt.type.split(".") as ["workout" | "sleep" | "recovery", "updated" | "deleted"];
  const id = String(evt.id);
  await admin.from("whoop_connections").update({ last_webhook_at: new Date().toISOString() }).eq("user_id", conn.user_id);
  if (action === "deleted") {
    await admin.from("whoop_records").update({ deleted_at: new Date().toISOString() }).eq("user_id", conn.user_id).eq("kind", resource).eq("record_id", id);
  } else {
    const token = await accessTokenFor(admin, conn);
    try {
      if (resource === "recovery") {
        const [cycle, recovery] = await Promise.all([whoopGet<WhoopCycle>(token, `/cycle/${id}`), whoopGet<WhoopRecovery>(token, `/cycle/${id}/recovery`)]);
        await upsertRecords(admin, conn.user_id, "cycle", [cycle]);
        await upsertRecords(admin, conn.user_id, "recovery", [recovery]);
      } else if (resource === "sleep") {
        await upsertRecords(admin, conn.user_id, "sleep", [await whoopGet<WhoopSleep>(token, `/activity/sleep/${id}`)]);
      } else {
        await upsertRecords(admin, conn.user_id, "workout", [await whoopGet<WhoopWorkout>(token, `/activity/workout/${id}`)]);
      }
    } catch (e) {
      if (!(e instanceof WhoopError && e.status === 404)) {
        await markError(admin, conn, e);
        throw e;
      }
    }
  }
  await runHealthIntelligence(admin, conn.user_id, { kind: "whoop_webhook", today: opts.today, timezone: opts.timezone });
}
