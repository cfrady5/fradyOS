/**
 * Assembles one Partial<DailySummary> per wake day from a minute series, with provider "ble".
 *
 * Row conventions follow src/lib/intel/types.ts: sleep fields on row t describe the night that ended the
 * morning of t; strain, workouts and naps on row t are that local calendar day. A day with fewer than
 * 300 minutes of skin contact is marked scored: false. Nothing substitutes a zero for a missing reading:
 * fields stay null, and days with no data at all produce no row.
 */
import { CORE_METRICS, type DailySummary } from "@/lib/intel/types";
import { median, valid } from "@/lib/intel/stats";
import { overnightHrv, respiratoryRate, restingHr, skinTempEstimate, spo2Estimate } from "./cardio";
import { detectSleep, METHOD_NOTE, type SleepOptions } from "./sleep";
import { dayStrain, detectWorkouts } from "./strain";
import { dayRange, hasContact, localClock, normaliseMinutes } from "./time";
import type { DerivedWorkout, SleepEpisode, StrapMinute, StrapProfile } from "./types";

export const MIN_SCORED_CONTACT_MINUTES = 300;
export const DERIVE_VERSION = "strap-derive 2026.11.1";

export interface DeriveRange {
  /** First wake day (YYYY-MM-DD, inclusive). */
  from: string;
  /** Last wake day (inclusive). */
  to: string;
}

export interface DeriveResult {
  days: Partial<DailySummary>[];
  episodes: SleepEpisode[];
  workouts: DerivedWorkout[];
  notes: string[];
  /** Share of each day (0..1) that had skin contact. */
  coverage: Record<string, number>;
}

export interface DeriveOptions extends SleepOptions {
  /** Minimum days with an onset before sleep consistency is reported. Default 4. */
  consistencyMinDays?: number;
}

/** 100 - min(100, |onset deviation from the trailing 7-day median| / 1.2), as a share of the day. */
function sleepConsistency(onsets: (number | null)[], minDays: number): number | null {
  const window = valid(onsets.slice(-7));
  if (window.length < minDays) return null;
  const today = onsets[onsets.length - 1];
  if (today == null) return null;
  const med = median(window)!;
  return Math.round(100 - Math.min(100, Math.abs(today - med) / 1.2));
}

