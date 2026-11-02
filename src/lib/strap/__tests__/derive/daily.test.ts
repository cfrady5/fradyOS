import { describe, expect, it } from "vitest";
import { deriveDays } from "../../derive/daily";
import { D1, D2, D3, PROFILE, scenario } from "./fixture";

const minutes = scenario();
const result = deriveDays(minutes, PROFILE, { from: D1, to: D3 });
const byDay = new Map(result.days.map((d) => [d.day, d]));

describe("deriveDays", () => {
  it("emits one row per wake day with provider ble", () => {
    expect(result.days.map((d) => d.day)).toEqual([D1, D2, D3]);
    for (const d of result.days) expect(d.provider).toBe("ble");
  });

  it("fills the run day from the night that ended that morning and the day's activity", () => {
    const d = byDay.get(D1)!;
    expect(d.scored).toBe(true);
    expect(d.sleep_total_min!).toBeGreaterThanOrEqual(420);
    expect(d.in_bed_min!).toBeGreaterThanOrEqual(450);
    expect(d.sleep_onset_min!).toBeGreaterThanOrEqual(650);
    expect(d.sleep_onset_min!).toBeLessThanOrEqual(670);
    expect(d.wake_min!).toBeGreaterThanOrEqual(1110);
    expect(d.wake_min!).toBeLessThanOrEqual(1130);
    expect(d.deep_min!).toBeGreaterThan(0);
    expect(d.rem_min!).toBeGreaterThan(0);
    expect(d.light_min!).toBeGreaterThan(0);
    expect(d.sleep_efficiency!).toBeGreaterThan(90);
    expect(d.disturbances!).toBeGreaterThanOrEqual(1);
    expect(d.resting_hr!).toBeGreaterThanOrEqual(48);
    expect(d.resting_hr!).toBeLessThanOrEqual(53);
    expect(d.hrv_rmssd).not.toBeNull();
    expect(Math.abs(d.resp_rate! - 15)).toBeLessThanOrEqual(1.5);
    expect(d.nap_count).toBe(1);
    expect(d.nap_min!).toBeGreaterThanOrEqual(35);
    expect(d.workout_count).toBe(1);
    expect(d.workout_min!).toBeGreaterThanOrEqual(43);
    expect(d.workout_min!).toBeLessThanOrEqual(47);
    expect(d.workout_avg_hr!).toBeGreaterThanOrEqual(146);
    expect(d.day_strain!).toBeGreaterThan(byDay.get(D2)!.day_strain!);
    expect(d.day_strain!).toBeLessThanOrEqual(21);
    expect(d.completeness).toBeCloseTo(5 / 6, 6); // rhr, hrv, sleep total, strain, resp present; recovery null
  });

  it("leaves fields it cannot derive null rather than zero", () => {
    const d = byDay.get(D1)!;
    expect(d.recovery_score).toBeNull();
    expect(d.spo2).toBeNull();
    expect(d.skin_temp).toBeNull();
    expect(d.energy_kcal).toBeNull();
    expect(d.sleep_cycles).toBeNull();
    expect(d.sleep_need_min).toBeNull();
    expect(d.sleep_debt_min).toBeNull();
    expect(d.sleep_performance).toBeNull();
    expect(d.workout_kcal).toBeNull();
    expect(d.sleep_consistency).toBeNull(); // fewer than 4 nights
  });

  it("marks the rest day scored with no workout and no nap", () => {
    const d = byDay.get(D2)!;
    expect(d.scored).toBe(true);
    expect(d.workout_count).toBe(0);
    expect(d.workout_min).toBeNull();
    expect(d.nap_count).toBe(0);
    expect(d.sleep_total_min!).toBeGreaterThanOrEqual(400);
    expect(d.resting_hr).not.toBeNull();
  });

  it("marks a day with little contact unscored and without sleep", () => {
    const d = byDay.get(D3)!;
    expect(d.scored).toBe(false);
    expect(d.sleep_total_min).toBeNull();
    expect(d.resting_hr).toBeNull();
    expect(result.coverage[D3]).toBeLessThan(0.2);
    expect(result.coverage[D1]).toBeGreaterThan(0.95);
    // Strain still uses the last known resting heart rate so the partial day is not silently zero.
    expect(d.day_strain).not.toBeNull();
  });

  it("returns the episodes, workouts and method notes", () => {
    expect(result.episodes.filter((e) => e.kind === "main")).toHaveLength(2);
    expect(result.episodes.filter((e) => e.nap)).toHaveLength(1);
    expect(result.workouts).toHaveLength(1);
    expect(result.notes.some((n) => /not EEG/.test(n))).toBe(true);
    expect(result.notes.some((n) => /FRADY strain/.test(n))).toBe(true);
    expect(result.notes.some((n) => n.startsWith(`${D3}:`) && /unscored/.test(n))).toBe(true);
  });

  it("handles an empty series", () => {
    const empty = deriveDays([], PROFILE, { from: D1, to: D1 });
    expect(empty.days).toEqual([]);
    expect(empty.notes.some((n) => /No minutes/.test(n))).toBe(true);
  });
});
