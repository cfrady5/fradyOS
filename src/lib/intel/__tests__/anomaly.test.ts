import { describe, expect, it } from "vitest";
import { ANOMALY_DISCLAIMER, ENGINE_RULES, RULES, anomalyEngine, detectors, evaluateMetric, metricWindow } from "../engines/anomaly";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-10-15";
const N = 120;

function byRule(rule: string, ctx = makeContext(makeDays(N, TODAY))) {
  return anomalyEngine(ctx).filter((f) => f.rule === rule);
}

describe("anomaly engine: healthy history", () => {
  it("emits nothing on a plausible healthy history", () => {
    const ctx = makeContext(makeDays(N, TODAY));
    const out = anomalyEngine(ctx);
    expect(out.map((f) => f.rule)).toEqual([]);
  });
  it("lists every rule it can emit and exports the dashboard disclaimer", () => {
    const keys = ENGINE_RULES.map((r) => r.rule);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of Object.values(RULES)) expect(keys).toContain(k);
    expect(keys.every((k) => k.startsWith("anomaly."))).toBe(true);
    expect(ANOMALY_DISCLAIMER).toMatch(/not a diagnosis/);
  });
  it("respects disabled rules", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 3) d.resting_hr = (d.resting_hr ?? 52) + 8;
    });
    const ctx = makeContext(days, { disabled: new Set([RULES.rhrHigh]) });
    expect(anomalyEngine(ctx).map((f) => f.rule)).not.toContain(RULES.rhrHigh);
  });
});

describe("detectors", () => {
  it("robustZ excludes the day under test from its history", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.resting_hr = 60;
    });
    const w = metricWindow(days, "resting_hr")!;
    expect(w.day).toBe(TODAY);
    expect(w.hist.length).toBe(89);
    expect(w.hist).not.toContain(60);
    const r = detectors.robustZ(days, "resting_hr")!;
    expect(r.method).toBe("robust_z");
    expect(r.measurement).toBe(60);
    expect(r.baseline).toBe(52);
    expect(r.z).toBeGreaterThan(4);
    expect(r.window).toBe(90);
    expect(r.samples).toBe(89);
  });
  it("rollingMedianDeviation compares with the previous seven days", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      d.resting_hr = i === N - 1 ? 58 : i >= N - 8 ? 50 : 52;
    });
    const r = detectors.rollingMedianDeviation(days, "resting_hr")!;
    expect(r.baseline).toBe(50);
    expect(r.difference).toBe(8);
    expect(r.window).toBe(7);
    expect(r.samples).toBe(7);
  });
  it("ewmaDrift reports the smoothed level and the nights on the drift side", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 5) d.spo2 = 94;
    });
    const r = detectors.ewmaDrift(days, "spo2")!;
    expect(r.measurement).toBeLessThan(96.5);
    expect(r.z).toBeLessThan(0);
    expect(Number(r.detail?.sameSideRun)).toBeGreaterThanOrEqual(5);
  });
  it("changePoint finds a sustained upward shift and dates it", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 12) d.resting_hr = (d.resting_hr ?? 52) + 6;
    });
    const r = detectors.changePoint(days, "resting_hr")!;
    expect(r.method).toBe("change_point");
    expect(r.detail?.direction).toBe("up");
    expect(Number(r.detail?.daysSince)).toBeGreaterThanOrEqual(10);
    expect(Number(r.detail?.daysSince)).toBeLessThanOrEqual(16);
    expect(r.z).toBeGreaterThan(2);
  });
  it("persistence counts consecutive days past the threshold and breaks on a normal day", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 3) d.resting_hr = (d.resting_hr ?? 52) + 8;
    });
    const r = detectors.persistence(days, "resting_hr", 2, "up")!;
    expect(r.samples).toBe(3);
    expect(r.detail?.run).toBe(3);
    const broken = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 3 && i !== N - 2) d.resting_hr = (d.resting_hr ?? 52) + 8;
    });
    expect(detectors.persistence(broken, "resting_hr", 2, "up")!.samples).toBe(1);
    expect(detectors.persistence(makeDays(N, TODAY), "resting_hr", 2, "up")).toBeNull();
  });
  it("cluster needs two concordant metrics on the same day", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) {
        d.resting_hr = (d.resting_hr ?? 52) + 8;
        d.skin_temp = (d.skin_temp ?? 33.2) + 0.6;
      }
    });
    const members = [
      { metric: "resting_hr" as const, direction: "up" as const },
      { metric: "hrv_rmssd" as const, direction: "down" as const },
      { metric: "skin_temp" as const, direction: "up" as const },
    ];
    const c = detectors.cluster(days, members, 2)!;
    expect(c.day).toBe(TODAY);
    expect(c.members.map((m) => m.metric).sort()).toEqual(["resting_hr", "skin_temp"]);
    // Discordant direction does not count: a temperature drop is not part of the cluster.
    const discordant = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) {
        d.resting_hr = (d.resting_hr ?? 52) + 8;
        d.skin_temp = (d.skin_temp ?? 33.2) - 0.6;
      }
    });
    expect(detectors.cluster(discordant, members, 2)).toBeNull();
  });
});

