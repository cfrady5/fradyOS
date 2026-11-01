import { bool, num, parseCsv } from "./csv";
import { localDay, toInstant, wakeDay } from "./whoopTime";
import { readZip } from "./zip";

/**
 * Parses a WHOOP data export (or NOOP's CSV export, which uses the same layout): a zip or the loose
 * files physiological_cycles.csv, sleeps.csv, workouts.csv and journal_entries.csv. Produces rows
 * ready for the health tables. Unknown columns are ignored; missing ones become null.
 */
export interface HealthDay {
  day: string;
  recovery: number | null;
  strain: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  spo2_pct: number | null;
  skin_temp_c: number | null;
  resp_rate: number | null;
  energy_kcal: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  sleep_performance_pct: number | null;
  sleep_total_min: number | null;
  in_bed_min: number | null;
  light_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  sleep_efficiency_pct: number | null;
  sleep_consistency_pct: number | null;
  sleep_need_min: number | null;
  sleep_debt_min: number | null;
  source: string;
}

export interface HealthSleep {
  start_at: string;
  end_at: string;
  day: string;
  nap: boolean;
  performance_pct: number | null;
  resp_rate: number | null;
  asleep_min: number | null;
  in_bed_min: number | null;
  light_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  efficiency_pct: number | null;
  consistency_pct: number | null;
  need_min: number | null;
  debt_min: number | null;
  source: string;
}

export interface HealthWorkout {
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

export interface HealthJournal {
  day: string;
  question: string;
  answered_yes: boolean;
  notes: string | null;
}

export interface WhoopImportResult {
  days: HealthDay[];
  sleeps: HealthSleep[];
  workouts: HealthWorkout[];
  journal: HealthJournal[];
  /** Which files were recognised, for the summary. */
  files: string[];
  /** "whoop" for a WHOOP export, "noop" when NOOP's Source column is present. */
  source: "whoop" | "noop";
}

const FILE_KINDS: [RegExp, "cycles" | "sleeps" | "workouts" | "journal"][] = [
  [/physiological_cycles/i, "cycles"],
  [/sleeps?\.csv$/i, "sleeps"],
  [/workouts?\.csv$/i, "workouts"],
  [/journal/i, "journal"],
];

export function kindOfFile(name: string): "cycles" | "sleeps" | "workouts" | "journal" | null {
  const base = name.split("/").pop() ?? name;
  for (const [re, kind] of FILE_KINDS) if (re.test(base)) return kind;
  return null;
}

/** Expand zips into their CSV entries; pass CSVs through. */
export function expandFiles(files: { name: string; data: Buffer }[]): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    const isZip = /\.zip$/i.test(f.name) || (f.data.length > 4 && f.data.readUInt32LE(0) === 0x04034b50);
    if (isZip) {
      for (const e of readZip(f.data)) if (/\.csv$/i.test(e.name)) out.push(e);
    } else if (/\.csv$/i.test(f.name)) out.push(f);
  }
  return out;
}

