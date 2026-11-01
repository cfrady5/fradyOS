import { describe, expect, it } from "vitest";
import { buildDailySummaries, fillCalendar, minutesFromNoon } from "../summaries";
import { computeBaseline } from "../baselines";
import type { HealthDayRow, HealthSleepRow, HealthWorkoutRow } from "@/lib/data/health";

const TZ = "America/Indiana/Indianapolis";

function day(d: string, extra: Partial<HealthDayRow> = {}): HealthDayRow {
  return {
    id: d, day: d, recovery: 60, strain: 10, resting_hr: 52, hrv_ms: 70, spo2_pct: 96, skin_temp_c: 33.2, resp_rate: 14.5, energy_kcal: 2200,
    max_hr: 150, avg_hr: 70, sleep_performance_pct: 85, sleep_total_min: 420, in_bed_min: 460, light_min: 200, deep_min: 100, rem_min: 120,
    awake_min: 40, sleep_efficiency_pct: 90, sleep_consistency_pct: 75, sleep_need_min: 480, sleep_debt_min: 60, source: "whoop", ...extra,
  };
}

describe("buildDailySummaries", () => {
  it("merges days, main sleep timing, naps and workouts without inventing values", () => {
    const sleeps: HealthSleepRow[] = [
      { id: "s1", start_at: "2026-10-30T03:10:00Z", end_at: "2026-10-30T10:30:00Z", day: "2026-10-30", nap: false, performance_pct: 85, asleep_min: 420, in_bed_min: 460, light_min: 200, deep_min: 100, rem_min: 120, awake_min: 40, efficiency_pct: 90, resp_rate: 14.5, source: "whoop" },
      { id: "s2", start_at: "2026-10-30T18:00:00Z", end_at: "2026-10-30T18:30:00Z", day: "2026-10-30", nap: true, performance_pct: null, asleep_min: 28, in_bed_min: 30, light_min: null, deep_min: null, rem_min: null, awake_min: null, efficiency_pct: null, resp_rate: null, source: "whoop" },
    ];
    const workouts: HealthWorkoutRow[] = [
      { id: "w1", start_at: "2026-10-30T12:00:00Z", end_at: "2026-10-30T13:00:00Z", day: "2026-10-30", activity: "Running", strain: 12, energy_kcal: 600, max_hr: 180, avg_hr: 150, zone1_pct: null, zone2_pct: null, zone3_pct: null, zone4_pct: null, zone5_pct: null, distance_m: null, source: "whoop" },
      { id: "w2", start_at: "2026-10-30T20:00:00Z", end_at: "2026-10-30T20:30:00Z", day: "2026-10-30", activity: "Walking", strain: 4, energy_kcal: 150, max_hr: 120, avg_hr: 100, zone1_pct: null, zone2_pct: null, zone3_pct: null, zone4_pct: null, zone5_pct: null, distance_m: null, source: "whoop" },
    ];
    const out = buildDailySummaries({ days: [day("2026-10-30"), day("2026-10-31", { recovery: null, hrv_ms: null })], sleeps, workouts, timezone: TZ });
    expect(out.map((d) => d.day)).toEqual(["2026-10-30", "2026-10-31"]);
    const d0 = out[0];
    expect(d0.provider).toBe("whoop_export");
    expect(d0.sleep_onset_min).toBe(minutesFromNoon("2026-10-30T03:10:00Z", TZ)); // 11:10 PM local the night before
    expect(d0.sleep_onset_min).toBe(670);
    expect(d0.wake_min).toBe(1110); // 6:30 AM
    expect(d0.nap_count).toBe(1);
    expect(d0.nap_min).toBe(28);
    expect(d0.workout_count).toBe(2);
    expect(d0.workout_min).toBe(90);
    expect(d0.workout_strain).toBe(16);
    expect(d0.workout_avg_hr).toBe(133); // duration weighted
    expect(d0.workout_max_hr).toBe(180);
    expect(d0.completeness).toBe(1);
    expect(out[1].recovery_score).toBeNull();
    expect(out[1].hrv_rmssd).toBeNull();
    expect(out[1].completeness).toBeCloseTo(4 / 6);
    expect(out[1].workout_count).toBe(0);
  });

  it("lets API days override export fields", () => {
    const out = buildDailySummaries({ days: [day("2026-10-30")], sleeps: [], workouts: [], apiDays: [{ day: "2026-10-30", resting_hr: 49, sleep_cycles: 5, scored: true }], timezone: TZ });
    expect(out[0].resting_hr).toBe(49);
    expect(out[0].sleep_cycles).toBe(5);
    expect(out[0].provider).toBe("whoop_api");
  });

  it("fills calendar gaps with unscored days and caps the window", () => {
    const out = fillCalendar(buildDailySummaries({ days: [day("2026-10-01"), day("2026-10-05")], sleeps: [], workouts: [], timezone: TZ }), "2026-10-06");
    expect(out.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(out[1].scored).toBe(false);
    expect(fillCalendar(out, "2026-10-06", 3).length).toBe(3);
  });
});

describe("computeBaseline", () => {
  it("uses scored days only and reports readiness by sample count", () => {
    const rows = Array.from({ length: 20 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, { resting_hr: 50 + (i % 3) }));
    const days = buildDailySummaries({ days: rows, sleeps: [], workouts: [], timezone: TZ });
    const b = computeBaseline(days, "resting_hr");
    expect(b.n).toBe(20);
    expect(b.ready).toBe(true);
    expect(b.median90).toBe(51);
    expect(b.last).toBe(51);
    expect(b.mean7).toBeCloseTo(51, 0);
    const short = computeBaseline(days.slice(0, 5), "resting_hr");
    expect(short.ready).toBe(false);
    const unscored = computeBaseline(days.map((d) => ({ ...d, scored: false })), "resting_hr");
    expect(unscored.n).toBe(0);
    expect(unscored.last).toBeNull();
  });
});
