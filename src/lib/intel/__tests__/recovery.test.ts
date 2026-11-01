import { describe, expect, it } from "vitest";
import { ENGINE_RULES, READINESS_VERSION, readinessScore, recoveryEngine, RULES } from "../engines/recovery";
import { makeContext, makeDays } from "./fixture";
import type { Finding } from "../types";

const TODAY = "2026-11-01";
const byRule = (fs: Finding[], rule: string) => fs.filter((f) => f.rule === rule);
const one = (fs: Finding[], rule: string) => {
  const hits = byRule(fs, rule);
  expect(hits, `expected exactly one ${rule}`).toHaveLength(1);
  return hits[0];
};

describe("recovery engine on a quiet history", () => {
  const ctx = makeContext(makeDays(90, TODAY));
  const out = recoveryEngine(ctx);

  it("emits the trend summary as stable", () => {
    const f = one(out, RULES.trend);
    expect(f.kind).toBe("trend");
    expect(f.severity).toBe("info");
    expect(f.day).toBe(TODAY);
    expect(f.evidence?.direction).toBe("stable");
    expect(f.value).toBe(Math.round(ctx.baselines.recovery_score.mean7! * 100) / 100);
  });

  it("raises nothing else", () => {
    expect(out.filter((f) => f.rule !== RULES.trend).map((f) => f.rule)).toEqual([]);
  });

  it("lists every rule it can emit, uniquely and engine-prefixed", () => {
    const keys = ENGINE_RULES.map((r) => r.rule);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith("recovery.")).toBe(true);
    expect(keys).toEqual(expect.arrayContaining(Object.values(RULES)));
    for (const f of out) expect(keys).toContain(f.rule);
  });
});

describe("recovery trend rules", () => {
  it("flags deterioration when recovery slides over the month", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 60) d.recovery_score = Math.max(5, (d.recovery_score ?? 65) - (i - 60));
    });
    const out = recoveryEngine(makeContext(days));
    const f = one(out, RULES.deteriorating);
    expect(["low", "moderate"]).toContain(f.severity);
    expect(f.evidence?.change30).toBeLessThan(-10);
    expect(one(out, RULES.trend).evidence?.direction).toBe("falling");
    expect(byRule(out, RULES.improving)).toHaveLength(0);
    expect(f.nextStep).toContain("not a diagnosis");
  });

  it("flags improvement when recovery climbs", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.recovery_score = Math.round(40 + (i >= 60 ? (i - 60) * 1.2 : 0) + ((i % 5) - 2) * 2);
    });
    const out = recoveryEngine(makeContext(days));
    const f = one(out, RULES.improving);
    expect(f.severity).toBe("info");
    expect(f.evidence?.rateOfChangePct).toBeGreaterThan(8);
    expect(byRule(out, RULES.deteriorating)).toHaveLength(0);
  });
});

describe("low streak and volatility", () => {
  it("counts consecutive red-zone days and escalates when all are under 34%", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) d.recovery_score = 25;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.lowStreak);
    expect(f.kind).toBe("pattern");
    expect(f.evidence?.run).toBe(4);
    expect(f.evidence?.redRun).toBe(4);
    expect(f.severity).toBe("moderate");
    expect(f.title).toContain("4 consecutive");
  });

  it("uses the fixed 34% floor before the personal baseline is ready", () => {
    const days = makeDays(8, TODAY, (i, d) => {
      if (i >= 5) d.recovery_score = 20;
    });
    const ctx = makeContext(days);
    expect(ctx.baselines.recovery_score.ready).toBe(false);
    const f = one(recoveryEngine(ctx), RULES.lowStreak);
    expect(f.evidence?.p25).toBeNull();
    expect(f.evidence?.run).toBe(3);
  });

  it("fires on persistence below the personal p25 above the red zone", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.recovery_score = 45;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.lowStreak);
    expect(f.evidence?.redRun).toBe(0);
    expect(f.severity).toBe("low");
  });

  it("flags a volatile week against a steady history", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.recovery_score = 65 + ((i % 3) - 1) * 3;
      if (i >= 83) d.recovery_score = i % 2 ? 95 : 30;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.volatility);
    expect(f.severity).toBe("moderate");
    expect(f.evidence?.ratio).toBeGreaterThan(2);
  });
});

describe("HRV and RHR deviations in recovery context", () => {
  it("reports a suppressed HRV morning", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.hrv_rmssd = 40;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.hrvDeviation);
    expect(f.kind).toBe("deviation");
    expect(["moderate", "high"]).toContain(f.severity);
    expect(f.title).toContain("below");
  });

  it("treats a favourable deviation as informational", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.resting_hr = 44;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.rhrDeviation);
    expect(f.severity).toBe("info");
    expect(f.title).toContain("below");
  });

  it("flags an elevated resting heart rate", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.resting_hr = 62;
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.rhrDeviation);
    expect(f.severity).toBe("high");
    expect(f.nextStep).toContain("not a diagnosis");
  });
});

