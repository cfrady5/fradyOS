import { describe, expect, it } from "vitest";
import { ENGINE_RULES, activityEngine, trainingLoad } from "../engines/activity";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-11-01";
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("activityEngine", () => {
  it("lists every rule it can emit and never a step rule beyond the unavailable notice", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    for (const k of keys) {
      expect(k.startsWith("activity.")).toBe(true);
      if (k.includes("step")) expect(k).toBe("activity.steps_unavailable");
    }
    const fs = activityEngine(makeContext(makeDays(90, TODAY)));
    for (const f of fs) expect(keys.has(f.rule)).toBe(true);
  });

  it("emits a single steps_unavailable status and no deviations on a quiet history", () => {
    const fs = activityEngine(makeContext(makeDays(90, TODAY)));
    const steps = fs.filter((f) => f.rule === "activity.steps_unavailable");
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("status");
    expect(steps[0].severity).toBe("info");
    expect(steps[0].metric).toBe("steps");
    expect(steps[0].value).toBeNull();
    expect(steps[0].explanation).toContain("No connected source");
    expect(fs.filter((f) => f.kind === "deviation")).toHaveLength(0);
    expect(rules(fs)).toContain("activity.strain_status");
    expect(rules(fs)).toContain("activity.strain_consistency");
    expect(rules(fs)).toContain("activity.workout_frequency");
    expect(rules(fs)).toContain("activity.acwr_status");
    // Fixture trains two days in three: a rest day every week, so no rest-day flag.
    expect(rules(fs)).not.toContain("activity.rest_day_frequency");
  });

  it("flags an unusually hard day", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.day_strain = 20.5;
    });
    const f = activityEngine(makeContext(days)).find((x) => x.rule === "activity.strain_deviation");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("deviation");
    expect(f!.title).toContain("hard");
  });

  it("flags acute and long-term load changes and a high ACWR after a ramp", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 83) d.day_strain = 18;
    });
    const fs = activityEngine(makeContext(days));
    const acute = fs.find((x) => x.rule === "activity.acute_load_change");
    expect(acute).toBeDefined();
    expect(acute!.title).toContain("up");
    const acwr = fs.find((x) => x.rule === "activity.acwr_status");
    expect(acwr).toBeDefined();
    expect(acwr!.value).toBeGreaterThan(1.3);
    expect(["low", "moderate"]).toContain(acwr!.severity);
  });

  it("flags a drop in long-term load", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 62) d.day_strain = Math.round(d.day_strain! * 0.5 * 10) / 10;
    });
    const f = activityEngine(makeContext(days)).find((x) => x.rule === "activity.longterm_load_change");
    expect(f).toBeDefined();
    expect(f!.title).toContain("down");
  });

  it("flags three weeks without a rest day and rising frequency", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 62) {
        d.workout_count = 1;
        d.workout_min = 45;
        d.workout_strain = 10;
      }
    });
    const fs = activityEngine(makeContext(days));
    const rest = fs.find((x) => x.rule === "activity.rest_day_frequency");
    expect(rest).toBeDefined();
    expect(rest!.severity).toBe("info");
    const freq = fs.find((x) => x.rule === "activity.workout_frequency");
    expect(freq).toBeDefined();
    expect(freq!.value).toBeGreaterThan(freq!.baseline!);
  });

  it("flags longer and harder workouts", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 62 && d.workout_count) {
        d.workout_min = (d.workout_min ?? 50) + 30;
        d.workout_strain = (d.workout_strain ?? 10) + 4;
      }
    });
    const fs = activityEngine(makeContext(days));
    expect(fs.find((x) => x.rule === "activity.workout_duration_trend")?.title).toContain("up");
    expect(fs.find((x) => x.rule === "activity.workout_strain_trend")?.title).toContain("up");
  });

  it("flags an intensity trend and an energy trend", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60 && d.workout_count) d.workout_avg_hr = Math.round((d.workout_max_hr ?? 170) * 0.95);
      d.energy_kcal = 2000 + i * 12;
    });
    const fs = activityEngine(makeContext(days));
    expect(fs.find((x) => x.rule === "activity.intensity_trend")?.title).toContain("up");
    expect(fs.find((x) => x.rule === "activity.energy_trend")?.title).toContain("up");
  });

  it("pairs strain on day t with next-morning recovery, sleep, RHR and HRV", () => {
    const days = makeDays(90, TODAY);
    for (let i = 1; i < days.length; i++) {
      const s = days[i - 1].day_strain ?? 10;
      days[i].recovery_score = Math.round(90 - s * 3);
      days[i].sleep_total_min = Math.round(360 + s * 8);
      days[i].resting_hr = Math.round(46 + s * 0.6);
      days[i].hrv_rmssd = Math.round(95 - s * 2.5);
    }
    const fs = activityEngine(makeContext(days));
    const byRule = (r: string) => fs.find((x) => x.rule === r);
    expect(byRule("activity.strain_vs_recovery")?.value).toBeLessThan(-0.5);
    expect(byRule("activity.strain_vs_sleep")?.value).toBeGreaterThan(0.5);
    expect(byRule("activity.strain_vs_resting_hr")?.value).toBeGreaterThan(0.5);
    expect(byRule("activity.strain_vs_hrv")?.value).toBeLessThan(-0.5);
    for (const r of ["activity.strain_vs_recovery", "activity.strain_vs_sleep", "activity.strain_vs_resting_hr", "activity.strain_vs_hrv"]) {
      const f = byRule(r)!;
      expect(f.kind).toBe("correlation");
      expect(f.evidence?.lag).toBe(1);
      expect(f.evidence?.n).toBeGreaterThanOrEqual(14);
    }
  });

  describe("trainingLoad", () => {
    it("returns acute, chronic, ratio, eight weekly sums and rest days per week", () => {
      const tl = trainingLoad(makeContext(makeDays(90, TODAY)));
      expect(tl.acute).not.toBeNull();
      expect(tl.chronic).not.toBeNull();
      expect(tl.ratio).toBeCloseTo(tl.acute! / tl.chronic!, 1);
      expect(tl.weeklyStrain).toHaveLength(8);
      for (const w of tl.weeklyStrain) expect(w).toBeGreaterThan(0);
      expect(tl.restDaysPerWeek).toBeGreaterThan(1.5);
      expect(tl.restDaysPerWeek).toBeLessThan(3);
    });

    it("returns weekly sums oldest first", () => {
      const days = makeDays(56, TODAY, (i, d) => {
        d.day_strain = i < 49 ? 5 : 15;
      });
      const tl = trainingLoad(makeContext(days));
      expect(tl.weeklyStrain[7]).toBeGreaterThan(tl.weeklyStrain[0]);
      expect(tl.weeklyStrain[7]).toBe(105);
    });

    it("is null on a short history", () => {
      const tl = trainingLoad(makeContext(makeDays(3, TODAY)));
      expect(tl.chronic).toBeNull();
      expect(tl.ratio).toBeNull();
      expect(tl.restDaysPerWeek).toBeNull();
    });
  });
});
