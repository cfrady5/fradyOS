import { describe, expect, it } from "vitest";
import { cardioEngine, ENGINE_RULES, RULES } from "../engines/cardio";
import { makeContext, makeDays } from "./fixture";
import type { Finding } from "../types";

const TODAY = "2026-11-01";
const byRule = (fs: Finding[], rule: string) => fs.filter((f) => f.rule === rule);
const one = (fs: Finding[], rule: string) => {
  const hits = byRule(fs, rule);
  expect(hits, `expected exactly one ${rule}`).toHaveLength(1);
  return hits[0];
};

describe("cardio engine on a quiet history", () => {
  const ctx = makeContext(makeDays(90, TODAY));
  const out = cardioEngine(ctx);

  it("emits the status rules with the personal baseline", () => {
    const rhr = one(out, RULES.rhrStatus);
    expect(rhr.kind).toBe("status");
    expect(rhr.severity).toBe("info");
    expect(rhr.day).toBe(TODAY);
    expect(rhr.baseline).toBe(ctx.baselines.resting_hr.median90);
    expect(rhr.evidence).toMatchObject({ n: 90 });
    expect(typeof rhr.evidence?.mean30).toBe("number");
    const hrv = one(out, RULES.hrvStatus);
    expect(hrv.metric).toBe("hrv_rmssd");
    expect(hrv.explanation).toContain("90 readings");
  });

  it("emits the 90-day fitness summary and the workout intensity status", () => {
    const fit = one(out, RULES.fitnessPattern);
    expect(fit.kind).toBe("trend");
    expect(fit.evidence?.direction).toBe("stable or mixed");
    const intensity = one(out, RULES.workoutIntensity);
    expect(intensity.kind).toBe("status");
    expect(["easy", "moderate", "hard", "very hard"]).toContain(intensity.evidence?.bucket);
  });

  it("raises no deviation, safety, trend-shift or correlation findings", () => {
    const quietRules = new Set<string>([RULES.rhrStatus, RULES.hrvStatus, RULES.fitnessPattern, RULES.workoutIntensity]);
    const unexpected = out.filter((f) => !quietRules.has(f.rule)).map((f) => f.rule);
    expect(unexpected).toEqual([]);
  });

  it("only emits rules listed in ENGINE_RULES, which are unique and engine-prefixed", () => {
    const keys = ENGINE_RULES.map((r) => r.rule);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith("cardio.")).toBe(true);
    for (const f of out) expect(keys).toContain(f.rule);
    expect(keys).toEqual(expect.arrayContaining(Object.values(RULES)));
  });

  it("every finding carries the contract fields", () => {
    for (const f of out) {
      expect(f.engine).toBe("cardio");
      expect(f.method.length).toBeGreaterThan(0);
      expect(f.explanation.length).toBeGreaterThan(0);
      expect(f.nextStep.length).toBeGreaterThan(0);
      expect(f.explanation).not.toContain("—");
      expect(f.completeness).toBeGreaterThan(0);
      expect(f.completeness).toBeLessThanOrEqual(1);
    }
  });
});

describe("resting heart rate deviations", () => {
  it("flags an 8 bpm rise over the last four days as elevated and high", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) d.resting_hr = (d.resting_hr ?? 52) + 8;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.rhrElevated);
    expect(f.kind).toBe("deviation");
    expect(f.severity).toBe("high");
    expect(f.day).toBe(TODAY);
    expect(f.delta).toBeGreaterThanOrEqual(6);
    expect(f.evidence?.run).toBeGreaterThanOrEqual(3);
    expect(f.nextStep).toContain("not a diagnosis");
    expect(byRule(out, RULES.rhrLow)).toHaveLength(0);
  });

  it("fires on persistence above p75 even when the z threshold is not met", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.resting_hr = 55;
    });
    const out = cardioEngine(makeContext(days, { zModerate: 6 }));
    const f = one(out, RULES.rhrElevated);
    expect(f.severity).toBe("low");
    expect(f.method).toContain("consecutive days above personal p75");
    expect(f.evidence?.run).toBe(3);
  });

  it("flags an unusually low resting heart rate", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 88) d.resting_hr = 44;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.rhrLow);
    expect(f.value).toBe(44);
    expect(f.delta).toBeLessThan(-5);
    expect(byRule(out, RULES.rhrElevated)).toHaveLength(0);
  });

  it("detects a sustained upward shift as a long-term change", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 55) d.resting_hr = (d.resting_hr ?? 52) + 5;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.rhrLongTerm);
    expect(f.kind).toBe("trend");
    expect(f.title).toContain("up");
    expect(f.method).toContain("CUSUM");
    expect(f.evidence?.shift).toBeGreaterThan(3);
    expect(f.severity).not.toBe("info");
  });

  it("treats a gradual fall as informational", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60) d.resting_hr = (d.resting_hr ?? 52) - Math.round((i - 60) / 6);
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.rhrLongTerm);
    expect(f.title).toContain("down");
    expect(f.severity).toBe("info");
  });
});