describe("conditional comparisons", () => {
  it("links short nights on the same row to lower recovery", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      const short = i % 4 === 0;
      d.sleep_total_min = short ? 330 : 440;
      d.recovery_score = short ? 40 + (i % 3) : 70 + (i % 3);
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.sleepDeficit);
    expect(f.kind).toBe("pattern");
    expect(f.evidence?.diff).toBeLessThan(-20);
    expect(f.severity).toBe("moderate");
    expect(f.evidence?.nCondition).toBeGreaterThanOrEqual(5);
  });

  it("links a high-strain previous day to lower recovery", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.day_strain = i % 4 === 0 ? 18 : 8;
    });
    for (let i = 1; i < days.length; i++) days[i].recovery_score = (days[i - 1].day_strain ?? 0) > 12 ? 40 + (i % 3) : 70 + (i % 3);
    const f = one(recoveryEngine(makeContext(days)), RULES.strainDeficit);
    expect(f.evidence?.diff).toBeLessThan(-20);
    expect(f.method).toContain("previous-row");
  });

  it("does not report a strain deficit when hard days are followed by higher recovery", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.day_strain = i % 4 === 0 ? 18 : 8;
    });
    for (let i = 1; i < days.length; i++) days[i].recovery_score = (days[i - 1].day_strain ?? 0) > 12 ? 80 : 60;
    expect(byRule(recoveryEngine(makeContext(days)), RULES.strainDeficit)).toHaveLength(0);
  });

  it("compares mornings after the hardest workouts with the rest", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (d.workout_strain != null) d.workout_strain = i % 6 === 0 ? 18 : 8;
    });
    for (let i = 1; i < days.length; i++) days[i].recovery_score = (days[i - 1].workout_strain ?? 0) > 12 ? 45 + (i % 3) : 68 + (i % 3);
    const f = one(recoveryEngine(makeContext(days)), RULES.afterHardWorkouts);
    expect(f.title).toContain("lower");
    expect(f.severity).toBe("info");
    expect(f.evidence?.diff).toBeLessThan(-15);
  });

  it("compares mornings after rest days (previous-row workout_count 0)", () => {
    const days = makeDays(90, TODAY);
    for (let i = 1; i < days.length; i++) days[i].recovery_score = days[i - 1].workout_count === 0 ? 80 + (i % 3) : 60 + (i % 3);
    const f = one(recoveryEngine(makeContext(days)), RULES.afterRestDays);
    expect(f.title).toContain("higher");
    expect(f.evidence?.diff).toBeGreaterThan(15);
  });

  it("needs at least five nap days before comparing", () => {
    const sparse = makeDays(90, TODAY, (i, d) => {
      d.nap_count = i === 20 || i === 50 || i === 80 ? 1 : 0;
    });
    for (let i = 1; i < sparse.length; i++) sparse[i].recovery_score = (sparse[i - 1].nap_count ?? 0) > 0 ? 90 : 60;
    expect(byRule(recoveryEngine(makeContext(sparse)), RULES.afterNaps)).toHaveLength(0);

    const regular = makeDays(90, TODAY, (i, d) => {
      d.nap_count = i % 5 === 0 ? 1 : 0;
    });
    for (let i = 1; i < regular.length; i++) regular[i].recovery_score = (regular[i - 1].nap_count ?? 0) > 0 ? 85 + (i % 3) : 60 + (i % 3);
    const f = one(recoveryEngine(makeContext(regular)), RULES.afterNaps);
    expect(f.title).toContain("higher");
    expect(f.evidence?.nCondition).toBeGreaterThanOrEqual(5);
  });
});

describe("correlations", () => {
  it("links sleep consistency to recovery with n, r and CI", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      d.recovery_score = Math.round(20 + (d.sleep_consistency ?? 80) * 0.7);
    });
    const f = one(recoveryEngine(makeContext(days)), RULES.vsSleepRegularity);
    expect(f.kind).toBe("correlation");
    expect(f.evidence?.r).toBeGreaterThan(0.3);
    expect(f.evidence?.n).toBeGreaterThanOrEqual(14);
    expect((f.evidence?.ci as [number, number])[0]).toBeGreaterThan(0);
  });

  it("links the previous day's strain to recovery (lag 1)", () => {
    const days = makeDays(90, TODAY);
    for (let i = 1; i < days.length; i++) days[i].recovery_score = Math.round(Math.max(1, 110 - 4 * (days[i - 1].day_strain ?? 10)));
    const f = one(recoveryEngine(makeContext(days)), RULES.vsPrevExertion);
    expect(f.evidence?.lag).toBe(1);
    expect(f.evidence?.r).toBeLessThan(-0.3);
  });
});

describe("settings", () => {
  it("honours disabled rules", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) d.recovery_score = 25;
    });
    const out = recoveryEngine(makeContext(days, { disabled: new Set([RULES.lowStreak, RULES.trend]) }));
    expect(byRule(out, RULES.lowStreak)).toHaveLength(0);
    expect(byRule(out, RULES.trend)).toHaveLength(0);
  });
});

