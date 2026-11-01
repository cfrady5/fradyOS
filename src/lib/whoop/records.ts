import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySummary } from "@/lib/intel/types";
import { isMissingTable } from "@/lib/data/health";
import { normalizeWhoop, type WhoopCycle, type WhoopRecovery, type WhoopSleep, type WhoopWorkout } from "./normalize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** Reads the stored raw WHOOP API records for a user and normalises them into partial days. */
export async function loadApiDays(client: Client, userId: string, timezone: string): Promise<Partial<DailySummary>[]> {
  const { data, error } = await client.from("whoop_records").select("kind,raw").eq("user_id", userId).is("deleted_at", null).limit(5000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as { kind: string; raw: unknown }[];
  const pick = <T>(kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.raw as T);
  if (!rows.length) return [];
  return normalizeWhoop({
    cycles: pick<WhoopCycle>("cycle"),
    recoveries: pick<WhoopRecovery>("recovery"),
    sleeps: pick<WhoopSleep>("sleep"),
    workouts: pick<WhoopWorkout>("workout"),
    timezone,
  });
}
