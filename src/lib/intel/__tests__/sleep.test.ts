import { describe, expect, it } from "vitest";
import { ENGINE_RULES, SQI_VERSION, sensitivityReport, sleepEngine, sleepQualityIndex } from "../engines/sleep";
import type { DailySummary, Finding } from "../types";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-10-31";
const byRule = (fs: Finding[], rule: string) => fs.filter((f) => f.rule === rule);
const one = (fs: Finding[], rule: string) => {
  const m = byRule(fs, rule);
  expect(m.length, `expected one ${rule}`).toBe(1);
  return m[0];
};
const sevRank = { info: 0, low: 1, moderate: 2, high: 3 } as const;

/** A quiet history with tighter sleep noise than the default fixture, so no deviation should fire. */
function quietDays(n = 120, shape?: (i: number, d: DailySummary, r: () => number) => void) {
  return makeDays(
    n,
    TODAY,
    (i, d, r) => {
      d.sleep_total_min = 430 + Math.round((r() - 0.5) * 30);
      d.in_bed_min = d.sleep_total_min + 35;
      d.light_min = Math.round(d.sleep_total_min * 0.5);
      d.deep_min = Math.round(d.sleep_total_min * 0.22);
      d.rem_min = Math.round(d.sleep_total_min * 0.28);
      d.sleep_performance = Math.round((d.sleep_total_min / 480) * 100);
      d.sleep_debt_min = Math.max(0, 480 - d.sleep_total_min);
      shape?.(i, d, r);
    },
    11,
  );
}

describe("sleep engine contract", () => {
  it("emits only rules listed in ENGINE_RULES, all namespaced and well formed", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    for (const k of keys) expect(k).toMatch(/^sleep\.[a-z_]+$/);
    const findings = sleepEngine(makeContext(makeDays(120, TODAY)));
    for (const f of findings) {
      expect(keys.has(f.rule), f.rule).toBe(true);
      expect(f.engine).toBe("sleep");
      expect(f.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.method.length).toBeGreaterThan(5);
      expect(f.explanation).not.toContain("—");
      expect(f.nextStep.length).toBeGreaterThan(5);
      expect(f.completeness).toBeGreaterThanOrEqual(0);
      expect(f.completeness).toBeLessThanOrEqual(1);
    }
  });

  it("is pure: the same context yields the same findings", () => {
    const ctx = makeContext(makeDays(100, TODAY));
    expect(sleepEngine(ctx)).toEqual(sleepEngine(ctx));
  });

  it("returns nothing for an empty history", () => {
    const ctx = makeContext(makeDays(1, TODAY));
    ctx.days = [];
    expect(sleepEngine(ctx)).toEqual([]);
  });

  it("skips disabled rules", () => {
    const ctx = makeContext(quietDays(), { disabled: new Set(["sleep.total_status", "sleep.performance_status"]) });
    const fs = sleepEngine(ctx);
    expect(byRule(fs, "sleep.total_status")).toHaveLength(0);
    expect(byRule(fs, "sleep.performance_status")).toHaveLength(0);
    expect(byRule(fs, "sleep.consistency_status")).toHaveLength(1);
  });
});

