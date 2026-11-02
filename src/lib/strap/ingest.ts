import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveDays } from "./derive/daily";
import type { StrapMinute, StrapProfile } from "./derive/types";
import { runHealthIntelligence } from "@/lib/intel/pipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

const CHUNK = 500;

export function minuteRow(userId: string, m: StrapMinute) {
  return {
    user_id: userId,
    minute: m.minute,
    hr_avg: m.hrAvg,
    hr_min: m.hrMin,
    hr_max: m.hrMax,
    rr: m.rr.slice(0, 200),
    motion: m.motion,
    skin_contact: m.skinContact,
    raw_skin_temp: m.rawSkinTemp,
    raw_spo2: m.rawSpo2,
    raw_resp: m.rawResp,
    samples: m.samples,
  };
}

/**
 * Stores minutes, keeping the richer row when a minute already exists: a row with motion (from the
 * strap's recorder) beats a live heart-rate-only row, otherwise more samples win, and a tie goes to
 * the incoming row. Live streaming and recorder pulls therefore never degrade each other.
 */
export async function upsertMinutes(client: Client, userId: string, minutes: StrapMinute[]) {
  for (let i = 0; i < minutes.length; i += CHUNK) {
    const batch = minutes.slice(i, i + CHUNK);
    const keys = batch.map((m) => m.minute);
    const { data: existingRows, error: readError } = await client.from("strap_minutes").select("minute,motion,samples").eq("user_id", userId).in("minute", keys);
    if (readError) throw new Error(readError.message);
    const existing = new Map(((existingRows ?? []) as { minute: string; motion: number | null; samples: number }[]).map((r) => [new Date(r.minute).toISOString(), r]));
    const rows = batch
      .filter((m) => {
        const prev = existing.get(m.minute);
        if (!prev) return true;
        const prevRich = prev.motion != null;
        const nextRich = m.motion != null;
        if (prevRich !== nextRich) return nextRich;
        return m.samples >= (prev.samples ?? 0);
      })
      .map((m) => minuteRow(userId, m));
    if (!rows.length) continue;
    const { error } = await client.from("strap_minutes").upsert(rows, { onConflict: "user_id,minute" });
    if (error) throw new Error(error.message);
  }
}

function fromRow(r: Record<string, unknown>): StrapMinute {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    minute: new Date(String(r.minute)).toISOString(),
    hrAvg: n(r.hr_avg),
    hrMin: n(r.hr_min),
    hrMax: n(r.hr_max),
    rr: Array.isArray(r.rr) ? (r.rr as number[]) : [],
    motion: n(r.motion),
    skinContact: n(r.skin_contact),
    rawSkinTemp: n(r.raw_skin_temp),
    rawSpo2: (r.raw_spo2 as { red: number; ir: number } | null) ?? null,
    rawResp: n(r.raw_resp),
    samples: Number(r.samples ?? 0),
  };
}

/**
 * Re-derives the health rows for a window of days from stored minutes and recomputes the
 * intelligence layer. Runs after every offload; idempotent because every write is an upsert.
 */
export async function deriveAndStore(client: Client, userId: string, opts: { fromDay: string; toDay: string; today: string; timezone: string; maxHr: number | null }) {
  // One extra day either side so a night that straddles the window edge is complete.
  const from = new Date(Date.parse(`${opts.fromDay}T00:00:00Z`) - 36 * 3_600_000).toISOString();
  const to = new Date(Date.parse(`${opts.toDay}T00:00:00Z`) + 48 * 3_600_000).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await client.from("strap_minutes").select("*").eq("user_id", userId).gte("minute", from).lt("minute", to).order("minute", { ascending: true }).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  const minutes = rows.map(fromRow);
  const profile: StrapProfile = { timezone: opts.timezone, maxHr: opts.maxHr };
  const derived = deriveDays(minutes, profile, { from: opts.fromDay, to: opts.toDay });

  const dayRows = derived.days
    .filter((d) => d.day)
    .map((d) => ({
      user_id: userId,
      day: d.day,
      recovery: null,
      strain: d.day_strain ?? null,
      resting_hr: d.resting_hr ?? null,
      hrv_ms: d.hrv_rmssd ?? null,
      spo2_pct: null,
      skin_temp_c: null,
      resp_rate: d.resp_rate ?? null,
      energy_kcal: null,
      max_hr: d.max_hr ?? null,
      avg_hr: d.avg_hr ?? null,
      sleep_performance_pct: null,
      sleep_total_min: d.sleep_total_min ?? null,
      in_bed_min: d.in_bed_min ?? null,
      light_min: d.light_min ?? null,
      deep_min: d.deep_min ?? null,
      rem_min: d.rem_min ?? null,
      awake_min: d.awake_min ?? null,
      sleep_efficiency_pct: d.sleep_efficiency ?? null,
      sleep_consistency_pct: d.sleep_consistency ?? null,
      sleep_need_min: null,
      sleep_debt_min: null,
      source: d.scored === false ? "ble (partial)" : "ble",
    }));
  if (dayRows.length) {
    const { error } = await client.from("health_days").upsert(dayRows, { onConflict: "user_id,day" });
    if (error) throw new Error(error.message);
  }
  const sleepRows = derived.episodes.map((e) => ({
    user_id: userId,
    start_at: e.start,
    end_at: e.end,
    day: e.day,
    nap: e.kind === "nap",
    performance_pct: null,
    resp_rate: null,
    asleep_min: e.minutesAsleep,
    in_bed_min: e.minutesAsleep + e.minutesAwake,
    light_min: e.light,
    deep_min: e.deep,
    rem_min: e.rem,
    awake_min: e.awake,
    efficiency_pct: e.efficiency != null ? Math.round(e.efficiency * 10) / 10 : null,
    consistency_pct: null,
    need_min: null,
    debt_min: null,
    source: "ble",
  }));
  if (sleepRows.length) {
    const { error } = await client.from("health_sleeps").upsert(sleepRows, { onConflict: "user_id,start_at" });
    if (error) throw new Error(error.message);
  }
  const workoutRows = derived.workouts.map((w) => ({
    user_id: userId,
    start_at: w.start,
    end_at: w.end,
    day: w.day,
    activity: "Activity",
    strain: Math.round(w.strain * 10) / 10,
    energy_kcal: null,
    max_hr: w.maxHr,
    avg_hr: w.avgHr,
    zone1_pct: Math.round(w.zoneShares[0] * 1000) / 10,
    zone2_pct: Math.round(w.zoneShares[1] * 1000) / 10,
    zone3_pct: Math.round(w.zoneShares[2] * 1000) / 10,
    zone4_pct: Math.round(w.zoneShares[3] * 1000) / 10,
    zone5_pct: Math.round(w.zoneShares[4] * 1000) / 10,
    distance_m: null,
    source: "ble",
  }));
  if (workoutRows.length) {
    const { error } = await client.from("health_workouts").upsert(workoutRows, { onConflict: "user_id,start_at,activity" });
    if (error) throw new Error(error.message);
  }
  const intel = await runHealthIntelligence(client, userId, { kind: "strap", today: opts.today, timezone: opts.timezone });
  return { days: dayRows.length, sleeps: sleepRows.length, workouts: workoutRows.length, notes: derived.notes, intel: intel.ok ? intel.stats : null };
}
