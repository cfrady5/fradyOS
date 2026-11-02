import type { HealthDayRow, HealthSleepRow, HealthWorkoutRow } from "@/lib/data/health";
import { CORE_METRICS, emptySummary, type DailySummary, type MetricKey, type Provider } from "./types";
import { round, valid } from "./stats";

/** Minutes of the local day (0..1439) and the local date for an instant in a timezone. */
export function localParts(iso: string, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Minutes since the previous local noon, so bedtimes around midnight form one continuous scale. */
export function minutesFromNoon(iso: string, timeZone: string): number {
  const { minutes } = localParts(iso, timeZone);
  return minutes >= 720 ? minutes - 720 : minutes + 720;
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface SummaryInputs {
  days: HealthDayRow[];
  sleeps: HealthSleepRow[];
  workouts: HealthWorkoutRow[];
  /** Partial days derived from strap samples (provider "ble"); their fields win over export fields. */
  derivedDays?: Partial<DailySummary>[];
  timezone: string;
}

function providerOf(source: string): Provider {
  if (/ble|strap/i.test(source)) return "ble";
  return /noop/i.test(source) ? "noop_export" : "whoop_export";
}

/**
 * Builds one DailySummary per calendar day that has any data, ascending. Export rows fill the day;
 * sleeps add timing and naps; workouts are aggregated; API days override field by field.
 */
export function buildDailySummaries({ days, sleeps, workouts, derivedDays = [], timezone }: SummaryInputs): DailySummary[] {
  const map = new Map<string, DailySummary>();
  const get = (day: string) => {
    let s = map.get(day);
    if (!s) {
      s = emptySummary(day);
      map.set(day, s);
    }
    return s;
  };

  for (const d of days) {
    const s = get(d.day);
    s.provider = providerOf(d.source);
    s.recovery_score = num(d.recovery);
    s.day_strain = num(d.strain);
    s.resting_hr = num(d.resting_hr);
    s.hrv_rmssd = num(d.hrv_ms);
    s.spo2 = num(d.spo2_pct);
    s.skin_temp = num(d.skin_temp_c);
    s.resp_rate = num(d.resp_rate);
    s.energy_kcal = num(d.energy_kcal);
    s.max_hr = num(d.max_hr);
    s.avg_hr = num(d.avg_hr);
    s.sleep_performance = num(d.sleep_performance_pct);
    s.sleep_total_min = num(d.sleep_total_min);
    s.in_bed_min = num(d.in_bed_min);
    s.light_min = num(d.light_min);
    s.deep_min = num(d.deep_min);
    s.rem_min = num(d.rem_min);
    s.awake_min = num(d.awake_min);
    s.sleep_efficiency = num(d.sleep_efficiency_pct);
    s.sleep_consistency = num(d.sleep_consistency_pct);
    s.sleep_need_min = num(d.sleep_need_min);
    s.sleep_debt_min = num(d.sleep_debt_min);
  }

  // Main sleep per day: the longest non-nap sleep. Naps are summed.
  const mains = new Map<string, HealthSleepRow>();
  for (const sl of sleeps) {
    const s = get(sl.day);
    if (sl.nap) {
      s.nap_count = (s.nap_count ?? 0) + 1;
      s.nap_min = (s.nap_min ?? 0) + (num(sl.asleep_min) ?? 0);
      continue;
    }
    const prev = mains.get(sl.day);
    if (!prev || (num(sl.asleep_min) ?? 0) > (num(prev.asleep_min) ?? 0)) mains.set(sl.day, sl);
  }
  for (const [day, sl] of mains) {
    const s = get(day);
    s.sleep_onset_min = minutesFromNoon(sl.start_at, timezone);
    s.wake_min = minutesFromNoon(sl.end_at, timezone);
    if (s.sleep_total_min == null) s.sleep_total_min = num(sl.asleep_min);
    if (s.in_bed_min == null) s.in_bed_min = num(sl.in_bed_min);
    if (s.light_min == null) s.light_min = num(sl.light_min);
    if (s.deep_min == null) s.deep_min = num(sl.deep_min);
    if (s.rem_min == null) s.rem_min = num(sl.rem_min);
    if (s.awake_min == null) s.awake_min = num(sl.awake_min);
    if (s.sleep_efficiency == null) s.sleep_efficiency = num(sl.efficiency_pct);
    if (s.sleep_performance == null) s.sleep_performance = num(sl.performance_pct);
  }

  // Workouts aggregated per day; average HR weighted by duration.
  const hrWeight = new Map<string, { sum: number; w: number }>();
  for (const w of workouts) {
    const s = get(w.day);
    const mins = Math.max(0, (Date.parse(w.end_at) - Date.parse(w.start_at)) / 60_000);
    s.workout_count = (s.workout_count ?? 0) + 1;
    s.workout_min = (s.workout_min ?? 0) + mins;
    if (num(w.strain) != null) s.workout_strain = (s.workout_strain ?? 0) + w.strain!;
    if (num(w.energy_kcal) != null) s.workout_kcal = (s.workout_kcal ?? 0) + w.energy_kcal!;
    if (num(w.max_hr) != null) s.workout_max_hr = Math.max(s.workout_max_hr ?? 0, w.max_hr!);
    if (num(w.avg_hr) != null && mins > 0) {
      const acc = hrWeight.get(w.day) ?? { sum: 0, w: 0 };
      acc.sum += w.avg_hr! * mins;
      acc.w += mins;
      hrWeight.set(w.day, acc);
    }
  }
  for (const [day, acc] of hrWeight) if (acc.w > 0) get(day).workout_avg_hr = round(acc.sum / acc.w, 0);

  for (const api of derivedDays) {
    if (!api.day) continue;
    const s = get(api.day);
    for (const [k, v] of Object.entries(api)) {
      if (k === "day") continue;
      if (k === "provider" || k === "scored") {
        (s as unknown as Record<string, unknown>)[k] = v;
        continue;
      }
      if (typeof v === "number" && Number.isFinite(v)) (s as unknown as Record<string, number | null>)[k] = v;
    }
    s.provider = (api.provider as Provider) ?? "ble";
  }

  const out = [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  for (const s of out) {
    s.workout_count ??= 0;
    s.completeness = valid(CORE_METRICS.map((k) => s[k])).length / CORE_METRICS.length;
  }
  return out;
}

/** Fills calendar gaps with empty, unscored days so index-based windows mean calendar windows. */
export function fillCalendar(summaries: DailySummary[], throughDay: string, maxDays = 180): DailySummary[] {
  if (!summaries.length) return [];
  const byDay = new Map(summaries.map((s) => [s.day, s]));
  const end = Date.parse(`${throughDay}T00:00:00Z`);
  const start = Math.max(Date.parse(`${summaries[0].day}T00:00:00Z`), end - (maxDays - 1) * 86_400_000);
  const out: DailySummary[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const s = byDay.get(day);
    out.push(s ?? { ...emptySummary(day), scored: false, workout_count: 0 });
  }
  return out;
}

export type { MetricKey };
