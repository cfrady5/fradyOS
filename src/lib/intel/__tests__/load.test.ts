import { describe, expect, it } from "vitest";
import { ENGINE_RULES, loadEngine, loadSeries, physiologicalLoad } from "../engines/load";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-11-01";
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("physiologicalLoad", () => {
  it("returns a 0..100 value with five factors, version pli.v1 and an honest note", () => {
    const s = physiologicalLoad(makeContext(makeDays(90, TODAY)));
    expect(s.key).toBe("physiological_load");
    expect(s.version).toBe("pli.v1");
    expect(s.day).toBe(TODAY);
    expect(s.value).not.toBeNull();
    expect(s.value!).toBeGreaterThanOrEqual(0);
    expect(s.value!).toBeLessThanOrEqual(100);
    expect(s.factors.map((f) => f.key)).toEqual(["hrv_deviation", "rhr_deviation", "sleep_deficiency", "recent_strain", "recovery_trend"]);
    expect(s.factors.map((f) => f.weight)).toEqual([30, 25, 20, 15, 10]);
    expect(s.completeness).toBe(1);
    expect(s.note).toContain("not live");
    expect(s.note).toContain("not WHOOP's Stress Monitor");
    expect(s.note).not.toMatch(/\bstressed\b|anxiety|mood/i);
  });

  it("rises when HRV falls, RHR rises and sleep is short", () => {
    const quiet = physiologicalLoad(makeContext(makeDays(90, TODAY)));
    const loaded = physiologicalLoad(
      makeContext(
        makeDays(90, TODAY, (i, d) => {
          if (i === 89) {
            d.hrv_rmssd = 40;
            d.resting_hr = 62;
            d.sleep_total_min = 330;
          }
        }),
      ),
    );
    expect(loaded.value!).toBeGreaterThan(quiet.value! + 25);
    expect(loaded.value!).toBeGreaterThanOrEqual(70);
  });

  it("drops factors that are missing, renormalises, and is null under two factors", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) {
        d.hrv_rmssd = null;
        d.resting_hr = null;
        d.sleep_total_min = null;
      }
    });
    const s = physiologicalLoad(makeContext(days));
    expect(s.factors.filter((f) => f.score != null).map((f) => f.key)).toEqual(["recent_strain", "recovery_trend"]);
    expect(s.completeness).toBe(0.25);
    expect(s.value).not.toBeNull();
    const oneFactor = physiologicalLoad(
      makeContext(
        makeDays(90, TODAY, (i, d) => {
          if (i >= 87) d.day_strain = null;
          if (i === 89) {
            d.hrv_rmssd = null;
            d.resting_hr = null;
            d.sleep_total_min = null;
          }
        }),
      ),
    );
    expect(oneFactor.value).toBeNull();
  });

  it("is null on a day with no history", () => {
    expect(physiologicalLoad(makeContext(makeDays(3, TODAY))).value).toBeNull();
  });

  it("computes for an earlier day and the series aligns with the days", () => {
    const ctx = makeContext(makeDays(90, TODAY));
    const earlier = physiologicalLoad(ctx, "2026-10-15");
    expect(earlier.day).toBe("2026-10-15");
    expect(earlier.value).not.toBeNull();
    const series = loadSeries(ctx, 30);
    expect(series).toHaveLength(30);
    expect(series[series.length - 1].day).toBe(TODAY);
    expect(series.find((p) => p.day === "2026-10-15")?.value).toBe(earlier.value);
  });
});

describe("loadEngine", () => {
  it("lists every rule it can emit and stays quiet on a quiet history", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    const fs = loadEngine(makeContext(makeDays(90, TODAY)));
    for (const f of fs) {
      expect(keys.has(f.rule)).toBe(true);
      expect(f.engine).toBe("load");
    }
    expect(fs.filter((f) => f.kind === "deviation")).toHaveLength(0);
    expect(rules(fs)).not.toContain("load.elevated");
    expect(rules(fs)).not.toContain("load.accumulation");
    expect(rules(fs)).not.toContain("load.prolonged_low_recovery");
  });

  it("flags elevated load and accumulation after several loaded mornings", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) {
        d.hrv_rmssd = 42;
        d.resting_hr = 61;
        d.sleep_total_min = 340;
        d.recovery_score = 30;
      }
    });
    const fs = loadEngine(makeContext(days));
    const el = fs.find((f) => f.rule === "load.elevated");
    expect(el).toBeDefined();
    expect(["moderate", "high"]).toContain(el!.severity);
    expect(el!.value).toBeGreaterThanOrEqual(70);
    expect(el!.explanation).not.toMatch(/cortisol|anxiety|emotion/i);
    const acc = fs.find((f) => f.rule === "load.accumulation");
    expect(acc).toBeDefined();
    expect(acc!.evidence?.run).toBeGreaterThanOrEqual(3);
  });

  it("flags prolonged low recovery", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 84) d.recovery_score = 25;
    });
    const f = loadEngine(makeContext(days)).find((x) => x.rule === "load.prolonged_low_recovery");
    expect(f).toBeDefined();
    expect(f!.metric).toBe("recovery_score");
    expect(f!.evidence?.lowDays).toBeGreaterThanOrEqual(5);
  });

  it("links high load to a hard session within the previous two days", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 88) {
        d.workout_count = 1;
        d.workout_strain = 19.5;
        d.day_strain = 20;
      }
      if (i === 89) {
        d.hrv_rmssd = 42;
        d.resting_hr = 61;
        d.sleep_total_min = 340;
      }
    });
    const f = loadEngine(makeContext(days)).find((x) => x.rule === "load.after_intense_training");
    expect(f).toBeDefined();
    expect(f!.evidence?.hardDay).toBe("2026-10-31");
    expect(f!.severity).toBe("low");
  });

  it("reports improvement across a rest day", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      // Loaded on day 86, rest on 87, cleared on 88.
      if (i === 86) {
        d.hrv_rmssd = 42;
        d.resting_hr = 61;
        d.sleep_total_min = 340;
      }
      if (i === 87) {
        d.workout_count = 0;
        d.workout_min = null;
        d.workout_strain = null;
        d.day_strain = 5;
      }
      if (i === 88) {
        d.hrv_rmssd = 82;
        d.resting_hr = 49;
        d.sleep_total_min = 470;
      }
    });
    const f = loadEngine(makeContext(days)).find((x) => x.rule === "load.improvement_after_rest");
    expect(f).toBeDefined();
    expect(f!.evidence?.restDay).toBe("2026-10-30");
    expect((f!.evidence?.drop as number) >= 15).toBe(true);
    expect(f!.severity).toBe("info");
  });

  it("reports an association between the index and HRV when HRV drives it", () => {
    const days = makeDays(90, TODAY, (i, d, r) => {
      d.hrv_rmssd = Math.round(40 + r() * 60);
    });
    const fs = loadEngine(makeContext(days));
    const f = fs.find((x) => x.rule === "load.vs_hrv");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("correlation");
    expect(f!.value).toBeLessThan(-0.3);
    expect(f!.evidence?.n).toBeGreaterThanOrEqual(14);
  });

  it("respects disabled rules", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) {
        d.hrv_rmssd = 42;
        d.resting_hr = 61;
        d.sleep_total_min = 340;
      }
    });
    const fs = loadEngine(makeContext(days, { disabled: new Set(["load.elevated"]) }));
    expect(rules(fs)).not.toContain("load.elevated");
  });
});