describe("fixed safety thresholds", () => {
  it("fires above 100 bpm before any baseline is ready and uses the clinician note", () => {
    const days = makeDays(5, TODAY, (i, d) => {
      if (i === 4) d.resting_hr = 104;
    });
    const ctx = makeContext(days);
    expect(ctx.baselines.resting_hr.ready).toBe(false);
    const out = cardioEngine(ctx);
    const f = one(out, RULES.rhrSafetyHigh);
    expect(f.severity).toBe("moderate");
    expect(f.value).toBe(104);
    expect(f.day).toBe(TODAY);
    expect(f.nextStep).toContain("check with a clinician");
    expect(byRule(out, RULES.rhrStatus)).toHaveLength(0);
    expect(byRule(out, RULES.rhrElevated)).toHaveLength(0);
  });

  it("fires below 40 bpm", () => {
    const days = makeDays(30, TODAY, (i, d) => {
      if (i === 29) d.resting_hr = 38;
    });
    const out = cardioEngine(makeContext(days));
    expect(one(out, RULES.rhrSafetyLow).severity).toBe("moderate");
    expect(byRule(out, RULES.rhrSafetyHigh)).toHaveLength(0);
  });

  it("uses the latest reading, so a normal day clears it", () => {
    const days = makeDays(30, TODAY, (i, d) => {
      if (i === 28) d.resting_hr = 110;
    });
    expect(byRule(cardioEngine(makeContext(days)), RULES.rhrSafetyHigh)).toHaveLength(0);
  });
});

describe("HRV rules", () => {
  it("flags suppression after three days 25 ms below baseline", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.hrv_rmssd = (d.hrv_rmssd ?? 70) - 25;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.hrvSuppressed);
    expect(f.kind).toBe("deviation");
    expect(["moderate", "high"]).toContain(f.severity);
    expect(f.delta).toBeLessThan(-15);
    expect(f.evidence?.run).toBeGreaterThanOrEqual(3);
  });

  it("reports an improvement trend when HRV climbs", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.hrv_rmssd = (d.hrv_rmssd ?? 70) + Math.round(i * 0.7);
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.hrvImproving);
    expect(f.kind).toBe("trend");
    expect(f.severity).toBe("info");
    expect(f.evidence?.rateOfChangePct).toBeGreaterThan(5);
  });

  it("flags a week of wild HRV swings against a steady history", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.hrv_rmssd = 70 + ((i % 3) - 1) * 2;
      if (i >= 83) d.hrv_rmssd = i % 2 ? 95 : 45;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.hrvFluctuation);
    expect(f.kind).toBe("pattern");
    expect(["low", "moderate"]).toContain(f.severity);
    expect(f.evidence?.ratio).toBeGreaterThan(1.75);
  });
});

