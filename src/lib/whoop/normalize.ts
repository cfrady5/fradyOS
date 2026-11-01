import type { DailySummary, Provider } from "@/lib/intel/types";

/**
 * WHOOP developer API v2 records → partial DailySummary pieces. Pure, so the mapping is testable and
 * the raw record can always be compared with what was derived from it. Milliseconds become minutes,
 * kilojoules become kilocalories, and unscored or pending records mark the day as not scored.
 */
export type ScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE";

export interface WhoopCycle {
  id: number | string;
  start: string;
  end?: string | null;
  timezone_offset?: string;
  score_state?: ScoreState;
  score?: { strain?: number; kilojoule?: number; average_heart_rate?: number; max_heart_rate?: number } | null;
}

export interface WhoopRecovery {
  cycle_id: number | string;
  sleep_id?: number | string;
  score_state?: ScoreState;
  score?: { user_calibrating?: boolean; recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number; spo2_percentage?: number; skin_temp_celsius?: number } | null;
}

export interface WhoopSleep {
  id: number | string;
  start: string;
  end: string;
  timezone_offset?: string;
  nap?: boolean;
  score_state?: ScoreState;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_no_data_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
      sleep_cycle_count?: number;
      disturbance_count?: number;
    };
    sleep_needed?: { baseline_milli?: number; need_from_sleep_debt_milli?: number; need_from_recent_strain_milli?: number; need_from_recent_nap_milli?: number };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  } | null;
}

export interface WhoopWorkout {
  id: number | string;
  start: string;
  end: string;
  timezone_offset?: string;
  sport_name?: string;
  sport_id?: number;
  score_state?: ScoreState;
  score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number; kilojoule?: number; percent_recorded?: number; distance_meter?: number } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const minutes = (ms: unknown): number | null => (num(ms) == null ? null : Math.round((ms as number) / 60_000));
const kcal = (kj: unknown): number | null => (num(kj) == null ? null : Math.round((kj as number) / 4.184));

/** Local calendar day of an instant given WHOOP's "+HH:MM" offset, falling back to the timezone. */
export function localDay(iso: string, offset: string | undefined, timeZone: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const m = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset) : null;
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    const shift = sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
    return new Date(t + shift).toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/** Minutes since the previous local noon (continuous across midnight), using the record's offset. */
function minutesFromNoonWithOffset(iso: string, offset: string | undefined, timeZone: string): number {
  const t = Date.parse(iso);
  const m = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset) : null;
  let minutesOfDay: number;
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    const local = new Date(t + sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000);
    minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  } else {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
    minutesOfDay = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  }
  return minutesOfDay >= 720 ? minutesOfDay - 720 : minutesOfDay + 720;
}

export interface NormalizeInput {
  cycles: WhoopCycle[];
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  workouts: WhoopWorkout[];
  timezone: string;
}