describe("anomaly rules", () => {
  it("119 and 128 fire on a three-day RHR rise with skin temperature up, and 128 is high with three metrics", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 3) {
        d.resting_hr = (d.resting_hr ?? 52) + 8;
        d.skin_temp = (d.skin_temp ?? 33.2) + 0.5;
      }
    });
    const ctx = makeContext(days);
    const out = anomalyEngine(ctx);
    const rules = out.map((f) => f.rule);
    expect(rules).toContain(RULES.rhrHigh);
    expect(rules).toContain(RULES.multiMetric);
    expect(rules).toContain(RULES.tempChange);
    expect(rules).not.toContain(RULES.hrvLow);

    const rhr = out.find((f) => f.rule === RULES.rhrHigh)!;
    expect(rhr.day).toBe(TODAY);
    expect(rhr.metric).toBe("resting_hr");
    expect(rhr.method).toBe("persistence");
    expect(rhr.severity).toBe("high");
    expect(rhr.value).toBe(days[N - 1].resting_hr);
    for (const k of ["measurement", "baseline", "difference", "method", "deviationLevel", "samples", "window"]) expect(rhr.evidence).toHaveProperty(k);
    expect(rhr.evidence?.samples).toBe(3);
    const agreeing = (rhr.evidence?.methodsAgreeing as { method: string }[]).map((m) => m.method);
    expect(agreeing).toContain("robust_z");
    expect(out.filter((f) => f.rule === RULES.rhrHigh).length).toBe(1);
    expect(rhr.explanation).toMatch(/3 consecutive days/);
    expect(rhr.explanation).not.toMatch(/—/);

    const cluster = out.find((f) => f.rule === RULES.multiMetric)!;
    expect(cluster.severity).toBe("moderate");
    const members = (cluster.evidence?.members as { metric: string }[]).map((m) => m.metric).sort();
    expect(members).toEqual(["resting_hr", "skin_temp"]);

    const three = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 3) {
        d.resting_hr = (d.resting_hr ?? 52) + 8;
        d.skin_temp = (d.skin_temp ?? 33.2) + 0.5;
        d.hrv_rmssd = (d.hrv_rmssd ?? 70) - 25;
      }
    });
    const c3 = anomalyEngine(makeContext(three)).find((f) => f.rule === RULES.multiMetric)!;
    expect(c3.severity).toBe("high");
    expect(c3.value).toBe(3);
  });

  it("120 picks the strongest method for a single-day HRV drop", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.hrv_rmssd = 40;
    });
    const f = byRule(RULES.hrvLow, makeContext(days))[0];
    expect(f).toBeDefined();
    expect(f.method).toBe("robust_z");
    expect(Number(f.evidence?.deviationLevel)).toBeLessThan(-2);
    expect(f.delta).toBeLessThan(0);
  });

  it("121 and 122 fire in either direction", () => {
    const up = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.resp_rate = 17.5;
    });
    const down = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.resp_rate = 11.5;
    });
    expect(byRule(RULES.respChange, makeContext(up))[0].title).toMatch(/high/);
    expect(byRule(RULES.respChange, makeContext(down))[0].title).toMatch(/low/);
    const cold = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.skin_temp = 32.2;
    });
    expect(byRule(RULES.tempChange, makeContext(cold))[0].title).toMatch(/low/);
  });

  it("123 fires on a low night and on a three-night EWMA drift", () => {
    const low = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.spo2 = 93.5;
    });
    expect(byRule(RULES.spo2Trend, makeContext(low)).length).toBe(1);
    // A mild drift: not a single-night anomaly, but five nights a little under the median move the EWMA.
    const drift = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 6) d.spo2 = 95.3;
    });
    const f = byRule(RULES.spo2Trend, makeContext(drift))[0];
    expect(f).toBeDefined();
    expect(["ewma_drift", "persistence", "robust_z"]).toContain(f.method);
    // Two nights only must not be called a drift.
    const two = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 2) d.spo2 = 95.3;
    });
    const ev = evaluateMetric(makeContext(two), "spo2", "down", { ewmaMinRun: 3 });
    expect(ev?.best.method === "ewma_drift").toBe(false);
  });

  it("124 fires on a 90-minute drop or a z past the threshold, 125 on a deficient week", () => {
    const short = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.sleep_total_min = 300;
    });
    const f = byRule(RULES.sleepSudden, makeContext(short))[0];
    expect(f).toBeDefined();
    expect(f.value).toBe(300);
    expect(f.evidence?.minuteThreshold).toBe(90);
    expect(byRule(RULES.sleepExtended, makeContext(short)).length).toBe(0);

    const week = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 7) d.sleep_total_min = (d.sleep_total_min ?? 420) - 60;
    });
    const g = byRule(RULES.sleepExtended, makeContext(week))[0];
    expect(g).toBeDefined();
    expect(g.method).toBe("rolling_mean_deficit");
    expect(g.delta).toBeLessThanOrEqual(-45);
    expect(g.evidence?.window).toBe(7);
  });

  it("126 needs persistDays consecutive days below p25", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 4) d.recovery_score = 70;
      if (i >= N - 3) d.recovery_score = 30;
    });
    const f = byRule(RULES.recoveryLow, makeContext(days))[0];
    expect(f).toBeDefined();
    expect(f.method).toBe("persistence");
    expect(f.evidence?.samples).toBe(3);
    expect(f.severity).toBe("moderate");
    expect(byRule(RULES.recoveryLow, makeContext(days, { persistDays: 4 })).length).toBe(0);
    const six = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 6) d.recovery_score = 30;
    });
    expect(byRule(RULES.recoveryLow, makeContext(six))[0].severity).toBe("high");
  });

  it("127 fires on a strain spike and on a heavy week relative to the 28-day average", () => {
    const spike = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.day_strain = 20.5;
    });
    const f = byRule(RULES.strainSudden, makeContext(spike))[0];
    expect(f).toBeDefined();
    expect(f.method).toBe("robust_z");

    const heavy = makeDays(N, TODAY, (i, d) => {
      if (i >= N - 7) d.day_strain = 19;
    });
    const g = byRule(RULES.strainSudden, makeContext(heavy))[0];
    expect(g).toBeDefined();
    expect(["acute_chronic_load", "robust_z"]).toContain(g.method);
    const ratio = Number(g.evidence?.loadRatio);
    expect(ratio).toBeGreaterThan(1.5);
  });

  it("fixed safety thresholds fire before a baseline is ready and carry the clinician note", () => {
    const days = makeDays(5, TODAY, (i, d) => {
      if (i === 4) {
        d.spo2 = 88;
        d.resting_hr = 104;
        d.resp_rate = 25;
      }
    });
    const ctx = makeContext(days);
    expect(ctx.baselines.spo2.ready).toBe(false);
    const out = anomalyEngine(ctx);
    const rules = out.map((f) => f.rule).sort();
    expect(rules).toEqual([RULES.safetyResp, RULES.safetyRhr, RULES.safetySpo2].sort());
    for (const f of out) {
      expect(f.severity).toBe("high");
      expect(f.method).toBe("fixed_threshold");
      expect(f.explanation).toMatch(/not a diagnosis/);
      expect(f.evidence?.baselineReady).toBe(false);
    }
    expect(out.find((f) => f.rule === RULES.safetySpo2)!.baseline).toBe(90);
    // No personal rule fired because the baselines are not ready.
    expect(rules).not.toContain(RULES.rhrHigh);
  });

  it("a safety crossing on a ready baseline marks the personal finding high and adds the clinician note", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 1) d.resting_hr = 102;
    });
    const out = anomalyEngine(makeContext(days));
    const personal = out.find((f) => f.rule === RULES.rhrHigh)!;
    expect(personal.severity).toBe("high");
    expect(personal.nextStep).toMatch(/clinician/);
    expect(personal.evidence?.safetyThresholdCrossed).toBe(true);
    expect(out.some((f) => f.rule === RULES.safetyRhr)).toBe(true);
  });

  it("uses the metric's last valid day when today is unscored", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i === N - 2) d.resting_hr = 62;
      if (i === N - 1) {
        d.scored = false;
        d.resting_hr = null;
      }
    });
    const f = byRule(RULES.rhrHigh, makeContext(days))[0];
    expect(f).toBeDefined();
    expect(f.day).toBe(days[N - 2].day);
  });
});