describe("workout and load rules", () => {
  it("reports rising workout average heart rate against the previous month", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60 && d.workout_avg_hr != null) d.workout_avg_hr += 12;
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.workoutAvgHrTrend);
    expect(f.title).toContain("higher");
    expect(f.evidence?.diff).toBeGreaterThan(8);
    expect(f.severity).toBe("info");
    expect(byRule(out, RULES.workoutMaxHrTrend)).toHaveLength(0);
  });

  it("reports falling workout max heart rate", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60 && d.workout_max_hr != null) {
        d.workout_max_hr -= 15;
        d.max_hr = d.workout_max_hr;
      }
    });
    const f = one(cardioEngine(makeContext(days)), RULES.workoutMaxHrTrend);
    expect(f.title).toContain("lower");
  });

  it("buckets the latest workout by share of the 90-day peak", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) {
        d.workout_count = 1;
        d.workout_avg_hr = 165;
        d.workout_max_hr = 180;
        d.max_hr = 180;
        d.workout_strain = 15;
        d.workout_min = 50;
      }
    });
    const f = one(cardioEngine(makeContext(days)), RULES.workoutIntensity);
    expect(f.day).toBe(TODAY);
    expect(f.evidence?.bucket).toBe("very hard");
    expect(f.value).toBeGreaterThan(85);
  });

  it("flags strain accumulation when this week is far above the 4-week norm", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 83) d.day_strain = 19;
    });
    const f = one(cardioEngine(makeContext(days)), RULES.strainAccumulation);
    expect(f.kind).toBe("pattern");
    expect(f.evidence?.ratio).toBeGreaterThan(1.3);
    expect(["low", "moderate"]).toContain(f.severity);
    expect(f.value).toBeCloseTo(19 * 7, 0);
  });

  it("recognises adaptation: RHR down and HRV up at steady load", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60) {
        d.resting_hr = (d.resting_hr ?? 52) - 3;
        d.hrv_rmssd = (d.hrv_rmssd ?? 70) + 8;
      }
    });
    const out = cardioEngine(makeContext(days));
    const f = one(out, RULES.adaptation);
    expect(f.severity).toBe("info");
    expect(f.evidence?.rhrDelta).toBeLessThan(-1);
    expect(f.evidence?.hrvPct).toBeGreaterThan(5);
    expect(one(out, RULES.fitnessPattern).evidence?.direction).toBe("improving");
  });
});

describe("correlations", () => {
  it("links the previous day's strain to recovery with n, r and a CI", () => {
    const days = makeDays(90, TODAY);
    for (let i = 1; i < days.length; i++) days[i].recovery_score = Math.round(Math.min(100, Math.max(1, 110 - 4 * (days[i - 1].day_strain ?? 10) + ((i % 7) - 3) * 4)));
    const f = one(cardioEngine(makeContext(days)), RULES.recoveryVsExertion);
    expect(f.kind).toBe("correlation");
    expect(f.evidence?.n).toBeGreaterThanOrEqual(14);
    expect(f.evidence?.r).toBeLessThan(-0.3);
    expect(f.evidence?.lag).toBe(1);
    const ci = f.evidence?.ci as [number, number];
    expect(ci[0]).toBeLessThan(ci[1]);
    expect(ci[1]).toBeLessThan(0);
  });

  it("links sleep duration to resting heart rate on the same row", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.resting_hr = Math.round(70 - (d.sleep_total_min ?? 420) / 25);
    });
    const f = one(cardioEngine(makeContext(days)), RULES.rhrVsSleep);
    expect(f.evidence?.r).toBeLessThan(-0.3);
    expect(f.evidence?.lag).toBe(0);
  });

  it("links the trailing 7-day strain to HRV", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.day_strain = i % 14 < 7 ? 18 : 5;
    });
    for (let i = 7; i < days.length; i++) {
      const load = days.slice(i - 7, i).reduce((a, d) => a + (d.day_strain ?? 0), 0);
      days[i].hrv_rmssd = Math.round(110 - load * 0.5);
    }
    const f = one(cardioEngine(makeContext(days)), RULES.hrvVsTrainingLoad);
    expect(f.evidence?.r).toBeLessThan(-0.3);
    expect(f.evidence?.loadWindowDays).toBe(7);
  });

  it("stays silent below 14 pairs", () => {
    const days = makeDays(12, TODAY);
    for (let i = 1; i < days.length; i++) days[i].recovery_score = Math.round(Math.max(1, 90 - 20 * (days[i - 1].day_strain ?? 1)));
    expect(byRule(cardioEngine(makeContext(days)), RULES.recoveryVsExertion)).toHaveLength(0);
  });
});

describe("settings", () => {
  it("honours disabled rules", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) d.resting_hr = (d.resting_hr ?? 52) + 8;
    });
    const out = cardioEngine(makeContext(days, { disabled: new Set([RULES.rhrElevated, RULES.rhrStatus]) }));
    expect(byRule(out, RULES.rhrElevated)).toHaveLength(0);
    expect(byRule(out, RULES.rhrStatus)).toHaveLength(0);
    expect(byRule(out, RULES.hrvStatus)).toHaveLength(1);
  });

  it("waits for the baseline before personal rules fire", () => {
    const days = makeDays(10, TODAY, (i, d) => {
      if (i >= 7) d.resting_hr = 62;
    });
    const out = cardioEngine(makeContext(days));
    expect(out.filter((f) => f.rule !== RULES.workoutIntensity)).toHaveLength(0);
  });
});
