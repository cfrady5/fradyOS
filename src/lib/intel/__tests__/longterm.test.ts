import { describe, expect, it } from "vitest";
import { ENGINE_RULES, healthTrend, longTermSeries, longtermEngine } from "../engines/longterm";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-11-01";
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("longtermEngine", () => {
  it("lists every rule it can emit", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    for (const k of keys) expect(k.startsWith("longterm.")).toBe(true);
    const fs = longtermEngine(makeContext(makeDays(120, TODAY)));
    for (const f of fs) expect(keys.has(f.rule)).toBe(true);
  });

  it("quiet history produces stability statuses and a summary with no material movement", () => {
    const fs = longtermEngine(makeContext(makeDays(120, TODAY)));
    expect(fs.filter((f) => f.kind === "deviation")).toHaveLength(0);
    expect(rules(fs)).not.toContain("longterm.rhr_improvement");
    expect(rules(fs)).not.toContain("longterm.hrv_improvement");
    expect(fs.find((f) => f.rule === "longterm.respiratory_stability")?.title).toContain("stable");
    expect(fs.find((f) => f.rule === "longterm.skin_temp_stability")?.title).toContain("stable");
    const summary = fs.find((f) => f.rule === "longterm.multi_month_summary");
    expect(summary).toBeDefined();
    expect(summary!.kind).toBe("trend");
    expect(summary!.severity).toBe("info");
    expect(summary!.value).toBe(0);
  });

  it("detects resting heart rate and HRV improvement over 90 days", () => {
    const days = makeDays(100, TODAY, (i, d) => {
      d.resting_hr = Math.round(56 - i * 0.05 + ((i * 7) % 3) - 1);
      d.hrv_rmssd = Math.round(60 + i * 0.15 + ((i * 5) % 5) - 2);
    });
    const fs = longtermEngine(makeContext(days));
    const rhr = fs.find((f) => f.rule === "longterm.rhr_improvement");
    const hrv = fs.find((f) => f.rule === "longterm.hrv_improvement");
    expect(rhr).toBeDefined();
    expect(rhr!.kind).toBe("trend");
    expect(rhr!.severity).toBe("info");
    expect(rhr!.value).toBeLessThan(rhr!.baseline!);
    expect(hrv).toBeDefined();
    expect(hrv!.value).toBeGreaterThan(hrv!.baseline!);
    const summary = fs.find((f) => f.rule === "longterm.multi_month_summary")!;
    expect(summary.value).toBeGreaterThanOrEqual(2);
    expect(summary.explanation).toMatch(/resting heart rate down/i);
    expect(summary.explanation).toMatch(/hrv up/i);
  });

  it("detects sleep consistency, efficiency and strain changes in either direction", () => {
    const days = makeDays(100, TODAY, (i, d) => {
      d.sleep_consistency = Math.round(70 + i * 0.15);
      d.sleep_efficiency = Math.round(94 - i * 0.06);
      d.day_strain = Math.round((8 + i * 0.05) * 10) / 10;
    });
    const fs = longtermEngine(makeContext(days));
    expect(fs.find((f) => f.rule === "longterm.sleep_consistency_change")?.title).toContain("up");
    expect(fs.find((f) => f.rule === "longterm.sleep_efficiency_change")?.title).toContain("down");
    expect(fs.find((f) => f.rule === "longterm.cardiovascular_load_change")?.title).toContain("up");
  });

  it("detects a consistency change in recovery and activity", () => {
    const days = makeDays(180, TODAY, (i, d) => {
      // Steady for the first 90 days, then swinging hard between extremes.
      d.recovery_score = i < 90 ? 60 + (i % 5) : i % 2 ? 95 : 20;
      d.day_strain = i < 90 ? 10 + (i % 3) : i % 2 ? 19 : 2;
    });
    const fs = longtermEngine(makeContext(days));
    expect(fs.find((f) => f.rule === "longterm.recovery_consistency")?.title).toContain("less consistent");
    expect(fs.find((f) => f.rule === "longterm.activity_consistency")?.title).toContain("less consistent");
  });

  it("reports an unstable respiratory series", () => {
    const days = makeDays(100, TODAY, (i, d) => {
      d.resp_rate = i % 2 ? 17 : 12;
    });
    const f = longtermEngine(makeContext(days)).find((x) => x.rule === "longterm.respiratory_stability");
    expect(f?.title).toContain("varied");
  });
});