export function parseWhoopExport(files: { name: string; data: Buffer }[]): WhoopImportResult {
  const csvs = expandFiles(files);
  const result: WhoopImportResult = { days: [], sleeps: [], workouts: [], journal: [], files: [], source: "whoop" };
  const seenDays = new Set<string>();
  const seenSleeps = new Set<string>();
  const seenWorkouts = new Set<string>();
  for (const f of csvs) {
    const kind = kindOfFile(f.name);
    if (!kind) continue;
    const table = parseCsv(f.data.toString("utf8"));
    if (table.rows.length === 0 && table.headers.length === 0) continue;
    result.files.push(f.name.split("/").pop() ?? f.name);
    if (table.headers.includes("source")) result.source = "noop";
    for (const r of table.rows) {
      const src = r.source || (result.source === "noop" ? "noop" : "whoop");
      if (kind === "cycles") {
        const day = wakeDay(r.cycle_start_time);
        if (!day || seenDays.has(day)) continue;
        seenDays.add(day);
        result.days.push({
          day,
          recovery: num(r.recovery_score_pct),
          strain: num(r.day_strain),
          resting_hr: num(r.resting_heart_rate_bpm),
          hrv_ms: num(r.heart_rate_variability_ms),
          spo2_pct: num(r.blood_oxygen_pct),
          skin_temp_c: num(r.skin_temp_celsius),
          resp_rate: num(r.respiratory_rate_rpm),
          energy_kcal: num(r.energy_burned_cal),
          max_hr: num(r.max_hr_bpm),
          avg_hr: num(r.average_hr_bpm),
          sleep_performance_pct: num(r.sleep_performance_pct),
          sleep_total_min: num(r.asleep_duration_min),
          in_bed_min: num(r.in_bed_duration_min),
          light_min: num(r.light_sleep_duration_min),
          deep_min: num(r.deep_sws_duration_min),
          rem_min: num(r.rem_duration_min),
          awake_min: num(r.awake_duration_min),
          sleep_efficiency_pct: num(r.sleep_efficiency_pct),
          sleep_consistency_pct: num(r.sleep_consistency_pct),
          sleep_need_min: num(r.sleep_need_min),
          sleep_debt_min: num(r.sleep_debt_min),
          source: src,
        });
      } else if (kind === "sleeps") {
        const start = toInstant(r.sleep_onset, r.cycle_timezone);
        const end = toInstant(r.wake_onset, r.cycle_timezone);
        const day = localDay(r.wake_onset) ?? wakeDay(r.cycle_start_time);
        if (!start || !end || !day || seenSleeps.has(start)) continue;
        seenSleeps.add(start);
        result.sleeps.push({
          start_at: start,
          end_at: end,
          day,
          nap: bool(r.nap) ?? false,
          performance_pct: num(r.sleep_performance_pct),
          resp_rate: num(r.respiratory_rate_rpm),
          asleep_min: num(r.asleep_duration_min),
          in_bed_min: num(r.in_bed_duration_min),
          light_min: num(r.light_sleep_duration_min),
          deep_min: num(r.deep_sws_duration_min),
          rem_min: num(r.rem_duration_min),
          awake_min: num(r.awake_duration_min),
          efficiency_pct: num(r.sleep_efficiency_pct),
          consistency_pct: num(r.sleep_consistency_pct),
          need_min: num(r.sleep_need_min),
          debt_min: num(r.sleep_debt_min),
          source: src,
        });
      } else if (kind === "workouts") {
        const start = toInstant(r.workout_start_time, r.cycle_timezone);
        const end = toInstant(r.workout_end_time, r.cycle_timezone);
        const day = localDay(r.workout_start_time) ?? wakeDay(r.cycle_start_time);
        const activity = (r.activity_name || "Activity").trim();
        const key = `${start}|${activity}`;
        if (!start || !end || !day || seenWorkouts.has(key)) continue;
        seenWorkouts.add(key);
        result.workouts.push({
          start_at: start,
          end_at: end,
          day,
          activity,
          strain: num(r.activity_strain),
          energy_kcal: num(r.energy_burned_cal),
          max_hr: num(r.max_hr_bpm),
          avg_hr: num(r.average_hr_bpm),
          zone1_pct: num(r.hr_zone_1_pct),
          zone2_pct: num(r.hr_zone_2_pct),
          zone3_pct: num(r.hr_zone_3_pct),
          zone4_pct: num(r.hr_zone_4_pct),
          zone5_pct: num(r.hr_zone_5_pct),
          distance_m: num(r.distance_meters),
          source: src,
        });
      } else if (kind === "journal") {
        const day = wakeDay(r.cycle_start_time);
        const question = (r.question_text ?? "").trim();
        if (!day || !question) continue;
        result.journal.push({ day, question, answered_yes: bool(r.answered_yes_no) ?? false, notes: r.notes?.trim() || null });
      }
    }
  }
  result.days.sort((a, b) => a.day.localeCompare(b.day));
  result.sleeps.sort((a, b) => a.start_at.localeCompare(b.start_at));
  result.workouts.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return result;
}