describe("quiet history", () => {
  const fs = sleepEngine(makeContext(quietDays()));

  it("reports status rules at info", () => {
    for (const rule of ["sleep.total_status", "sleep.schedule_status", "sleep.consistency_status", "sleep.debt_status", "sleep.need_vs_actual", "sleep.performance_status"]) {
      const f = one(fs, rule);
      expect(f.kind).toBe("status");
      expect(f.day).toBe(TODAY);
    }
    expect(one(fs, "sleep.total_status").explanation).toMatch(/against an estimated need of 8h 0m/);
    expect(one(fs, "sleep.schedule_status").title).toMatch(/^Asleep 1[01]:\d\d PM, awake 6:\d\d AM$/);
  });

  it("raises no deviation, restriction or trend at moderate or above", () => {
    const loud = fs.filter((f) => sevRank[f.severity] >= sevRank.moderate);
    expect(loud.map((f) => f.rule)).toEqual([]);
    for (const rule of ["sleep.multi_night_restriction", "sleep.late_onset", "sleep.stage_shift", "sleep.respiratory_trend", "sleep.schedule_variability", "sleep.night_variability", "sleep.nap_frequency", "sleep.disturbances_deviation", "sleep.weekend_pattern"]) {
      expect(byRule(fs, rule), rule).toHaveLength(0);
    }
  });

  it("keeps the weekly debt below moderate when the nightly shortfall is under an hour", () => {
    const debt = one(fs, "sleep.debt_accumulated");
    expect(sevRank[debt.severity]).toBeLessThanOrEqual(sevRank.low);
    expect(debt.evidence?.perNight).toBeLessThan(60);
    expect(debt.explanation).toMatch(/a night\./);
  });
});

