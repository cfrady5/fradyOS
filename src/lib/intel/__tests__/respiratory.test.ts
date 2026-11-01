import { describe, expect, it } from "vitest";
import { ENGINE_RULES, respiratoryEngine } from "../engines/respiratory";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-11-01";
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("respiratoryEngine", () => {
  it("lists every rule it can emit", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    for (const k of keys) expect(k.startsWith("respiratory.")).toBe(true);
    const fs = respiratoryEngine(makeContext(makeDays(90, TODAY)));
    for (const f of fs) expect(keys.has(f.rule)).toBe(true);
  });

  it("quiet history yields only status rules, no deviations", () => {
    const fs = respiratoryEngine(makeContext(makeDays(90, TODAY)));
    const kinds = new Set(fs.filter((f) => f.kind !== "correlation").map((f) => f.kind));
    expect(kinds).toEqual(new Set(["status"]));
    expect(rules(fs)).toContain("respiratory.resp_rate_status");
    expect(rules(fs)).toContain("respiratory.resp_rate_baseline");
    expect(rules(fs)).toContain("respiratory.spo2_status");
    for (const f of fs) {
      expect(f.engine).toBe("respiratory");
      expect(f.explanation.length).toBeGreaterThan(10);
      expect(f.nextStep.length).toBeGreaterThan(10);
      expect(f.explanation).not.toMatch(/apnoea|apnea/i);
    }
  });

  it("flags a single night well above the personal baseline", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.resp_rate = 18.5;
    });
    const fs = respiratoryEngine(makeContext(days));
    const f = fs.find((x) => x.rule === "respiratory.resp_rate_elevated");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("deviation");
    expect(f!.severity).toBe("high");
    expect(f!.value).toBe(18.5);
    expect(f!.day).toBe(TODAY);
    expect(f!.nextStep).toContain("not a diagnosis");
    // Not a safety-threshold breach.
    expect(rules(fs)).not.toContain("respiratory.resp_rate_safety");
  });

  it("flags a run above the upper quartile even when no single night is extreme", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.resp_rate = 15.3;
    });
    const fs = respiratoryEngine(makeContext(days));
    const f = fs.find((x) => x.rule === "respiratory.resp_rate_elevated");
    expect(f).toBeDefined();
    expect(f!.evidence?.run).toBe(3);
  });

  it("fires fixed safety thresholds without a ready baseline", () => {
    const days = makeDays(5, TODAY, (i, d) => {
      if (i === 4) {
        d.spo2 = 88.5;
        d.resp_rate = 25.2;
      }
    });
    const ctx = makeContext(days);
    expect(ctx.baselines.spo2.ready).toBe(false);
    const fs = respiratoryEngine(ctx);
    const spo2 = fs.find((x) => x.rule === "respiratory.spo2_safety");
    const resp = fs.find((x) => x.rule === "respiratory.resp_rate_safety");
    expect(spo2?.severity).toBe("moderate");
    expect(resp?.severity).toBe("moderate");
    expect(spo2?.nextStep).toContain("clinician");
    expect(resp?.explanation).toContain("not a diagnosis");
    // Personal rules stay silent until the baseline is ready.
    expect(rules(fs)).not.toContain("respiratory.resp_rate_elevated");
    expect(rules(fs)).not.toContain("respiratory.spo2_low");
  });

  it("detects a low SpO2 night and a downward oxygen trend", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.spo2 = 94.2;
    });
    const fs = respiratoryEngine(makeContext(days));
    expect(rules(fs)).toContain("respiratory.spo2_low");
    const t = fs.find((x) => x.rule === "respiratory.spo2_trend");
    expect(t).toBeDefined();
    expect(t!.kind).toBe("trend");
    expect(t!.baseline).toBeGreaterThan(t!.value!);
  });

  it("detects a sustained upward shift as a trend change", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 70) d.resp_rate = Math.round((d.resp_rate! + 1.6) * 10) / 10;
    });
    const fs = respiratoryEngine(makeContext(days));
    const f = fs.find((x) => x.rule === "respiratory.resp_rate_trend_change");
    expect(f).toBeDefined();
    expect(f!.title).toContain("up");
  });

  it("reports an association between prior-day strain and overnight respiratory rate with lag 1", () => {
    const days = makeDays(90, TODAY);
    for (let i = 1; i < days.length; i++) days[i].resp_rate = Math.round((13 + (days[i - 1].day_strain ?? 10) * 0.2) * 10) / 10;
    const fs = respiratoryEngine(makeContext(days));
    const f = fs.find((x) => x.rule === "respiratory.resp_rate_vs_prior_strain");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("correlation");
    expect(f!.evidence?.lag).toBe(1);
    expect(f!.evidence?.n).toBeGreaterThanOrEqual(14);
    expect(f!.value).toBeGreaterThan(0.5);
    expect(Array.isArray(f!.evidence?.ci)).toBe(true);
  });

  it("respects disabled rules", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i === 89) d.resp_rate = 18.5;
    });
    const fs = respiratoryEngine(makeContext(days, { disabled: new Set(["respiratory.resp_rate_elevated", "respiratory.resp_rate_status"]) }));
    expect(rules(fs)).not.toContain("respiratory.resp_rate_elevated");
    expect(rules(fs)).not.toContain("respiratory.resp_rate_status");
  });
});