export function deriveDays(minutes: StrapMinute[], profile: StrapProfile, range: DeriveRange, opts: DeriveOptions = {}): DeriveResult {
  const timeZone = profile.timezone || "UTC";
  const rows = normaliseMinutes(minutes);
  const notes: string[] = [METHOD_NOTE, `Strain is FRADY strain (Banister TRIMP mapped to 0..21), not WHOOP's Strain. ${DERIVE_VERSION}.`];
  const coverage: Record<string, number> = {};
  if (!rows.length) return { days: [], episodes: [], workouts: [], notes: [...notes, "No minutes supplied."], coverage };

  const byDay = new Map<string, StrapMinute[]>();
  for (const m of rows) {
    const day = localClock(Date.parse(m.minute), timeZone).day;
    const g = byDay.get(day);
    if (g) g.push(m);
    else byDay.set(day, [m]);
  }

  const allEpisodes = detectSleep(rows, profile, { dayStartHour: opts.dayStartHour });
  const days = dayRange(range.from, range.to);
  const daySet = new Set(days);
  const episodes = allEpisodes.filter((e) => daySet.has(e.day));
  const workouts: DerivedWorkout[] = [];
  const out: Partial<DailySummary>[] = [];
  const onsets: (number | null)[] = [];
  let lastRhr: number | null = null;

  const spo2 = spo2Estimate(rows);
  const temp = skinTempEstimate(rows);
  notes.push(`SpO2: ${spo2.reason}`, `Skin temperature: ${temp.reason}`);

  for (const day of days) {
    const dayMinutes = byDay.get(day) ?? [];
    const mains = allEpisodes.filter((e) => e.kind === "main" && e.day === day);
    const main = mains.length ? mains.reduce((a, b) => (b.minutesAsleep > a.minutesAsleep ? b : a)) : null;
    const naps = allEpisodes.filter((e) => e.kind === "nap" && e.day === day);
    const fragments = allEpisodes.filter((e) => e.kind === "fragment" && e.day === day);
    if (!dayMinutes.length && !main && !naps.length) {
      onsets.push(null);
      continue;
    }

    const contactMinutes = dayMinutes.filter(hasContact).length;
    coverage[day] = Math.round((contactMinutes / 1440) * 1000) / 1000;

    const rhr = main ? restingHr(main, rows) : null;
    const hrv = main ? overnightHrv(main, rows) : null;
    const resp = main ? respiratoryRate(main, rows) : null;
    if (rhr != null) lastRhr = rhr;
    const rhrForLoad = rhr ?? lastRhr;

    const strain = dayStrain(dayMinutes, profile, rhrForLoad);
    const dayWorkouts = detectWorkouts(dayMinutes, profile, rhrForLoad);
    workouts.push(...dayWorkouts);

    onsets.push(main ? main.onsetMin : null);
    const consistency = main ? sleepConsistency(onsets, opts.consistencyMinDays ?? 4) : null;

    const row: Partial<DailySummary> = {
      day,
      provider: "ble",
      scored: contactMinutes >= MIN_SCORED_CONTACT_MINUTES,
      recovery_score: null,
      resting_hr: rhr,
      hrv_rmssd: hrv,
      resp_rate: resp,
      spo2: null,
      skin_temp: null,
      day_strain: strain.strain,
      avg_hr: strain.avgHr,
      max_hr: strain.maxHr,
      energy_kcal: null,
      steps: null,
      sleep_total_min: main ? main.minutesAsleep : null,
      in_bed_min: main ? main.minutesAsleep + main.minutesAwake : null,
      awake_min: main ? main.awake : null,
      light_min: main ? main.light : null,
      deep_min: main ? main.deep : null,
      rem_min: main ? main.rem : null,
      sleep_cycles: null,
      disturbances: main ? main.disturbances : null,
      sleep_efficiency: main ? main.efficiency : null,
      sleep_performance: null,
      sleep_consistency: consistency,
      sleep_need_min: null,
      sleep_debt_min: null,
      sleep_onset_min: main ? main.onsetMin : null,
      wake_min: main ? main.wakeMin : null,
      nap_count: naps.length,
      nap_min: naps.length ? naps.reduce((a, e) => a + e.minutesAsleep, 0) : null,
      workout_count: dayWorkouts.length,
      workout_min: dayWorkouts.length ? dayWorkouts.reduce((a, w) => a + w.durationMin, 0) : null,
      workout_strain: dayWorkouts.length ? Math.round(dayWorkouts.reduce((a, w) => a + w.strain, 0) * 10) / 10 : null,
      workout_avg_hr: dayWorkouts.length ? Math.round(dayWorkouts.reduce((a, w) => a + w.avgHr * w.durationMin, 0) / dayWorkouts.reduce((a, w) => a + w.durationMin, 0)) : null,
      workout_max_hr: dayWorkouts.length ? Math.max(...dayWorkouts.map((w) => w.maxHr)) : null,
      workout_kcal: null,
    };
    row.completeness = valid(CORE_METRICS.map((k) => row[k] ?? null)).length / CORE_METRICS.length;
    out.push(row);

    const bits = [`${day}: contact ${Math.round(coverage[day] * 100)}%`];
    if (main) bits.push(`main sleep ${main.minutesAsleep} min asleep (confidence ${main.confidence})`);
    if (fragments.length) bits.push(`${fragments.length} night fragment(s) not counted in totals`);
    if (strain.rhrSource === "profile") bits.push("strain used the profile resting-heart-rate hint");
    if (strain.rhrSource === "none" && contactMinutes) bits.push("strain not computed: no resting or maximum heart rate");
    if (!row.scored) bits.push("unscored: under 5 h of contact");
    notes.push(bits.join("; "));
  }

  return { days: out, episodes, workouts, notes, coverage };
}