describe("restriction and debt", () => {
  const days = quietDays(120, (i, d) => {
    if (i >= 116) {
      d.sleep_total_min = 300;
      d.in_bed_min = 335;
      d.light_min = 150;
      d.deep_min = 66;
      d.rem_min = 84;
      d.sleep_debt_min = 180;
      d.sleep_performance = 63;
    }
  });
  const fs = sleepEngine(makeContext(days));

  it("flags four consecutive short nights", () => {
    const f = one(fs, "sleep.multi_night_restriction");
    expect(f.kind).toBe("pattern");
    expect(f.evidence?.nights).toBe(4);
    expect(f.severity).toBe("low");
    expect(f.value).toBe(300);
    expect(f.day).toBe(TODAY);
    expect(f.method).toMatch(/85% of the strap's estimated need/);
  });

  it("accumulates a week of debt against need", () => {
    const f = one(fs, "sleep.debt_accumulated");
    expect(f.severity).toBe("high");
    expect(f.value).toBeGreaterThanOrEqual(4 * 180);
    expect(f.evidence?.needKnown).toBe(true);
    expect(f.evidence?.nights).toBe(7);
  });

  it("flags total sleep as a high deviation and need shortfall as low", () => {
    const dev = one(fs, "sleep.total_deviation");
    expect(dev.severity).toBe("high");
    expect(dev.delta).toBeLessThan(-100);
    expect(dev.title).toBe("Total sleep shorter than usual");
    expect(one(fs, "sleep.need_vs_actual").severity).toBe("low");
  });

  it("reports recovery in the context of the short night", () => {
    const f = one(fs, "sleep.recovery_after_short_sleep");
    expect(f.metric).toBe("recovery_score");
    expect(f.day).toBe(TODAY);
  });

  it("uses the personal lower quartile when need is unknown", () => {
    const noNeed = days.map((d) => ({ ...d, sleep_need_min: null, sleep_debt_min: null }));
    const fs2 = sleepEngine(makeContext(noNeed));
    const f = one(fs2, "sleep.multi_night_restriction");
    expect(f.method).toMatch(/25th percentile/);
    const debt = one(fs2, "sleep.debt_accumulated");
    expect(debt.evidence?.needKnown).toBe(false);
    expect(debt.method).toMatch(/30-day median/);
    expect(byRule(fs2, "sleep.need_vs_actual")).toHaveLength(0);
    expect(byRule(fs2, "sleep.debt_status")).toHaveLength(0);
  });
});

describe("timing rules", () => {
  it("late onset fires when bedtime is more than an hour after the median", () => {
    const days = quietDays(90, (i, d) => {
      if (i === 89) d.sleep_onset_min = 670 + 95;
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.late_onset");
    expect(f.severity).toBe("low");
    expect(f.explanation).toMatch(/You fell asleep at 12:\d\d AM/);
    expect(f.evidence?.lateMin).toBeGreaterThan(60);
  });

  it("schedule variability compares the week's SD with 90 days", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 113) d.sleep_onset_min = 670 + (i % 2 ? 120 : -120);
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.schedule_variability");
    expect(f.metric).toBe("sleep_onset_min");
    expect(f.severity).toBe("moderate");
    expect(f.value).toBeGreaterThan(f.baseline!);
  });

  it("night-to-night variability fires on alternating long and short nights", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 113) d.sleep_total_min = i % 2 ? 540 : 330;
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.night_variability");
    expect(f.kind).toBe("pattern");
    expect(f.value).toBeGreaterThan(90);
  });

  it("weekend pattern needs four weekends and finds a longer, later weekend", () => {
    const days = quietDays(120, (i, d) => {
      const dow = new Date(Date.parse(`${d.day}T00:00:00Z`)).getUTCDay();
      if (dow === 0 || dow === 6) {
        d.sleep_total_min = d.sleep_total_min! + 70;
        d.sleep_onset_min = d.sleep_onset_min! + 75;
      }
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.weekend_pattern");
    expect(f.severity).toBe("info");
    expect(f.evidence?.totalDiff).toBeGreaterThan(50);
    expect(f.evidence?.onsetDiff).toBeGreaterThan(50);
    expect(f.explanation).toMatch(/longer on Saturday and Sunday/);
    expect(f.explanation).toMatch(/later/);
    // Too little history: under four weekends must stay silent.
    const short = quietDays(20, (i, d) => {
      const dow = new Date(Date.parse(`${d.day}T00:00:00Z`)).getUTCDay();
      if (dow === 0 || dow === 6) d.sleep_total_min = d.sleep_total_min! + 70;
    });
    expect(byRule(sleepEngine(makeContext(short)), "sleep.weekend_pattern")).toHaveLength(0);
  });
});

describe("stages and disruption", () => {
  it("stage shift and share deviation fire when deep share drops for a week", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 113) {
        d.deep_min = Math.round(d.sleep_total_min! * 0.1);
        d.light_min = Math.round(d.sleep_total_min! * 0.62);
      }
    });
    const fs = sleepEngine(makeContext(days));
    const shift = one(fs, "sleep.stage_shift");
    expect(shift.metric).toBe("deep_min");
    expect(shift.title).toMatch(/Deep sleep share lower/);
    expect(shift.severity).toBe("moderate");
    expect(shift.explanation).toMatch(/strap's estimates/);
    expect(one(fs, "sleep.deep_share_deviation").severity).toBe("high");
    expect(one(fs, "sleep.deep_deviation").severity).toBe("high");
    expect(one(fs, "sleep.restorative_share_deviation").severity).toBe("high");
  });

  it("disturbances rules stay silent without the API field and fire with it", () => {
    const base = quietDays(90);
    const fs0 = sleepEngine(makeContext(base));
    expect(byRule(fs0, "sleep.disturbances_deviation")).toHaveLength(0);
    const withDist = quietDays(90, (i, d, r) => {
      d.disturbances = Math.round(4 + r() * 3);
      if (i === 89) d.disturbances = 15;
    });
    const f = one(sleepEngine(makeContext(withDist)), "sleep.disturbances_deviation");
    expect(f.severity).toBe("high");
    expect(f.title).toBe("Disturbances more than usual");
  });

  it("awake deviation and a rising disruption trend", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 90) d.awake_min = 30 + (i - 90) * 2;
    });
    const fs = sleepEngine(makeContext(days));
    const trend = one(fs, "sleep.disruption_trend");
    expect(trend.metric).toBe("awake_min");
    expect(trend.severity).not.toBe("info");
    expect(trend.title).toMatch(/rising/);
    expect(one(fs, "sleep.awake_deviation").severity).toBe("high");
  });

  it("disruption trend prefers disturbances when the API supplies them", () => {
    const days = quietDays(120, (i, d) => {
      d.disturbances = i >= 90 ? 3 + Math.round((i - 90) / 5) : 3;
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.disruption_trend");
    expect(f.metric).toBe("disturbances");
  });
});