describe("readinessScore", () => {
  it("scores a quiet day from all five factors", () => {
    const ctx = makeContext(makeDays(90, TODAY));
    const s = readinessScore(ctx);
    expect(s.key).toBe("readiness");
    expect(s.day).toBe(TODAY);
    expect(s.version).toBe(READINESS_VERSION);
    expect(s.version).toBe("readiness.v1");
    expect(s.factors.map((f) => f.key)).toEqual(["hrv", "rhr", "sleep", "strain", "recovery"]);
    expect(s.factors.map((f) => f.weight)).toEqual([30, 25, 20, 15, 10]);
    for (const f of s.factors) {
      expect(f.score).not.toBeNull();
      expect(f.score!).toBeGreaterThanOrEqual(0);
      expect(f.score!).toBeLessThanOrEqual(100);
      expect(f.detail.length).toBeGreaterThan(0);
    }
    expect(s.completeness).toBe(1);
    expect(s.value).not.toBeNull();
    expect(s.value!).toBeGreaterThanOrEqual(0);
    expect(s.value!).toBeLessThanOrEqual(100);
    const expected = Math.round(s.factors.reduce((a, f) => a + f.weight * f.score!, 0) / 100);
    expect(s.value).toBe(expected);
    expect(s.note).toContain("not WHOOP's recovery score");
    expect(s.note).toContain("does not assess medical fitness");
    expect(s.note).toContain("easy day");
  });

  it("maps HRV and RHR z-scores on clipped linear scales", () => {
    const highHrv = makeContext(makeDays(90, TODAY, (i, d) => {
      if (i === 89) {
        d.hrv_rmssd = 120;
        d.resting_hr = 40;
      }
    }));
    const hi = readinessScore(highHrv);
    expect(hi.factors.find((f) => f.key === "hrv")!.score).toBe(100);
    expect(hi.factors.find((f) => f.key === "rhr")!.score).toBe(100);

    const lowHrv = makeContext(makeDays(90, TODAY, (i, d) => {
      if (i === 89) {
        d.hrv_rmssd = 30;
        d.resting_hr = 70;
      }
    }));
    const lo = readinessScore(lowHrv);
    expect(lo.factors.find((f) => f.key === "hrv")!.score).toBe(0);
    expect(lo.factors.find((f) => f.key === "rhr")!.score).toBe(0);
    expect(lo.value!).toBeLessThan(hi.value!);
  });

  it("drops missing factors and renormalises the weights", () => {
    const ctx = makeContext(makeDays(90, TODAY, (i, d) => {
      if (i === 89) {
        d.hrv_rmssd = null;
        d.sleep_total_min = null;
      }
    }));
    const s = readinessScore(ctx);
    const hrv = s.factors.find((f) => f.key === "hrv")!;
    expect(hrv.score).toBeNull();
    expect(hrv.detail).toContain("No HRV");
    expect(s.completeness).toBe(0.5);
    const present = s.factors.filter((f) => f.score != null);
    const expected = Math.round(present.reduce((a, f) => a + f.weight * f.score!, 0) / present.reduce((a, f) => a + f.weight, 0));
    expect(s.value).toBe(expected);
  });

  it("returns null when the cardio baselines are not ready", () => {
    const s = readinessScore(makeContext(makeDays(10, TODAY)));
    expect(s.value).toBeNull();
    expect(s.note).toContain("Not scored yet");
    expect(s.completeness).toBeGreaterThan(0);
  });

  it("returns null with fewer than two factors", () => {
    const ctx = makeContext(makeDays(90, TODAY, (i, d) => {
      if (i >= 87) {
        d.hrv_rmssd = null;
        d.resting_hr = null;
        d.sleep_total_min = null;
        d.recovery_score = null;
      }
      if (i === 88) d.day_strain = null;
    }));
    const s = readinessScore(ctx);
    expect(s.factors.filter((f) => f.score != null)).toHaveLength(0);
    expect(s.value).toBeNull();
  });

  it("scores an earlier day using only the history before it", () => {
    const days = makeDays(90, TODAY);
    const ctx = makeContext(days);
    const s = readinessScore(ctx, days[60].day);
    expect(s.day).toBe(days[60].day);
    expect(s.value).not.toBeNull();
    expect(s.factors.find((f) => f.key === "sleep")!.detail).toContain("need");
  });

  it("uses the 30-day median when sleep need is unknown", () => {
    const ctx = makeContext(makeDays(90, TODAY, (i, d) => {
      d.sleep_need_min = null;
    }));
    const s = readinessScore(ctx);
    expect(s.factors.find((f) => f.key === "sleep")!.detail).toContain("30-day median");
  });

  it("returns an empty score for an unknown day", () => {
    const s = readinessScore(makeContext(makeDays(90, TODAY)), "2030-01-01");
    expect(s.value).toBeNull();
    expect(s.completeness).toBe(0);
    expect(s.factors.every((f) => f.score == null)).toBe(true);
  });
});