/** One partial day per calendar day, ready for buildDailySummaries({ apiDays }). */
export function normalizeWhoop({ cycles, recoveries, sleeps, workouts, timezone }: NormalizeInput): Partial<DailySummary>[] {
  const days = new Map<string, Partial<DailySummary>>();
  const get = (day: string) => {
    let d = days.get(day);
    if (!d) {
      d = { day, provider: "whoop_api" as Provider, scored: true };
      days.set(day, d);
    }
    return d;
  };
  const cycleDay = new Map<string, string>();

  for (const c of cycles) {
    // Wake day: twelve hours after the cycle began (cycles start at sleep onset).
    const day = localDay(new Date(Date.parse(c.start) + 12 * 3_600_000).toISOString(), c.timezone_offset, timezone);
    cycleDay.set(String(c.id), day);
    const d = get(day);
    if (c.score_state && c.score_state !== "SCORED") {
      if (c.score_state === "UNSCORABLE") d.scored = false;
      continue;
    }
    d.day_strain = num(c.score?.strain);
    d.energy_kcal = kcal(c.score?.kilojoule);
    d.avg_hr = num(c.score?.average_heart_rate);
    d.max_hr = num(c.score?.max_heart_rate);
  }

  for (const r of recoveries) {
    const day = cycleDay.get(String(r.cycle_id));
    if (!day) continue;
    const d = get(day);
    if (r.score_state && r.score_state !== "SCORED") {
      if (r.score_state === "UNSCORABLE") d.scored = false;
      continue;
    }
    d.recovery_score = num(r.score?.recovery_score);
    d.resting_hr = num(r.score?.resting_heart_rate);
    d.hrv_rmssd = num(r.score?.hrv_rmssd_milli);
    d.spo2 = num(r.score?.spo2_percentage);
    d.skin_temp = num(r.score?.skin_temp_celsius);
  }

  // Main sleep per wake day is the longest non-nap; naps are summed.
  const mains = new Map<string, WhoopSleep>();
  for (const s of sleeps) {
    const day = localDay(s.end, s.timezone_offset, timezone);
    const d = get(day);
    const asleep = s.score?.stage_summary ? minutes((s.score.stage_summary.total_light_sleep_time_milli ?? 0) + (s.score.stage_summary.total_slow_wave_sleep_time_milli ?? 0) + (s.score.stage_summary.total_rem_sleep_time_milli ?? 0)) : null;
    if (s.nap) {
      d.nap_count = (d.nap_count ?? 0) + 1;
      if (asleep != null) d.nap_min = (d.nap_min ?? 0) + asleep;
      continue;
    }
    const prev = mains.get(day);
    const prevAsleep = prev ? minutes((prev.score?.stage_summary?.total_light_sleep_time_milli ?? 0) + (prev.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) + (prev.score?.stage_summary?.total_rem_sleep_time_milli ?? 0)) ?? 0 : -1;
    if (!prev || (asleep ?? 0) > prevAsleep) mains.set(day, s);
  }
  for (const [day, s] of mains) {
    const d = get(day);
    d.sleep_onset_min = minutesFromNoonWithOffset(s.start, s.timezone_offset, timezone);
    d.wake_min = minutesFromNoonWithOffset(s.end, s.timezone_offset, timezone);
    if (s.score_state && s.score_state !== "SCORED") {
      if (s.score_state === "UNSCORABLE") d.scored = false;
      continue;
    }
    const st = s.score?.stage_summary;
    if (st) {
      d.light_min = minutes(st.total_light_sleep_time_milli);
      d.deep_min = minutes(st.total_slow_wave_sleep_time_milli);
      d.rem_min = minutes(st.total_rem_sleep_time_milli);
      d.awake_min = minutes(st.total_awake_time_milli);
      d.in_bed_min = minutes(st.total_in_bed_time_milli);
      const total = [d.light_min, d.deep_min, d.rem_min].every((v) => v != null) ? d.light_min! + d.deep_min! + d.rem_min! : null;
      d.sleep_total_min = total;
      d.sleep_cycles = num(st.sleep_cycle_count);
      d.disturbances = num(st.disturbance_count);
    }
    const need = s.score?.sleep_needed;
    if (need) {
      const parts = [need.baseline_milli, need.need_from_sleep_debt_milli, need.need_from_recent_strain_milli, need.need_from_recent_nap_milli].map(num);
      if (parts.some((v) => v != null)) d.sleep_need_min = Math.round(parts.reduce((a, b) => a! + (b ?? 0), 0)! / 60_000);
      d.sleep_debt_min = minutes(need.need_from_sleep_debt_milli);
    }
    d.resp_rate = num(s.score?.respiratory_rate);
    d.sleep_performance = num(s.score?.sleep_performance_percentage);
    d.sleep_consistency = num(s.score?.sleep_consistency_percentage);
    d.sleep_efficiency = num(s.score?.sleep_efficiency_percentage);
  }

  const hr = new Map<string, { sum: number; w: number }>();
  for (const w of workouts) {
    if (w.score_state && w.score_state !== "SCORED") continue;
    const day = localDay(w.start, w.timezone_offset, timezone);
    const d = get(day);
    const mins = Math.max(0, (Date.parse(w.end) - Date.parse(w.start)) / 60_000);
    d.workout_count = (d.workout_count ?? 0) + 1;
    d.workout_min = Math.round((d.workout_min ?? 0) + mins);
    if (num(w.score?.strain) != null) d.workout_strain = Math.round(((d.workout_strain ?? 0) + w.score!.strain!) * 10) / 10;
    if (kcal(w.score?.kilojoule) != null) d.workout_kcal = (d.workout_kcal ?? 0) + kcal(w.score!.kilojoule)!;
    if (num(w.score?.max_heart_rate) != null) d.workout_max_hr = Math.max(d.workout_max_hr ?? 0, w.score!.max_heart_rate!);
    if (num(w.score?.average_heart_rate) != null && mins > 0) {
      const acc = hr.get(day) ?? { sum: 0, w: 0 };
      acc.sum += w.score!.average_heart_rate! * mins;
      acc.w += mins;
      hr.set(day, acc);
    }
  }
  for (const [day, acc] of hr) if (acc.w > 0) get(day).workout_avg_hr = Math.round(acc.sum / acc.w);

  return [...days.values()].sort((a, b) => (a.day! < b.day! ? -1 : 1));
}