describe("cross rules", () => {
  it("recovery by need uses Welch with five per group", () => {
    const days = quietDays(120, (i, d) => {
      const met = i % 2 === 0;
      d.sleep_total_min = met ? 500 : 400;
      d.recovery_score = met ? 80 + (i % 5) : 50 + (i % 5);
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.recovery_by_need");
    expect(f.kind).toBe("pattern");
    expect(f.evidence?.nA).toBeGreaterThanOrEqual(5);
    expect(f.evidence?.nB).toBeGreaterThanOrEqual(5);
    expect(f.evidence?.diff).toBeGreaterThan(20);
    expect(f.title).toMatch(/higher after you meet/);
  });

  it("sleep versus strain pairs each night with the strain of the day it preceded", () => {
    const days = quietDays(120, (i, d) => {
      d.sleep_total_min = 380 + (i % 7) * 15;
      d.day_strain = 6 + (d.sleep_total_min - 380) / 15 + (i % 3) * 0.4; // same row: the night ending on day t and day t's strain
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.strain_next_day");
    expect(f.kind).toBe("correlation");
    expect(f.evidence?.n).toBeGreaterThanOrEqual(14);
    expect(f.evidence?.r).toBeGreaterThan(0.9);
    expect(f.evidence?.ci).toHaveLength(2);
    expect(f.title).toMatch(/higher next-day strain/);
  });

  it("sleep versus strain is silent for a weak association", () => {
    const fs = sleepEngine(makeContext(quietDays()));
    expect(byRule(fs, "sleep.strain_next_day")).toHaveLength(0);
  });

  it("respiratory trend fires on three raised nights and defers to a clinician", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 117) d.resp_rate = 16.4;
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.respiratory_trend");
    expect(f.title).toBe("Unusual overnight respiratory trend");
    expect(f.explanation).toMatch(/unusual overnight respiratory trend/);
    expect(f.explanation).not.toMatch(/apn|snor/i);
    expect(f.nextStep).toMatch(/not a diagnosis/);
    expect(f.severity).not.toBe("info");
  });
});

describe("naps", () => {
  it("nap frequency fires when the week has more naps than the 90-day rate", () => {
    const days = quietDays(120, (i, d) => {
      if (i >= 115) {
        d.nap_count = 1;
        d.nap_min = 30;
      }
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.nap_frequency");
    expect(f.value).toBe(5);
    expect(f.severity).toBe("moderate");
  });

  it("nap duration deviates against the personal nap history", () => {
    const days = quietDays(120, (i, d) => {
      if (i % 4 === 0) {
        d.nap_count = 1;
        d.nap_min = 25 + (i % 3) * 2;
      }
      if (i === 119) {
        d.nap_count = 1;
        d.nap_min = 110;
      }
    });
    const f = one(sleepEngine(makeContext(days)), "sleep.nap_duration");
    expect(f.severity).toBe("high");
    expect(f.title).toBe("Nap longer than usual");
  });
});

describe("sleep quality index", () => {
  it("scores a complete good night near 100 and a poor one low", () => {
    const good = quietDays(60, (i, d) => {
      if (i === 59) {
        d.sleep_total_min = 490;
        d.sleep_efficiency = 95;
        d.sleep_consistency = 92;
        d.deep_min = 120;
        d.rem_min = 130;
        d.awake_min = 15;
      }
    });
    const g = sleepQualityIndex(makeContext(good));
    expect(g.version).toBe(SQI_VERSION);
    expect(g.key).toBe("sleep_quality_index");
    expect(g.day).toBe(TODAY);
    expect(g.factors.map((f) => f.weight)).toEqual([35, 20, 15, 20, 10]);
    expect(g.value).toBeGreaterThanOrEqual(95);
    expect(g.completeness).toBe(1);
    expect(g.note).toMatch(/FRADY's own/);
    expect(g.note).toMatch(/not EEG/);

    const poor = quietDays(60, (i, d) => {
      if (i === 59) {
        d.sleep_total_min = 280;
        d.sleep_efficiency = 74;
        d.sleep_consistency = 20;
        d.deep_min = 40;
        d.rem_min = 50;
        d.awake_min = 80;
      }
    });
    const p = sleepQualityIndex(makeContext(poor));
    expect(p.value).toBeLessThan(10);
  });

  it("sufficiency falls back to the 30-day median and is linear to zero at 60% of the reference", () => {
    const days = quietDays(60, (i, d) => {
      d.sleep_need_min = null;
      if (i === 59) d.sleep_total_min = Math.round(430 * 0.8);
    });
    const s = sleepQualityIndex(makeContext(days));
    const suff = s.factors.find((f) => f.key === "sufficiency")!;
    expect(suff.detail).toMatch(/30-day median/);
    expect(suff.score).toBeGreaterThan(40);
    expect(suff.score).toBeLessThan(60);
  });

  it("drops missing factors, reweights, and returns null under two factors", () => {
    const days = quietDays(60, (i, d) => {
      if (i === 59) {
        d.sleep_efficiency = null;
        d.deep_min = null;
        d.awake_min = null;
        d.disturbances = null;
      }
    });
    const s = sleepQualityIndex(makeContext(days));
    expect(s.factors.filter((f) => f.score != null).map((f) => f.key)).toEqual(["sufficiency", "consistency"]);
    expect(s.completeness).toBe(0.5);
    expect(s.value).not.toBeNull();

    const one = quietDays(60, (i, d) => {
      if (i === 59) {
        d.sleep_efficiency = null;
        d.deep_min = null;
        d.awake_min = null;
        d.sleep_consistency = null;
        d.sleep_onset_min = null;
      }
    });
    // Onset is missing for the night, but the previous six bedtimes still give a consistency estimate.
    const s1 = sleepQualityIndex(makeContext(one));
    expect(s1.factors.find((f) => f.key === "consistency")!.detail).toMatch(/Bedtime SD/);
    const two = one.map((d, i) => (i >= 53 ? { ...d, sleep_onset_min: null } : d));
    const s2 = sleepQualityIndex(makeContext(two));
    expect(s2.factors.filter((f) => f.score != null)).toHaveLength(1);
    expect(s2.value).toBeNull();
  });

  it("prefers the disturbance count over awake minutes when present", () => {
    const days = quietDays(30, (i, d) => {
      if (i === 29) {
        d.disturbances = 2;
        d.awake_min = 75;
      }
    });
    const s = sleepQualityIndex(makeContext(days));
    expect(s.factors.find((f) => f.key === "disturbances")!.score).toBe(100);
  });

  it("scores a named day and returns an empty score for an unknown day", () => {
    const ctx = makeContext(quietDays(30));
    const named = sleepQualityIndex(ctx, ctx.days[10].day);
    expect(named.day).toBe(ctx.days[10].day);
    expect(named.value).not.toBeNull();
    const missing = sleepQualityIndex(ctx, "1999-01-01");
    expect(missing.value).toBeNull();
    expect(missing.factors).toEqual([]);
    expect(missing.day).toBe("1999-01-01");
  });

  it("sensitivity report scores every night and tracks performance", () => {
    const rep = sensitivityReport(makeDays(120, TODAY));
    expect(rep.nights).toBe(120);
    expect(rep.mean).toBeGreaterThan(0);
    expect(rep.sd).toBeGreaterThan(0);
    expect(rep.spearmanWithPerformance).toBeGreaterThan(0.5);
    const empty = sensitivityReport([]);
    expect(empty).toEqual({ nights: 0, mean: null, sd: null, spearmanWithPerformance: null });
  });
});
