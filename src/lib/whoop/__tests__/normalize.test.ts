import { describe, expect, it } from "vitest";
import { localDay, normalizeWhoop } from "../normalize";

describe("normalizeWhoop", () => {
  it("maps cycle, recovery, sleep and workouts onto local days with unit conversion", () => {
    const out = normalizeWhoop({
      timezone: "America/Indiana/Indianapolis",
      cycles: [{ id: 1, start: "2026-10-30T03:30:00Z", end: "2026-10-31T03:20:00Z", timezone_offset: "-04:00", score_state: "SCORED", score: { strain: 12.3, kilojoule: 9200, average_heart_rate: 72, max_heart_rate: 171 } }],
      recoveries: [{ cycle_id: 1, score_state: "SCORED", score: { recovery_score: 61, resting_heart_rate: 51, hrv_rmssd_milli: 74, spo2_percentage: 96.2, skin_temp_celsius: 33.1 } }],
      sleeps: [
        { id: 10, start: "2026-10-30T03:10:00Z", end: "2026-10-30T10:30:00Z", timezone_offset: "-04:00", nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 27_600_000, total_awake_time_milli: 2_400_000, total_light_sleep_time_milli: 12_000_000, total_slow_wave_sleep_time_milli: 6_000_000, total_rem_sleep_time_milli: 7_200_000, sleep_cycle_count: 5, disturbance_count: 8 }, sleep_needed: { baseline_milli: 28_800_000, need_from_sleep_debt_milli: 1_800_000, need_from_recent_strain_milli: 600_000, need_from_recent_nap_milli: 0 }, respiratory_rate: 14.6, sleep_performance_percentage: 88, sleep_consistency_percentage: 72, sleep_efficiency_percentage: 91 } },
        { id: 11, start: "2026-10-30T18:00:00Z", end: "2026-10-30T18:25:00Z", timezone_offset: "-04:00", nap: true, score_state: "SCORED", score: { stage_summary: { total_light_sleep_time_milli: 1_200_000, total_slow_wave_sleep_time_milli: 0, total_rem_sleep_time_milli: 0 } } },
      ],
      workouts: [{ id: 20, start: "2026-10-30T12:00:00Z", end: "2026-10-30T13:00:00Z", timezone_offset: "-04:00", sport_name: "running", score_state: "SCORED", score: { strain: 11.2, average_heart_rate: 152, max_heart_rate: 181, kilojoule: 2500 } }],
    });
    expect(out).toHaveLength(1);
    const d = out[0];
    expect(d.day).toBe("2026-10-30"); // cycle starts 11:30 PM local on the 29th; wake day is the 30th
    expect(d.day_strain).toBe(12.3);
    expect(d.energy_kcal).toBe(2199);
    expect(d.recovery_score).toBe(61);
    expect(d.hrv_rmssd).toBe(74);
    expect(d.workout_count).toBe(1);
    expect(d.workout_kcal).toBe(598);
  });

  it("puts sleep on the wake day, sums naps and marks unscorable records", () => {
    const out = normalizeWhoop({
      timezone: "UTC",
      cycles: [{ id: 2, start: "2026-10-30T22:00:00Z", timezone_offset: "+00:00", score_state: "UNSCORABLE", score: null }],
      recoveries: [],
      sleeps: [{ id: 12, start: "2026-10-30T23:00:00Z", end: "2026-10-31T06:30:00Z", timezone_offset: "+00:00", nap: false, score_state: "SCORED", score: { stage_summary: { total_light_sleep_time_milli: 10_800_000, total_slow_wave_sleep_time_milli: 5_400_000, total_rem_sleep_time_milli: 7_200_000, total_awake_time_milli: 1_800_000, total_in_bed_time_milli: 27_000_000 } } }],
      workouts: [],
    });
    const wake = out.find((d) => d.day === "2026-10-31")!;
    expect(wake.sleep_total_min).toBe(390);
    expect(wake.sleep_onset_min).toBe(660); // 11:00 PM
    expect(wake.wake_min).toBe(1110); // 6:30 AM
    expect(wake.sleep_need_min).toBeUndefined();
    expect(out).toHaveLength(1);
    expect(wake.scored).toBe(false); // the unscorable cycle lands on the same wake day
  });

  it("derives the local day from the record offset", () => {
    expect(localDay("2026-10-30T03:30:00Z", "-04:00", "UTC")).toBe("2026-10-29");
    expect(localDay("2026-10-30T03:30:00Z", "+02:00", "UTC")).toBe("2026-10-30");
    expect(localDay("2026-10-30T03:30:00Z", undefined, "America/Indiana/Indianapolis")).toBe("2026-10-29");
  });
});
