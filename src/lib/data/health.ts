import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { summarize, type DayStat, type HealthSummary } from "@/lib/health/stats";

/** Rows as the health screens use them. PostgREST returns numeric columns as strings, so everything is coerced here. */
export interface HealthDayRow extends DayStat {
  id: string;
  in_bed_min: number | null;
  sleep_consistency_pct: number | null;
  sleep_need_min: number | null;
  sleep_debt_min: number | null;
  energy_kcal: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  skin_temp_c: number | null;
  source: string;
}

export interface HealthSleepRow {
  id: string;
  start_at: string;
  end_at: string;
  day: string;
  nap: boolean;
  performance_pct: number | null;
  asleep_min: number | null;
  in_bed_min: number | null;
  light_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  efficiency_pct: number | null;
  resp_rate: number | null;
  source: string;
}

export interface HealthWorkoutRow {
  id: string;
  start_at: string;
  end_at: string;
  day: string;
  activity: string;
  strain: number | null;
  energy_kcal: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  zone1_pct: number | null;
  zone2_pct: number | null;
  zone3_pct: number | null;
  zone4_pct: number | null;
  zone5_pct: number | null;
  distance_m: number | null;
  source: string;
}

export interface HealthImportRow {
  id: string;
  filename: string;
  source: "whoop" | "noop";
  days: number;
  sleeps: number;
  workouts: number;
  journal: number;
  first_day: string | null;
  last_day: string | null;
  created_at: string;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

export function shapeDay(r: Record<string, unknown>): HealthDayRow {
  return {
    id: String(r.id),
    day: String(r.day),
    recovery: num(r.recovery),
    strain: num(r.strain),
    resting_hr: int(r.resting_hr),
    hrv_ms: num(r.hrv_ms),
    spo2_pct: num(r.spo2_pct),
    skin_temp_c: num(r.skin_temp_c),
    resp_rate: num(r.resp_rate),
    energy_kcal: num(r.energy_kcal),
    max_hr: int(r.max_hr),
    avg_hr: int(r.avg_hr),
    sleep_performance_pct: num(r.sleep_performance_pct),
    sleep_total_min: num(r.sleep_total_min),
    in_bed_min: num(r.in_bed_min),
    light_min: num(r.light_min),
    deep_min: num(r.deep_min),
    rem_min: num(r.rem_min),
    awake_min: num(r.awake_min),
    sleep_efficiency_pct: num(r.sleep_efficiency_pct),
    sleep_consistency_pct: num(r.sleep_consistency_pct),
    sleep_need_min: num(r.sleep_need_min),
    sleep_debt_min: num(r.sleep_debt_min),
    source: String(r.source ?? "whoop"),
  };
}

export function shapeSleep(r: Record<string, unknown>): HealthSleepRow {
  return {
    id: String(r.id),
    start_at: String(r.start_at),
    end_at: String(r.end_at),
    day: String(r.day),
    nap: Boolean(r.nap),
    performance_pct: num(r.performance_pct),
    asleep_min: num(r.asleep_min),
    in_bed_min: num(r.in_bed_min),
    light_min: num(r.light_min),
    deep_min: num(r.deep_min),
    rem_min: num(r.rem_min),
    awake_min: num(r.awake_min),
    efficiency_pct: num(r.efficiency_pct),
    resp_rate: num(r.resp_rate),
    source: String(r.source ?? "whoop"),
  };
}

export function shapeWorkout(r: Record<string, unknown>): HealthWorkoutRow {
  return {
    id: String(r.id),
    start_at: String(r.start_at),
    end_at: String(r.end_at),
    day: String(r.day),
    activity: String(r.activity),
    strain: num(r.strain),
    energy_kcal: num(r.energy_kcal),
    max_hr: int(r.max_hr),
    avg_hr: int(r.avg_hr),
    zone1_pct: num(r.zone1_pct),
    zone2_pct: num(r.zone2_pct),
    zone3_pct: num(r.zone3_pct),
    zone4_pct: num(r.zone4_pct),
    zone5_pct: num(r.zone5_pct),
    distance_m: num(r.distance_m),
    source: String(r.source ?? "whoop"),
  };
}

export function shapeImport(r: Record<string, unknown>): HealthImportRow {
  return {
    id: String(r.id),
    filename: String(r.filename),
    source: r.source === "noop" ? "noop" : "whoop",
    days: int(r.days) ?? 0,
    sleeps: int(r.sleeps) ?? 0,
    workouts: int(r.workouts) ?? 0,
    journal: int(r.journal) ?? 0,
    first_day: r.first_day ? String(r.first_day) : null,
    last_day: r.last_day ? String(r.last_day) : null,
    created_at: String(r.created_at),
  };
}

export interface HealthData {
  days: HealthDayRow[];
  sleeps: HealthSleepRow[];
  workouts: HealthWorkoutRow[];
  imports: HealthImportRow[];
  summary: HealthSummary;
  isEmpty: boolean;
  /** True when the health tables do not exist yet (migration 0011 has not been applied). */
  notReady: boolean;
}

/** PostgREST reports a missing relation as PGRST205; older versions only carry the message. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "PGRST205" || /could not find the table/i.test(error.message ?? "") || /relation .* does not exist/i.test(error.message ?? "");
}

/** Everything the health screens need for the last `windowDays` days, oldest first. */
export const getHealthData = cache(async (userId: string, today: string, windowDays = 90): Promise<HealthData> => {
  const supabase = await createClient();
  const from = new Date(Date.parse(today) - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const [days, sleeps, workouts, imports] = await Promise.all([
    supabase.from("health_days").select("*").eq("user_id", userId).gte("day", from).order("day", { ascending: true }),
    supabase.from("health_sleeps").select("*").eq("user_id", userId).gte("day", from).order("start_at", { ascending: true }),
    supabase.from("health_workouts").select("*").eq("user_id", userId).gte("day", from).order("start_at", { ascending: true }),
    supabase.from("health_imports").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
  ]);
  for (const r of [days, sleeps, workouts, imports]) {
    if (!r.error) continue;
    if (isMissingTable(r.error)) {
      return { days: [], sleeps: [], workouts: [], imports: [], summary: summarize([], today), isEmpty: true, notReady: true };
    }
    throw new Error(r.error.message);
  }
  const dayRows = ((days.data ?? []) as Record<string, unknown>[]).map(shapeDay);
  return {
    days: dayRows,
    sleeps: ((sleeps.data ?? []) as Record<string, unknown>[]).map(shapeSleep),
    workouts: ((workouts.data ?? []) as Record<string, unknown>[]).map(shapeWorkout),
    imports: ((imports.data ?? []) as Record<string, unknown>[]).map(shapeImport),
    summary: summarize(dayRows, today),
    isEmpty: dayRows.length === 0 && (imports.data ?? []).length === 0,
    notReady: false,
  };
});

/** A light read for the Today tile: the last 30 days only. */
export async function getHealthSummary(userId: string, today: string): Promise<HealthSummary | null> {
  const supabase = await createClient();
  const from = new Date(Date.parse(today) - 29 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("health_days").select("*").eq("user_id", userId).gte("day", from).order("day", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map(shapeDay);
  if (!rows.length) return null;
  return summarize(rows, today);
}