describe("healthTrend", () => {
  it("is labelled experimental, versioned and near 50 on a flat history", () => {
    const s = healthTrend(makeContext(makeDays(120, TODAY)));
    expect(s.key).toBe("health_trend");
    expect(s.version).toBe("trend.v1");
    expect(s.note).toContain("experimental");
    expect(s.note).toContain("not a biological age");
    expect(s.value).not.toBeNull();
    expect(Math.abs(s.value! - 50)).toBeLessThan(15);
    expect(s.factors.map((f) => f.key)).toEqual(["resting_hr", "hrv_rmssd", "sleep_consistency", "sleep_efficiency", "recovery_score", "activity_consistency"]);
    const included = s.factors.filter((f) => f.score != null);
    expect(included.length).toBeGreaterThanOrEqual(3);
    expect(included.reduce((a, f) => a + f.weight, 0)).toBeCloseTo(100, 0);
  });

  it("is null before 60 scored days", () => {
    const s = healthTrend(makeContext(makeDays(45, TODAY)));
    expect(s.value).toBeNull();
    expect(s.note).toContain("60");
    for (const f of s.factors) expect(f.score).toBeNull();
  });

  it("moves above 50 when the measures improve and below when they worsen", () => {
    const better = healthTrend(
      makeContext(
        makeDays(100, TODAY, (i, d) => {
          d.resting_hr = Math.round(58 - i * 0.08);
          d.hrv_rmssd = Math.round(55 + i * 0.3);
          d.sleep_consistency = Math.round(60 + i * 0.3);
          d.sleep_efficiency = Math.round(84 + i * 0.1);
          d.recovery_score = Math.round(45 + i * 0.4);
        }),
      ),
    );
    const worse = healthTrend(
      makeContext(
        makeDays(100, TODAY, (i, d) => {
          d.resting_hr = Math.round(48 + i * 0.08);
          d.hrv_rmssd = Math.round(85 - i * 0.3);
          d.sleep_consistency = Math.round(90 - i * 0.3);
          d.sleep_efficiency = Math.round(94 - i * 0.1);
          d.recovery_score = Math.round(85 - i * 0.4);
        }),
      ),
    );
    expect(better.value!).toBeGreaterThan(70);
    expect(worse.value!).toBeLessThan(30);
    expect(better.factors.find((f) => f.key === "resting_hr")!.score!).toBeGreaterThan(50);
    expect(worse.factors.find((f) => f.key === "resting_hr")!.score!).toBeLessThan(50);
  });

  it("can be computed for an earlier day", () => {
    const ctx = makeContext(makeDays(120, TODAY));
    const s = healthTrend(ctx, "2026-10-01");
    expect(s.day).toBe("2026-10-01");
    expect(s.value).not.toBeNull();
  });
});

describe("longTermSeries", () => {
  it("returns monthly means and 90-day slopes per metric", () => {
    const out = longTermSeries(makeContext(makeDays(120, TODAY)));
    const rhr = out.find((s) => s.metric === "resting_hr")!;
    expect(rhr.monthly.length).toBeGreaterThanOrEqual(4);
    expect(rhr.monthly[0].month < rhr.monthly[rhr.monthly.length - 1].month).toBe(true);
    expect(rhr.monthly[rhr.monthly.length - 1].month).toBe("2026-11");
    expect(rhr.monthly[rhr.monthly.length - 1].n).toBe(1);
    for (const m of rhr.monthly) expect(m.mean).not.toBeNull();
    expect(rhr.slope90).not.toBeNull();
  });

  it("skips unscored days without inventing a value", () => {
    const days = makeDays(40, TODAY, (i, d) => {
      if (i < 10) d.scored = false;
    });
    const out = longTermSeries(makeContext(days));
    const rhr = out.find((s) => s.metric === "resting_hr")!;
    const total = rhr.monthly.reduce((a, m) => a + m.n, 0);
    expect(total).toBe(30);
  });
});
