import { describe, expect, it } from "vitest";
import { ENGINE_RULES, deviationPanel, temperatureEngine } from "../engines/temperature";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-11-01";
const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);

describe("temperatureEngine", () => {
  it("lists every rule it can emit", () => {
    const keys = new Set(ENGINE_RULES.map((r) => r.rule));
    expect(keys.size).toBe(ENGINE_RULES.length);
    for (const k of keys) expect(k.startsWith("temperature.")).toBe(true);
    const fs = temperatureEngine(makeContext(makeDays(90, TODAY)));
    for (const f of fs) expect(keys.has(f.rule)).toBe(true);
  });

  it("quiet history yields only status rules", () => {
    const fs = temperatureEngine(makeContext(makeDays(90, TODAY)));
    const kinds = new Set(fs.filter((f) => f.kind !== "correlation").map((f) => f.kind));
    expect(kinds).toEqual(new Set(["status"]));
    expect(rules(fs)).toContain("temperature.skin_temp_status");
    expect(rules(fs)).toContain("temperature.skin_temp_baseline");
    for (const f of fs) expect(f.explanation).not.toMatch(/infection|illness is confirmed/i);
  });

  it("flags a deviation in either direction", () => {
    const up = temperatureEngine(makeContext(makeDays(90, TODAY, (i, d) => void (i === 89 && (d.skin_temp = 34.4)))));
    const down = temperatureEngine(makeContext(makeDays(90, TODAY, (i, d) => void (i === 89 && (d.skin_temp = 32.0)))));
    expect(up.find((f) => f.rule === "temperature.skin_temp_deviation")?.title).toContain("above");
    expect(down.find((f) => f.rule === "temperature.skin_temp_deviation")?.title).toContain("below");
  });

  it("flags consecutive elevated and reduced runs", () => {
    const hot = makeDays(90, TODAY, (i, d) => {
      if (i >= 86) d.skin_temp = 33.7;
    });
    const cold = makeDays(90, TODAY, (i, d) => {
      if (i >= 87) d.skin_temp = 32.7;
    });
    const h = temperatureEngine(makeContext(hot)).find((f) => f.rule === "temperature.skin_temp_elevated_run");
    const c = temperatureEngine(makeContext(cold)).find((f) => f.rule === "temperature.skin_temp_reduced_run");
    expect(h?.evidence?.run).toBe(4);
    expect(h?.kind).toBe("pattern");
    expect(c?.evidence?.run).toBe(3);
    expect(c?.severity).toBe("low");
  });

  it("flags increased variability this week", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 83) d.skin_temp = i % 2 ? 33.9 : 32.6;
    });
    const f = temperatureEngine(makeContext(days)).find((x) => x.rule === "temperature.skin_temp_variability");
    expect(f).toBeDefined();
    expect(f!.value).toBeGreaterThan(f!.baseline!);
  });

  it("detects a level shift as a trend change", () => {
    const days = makeDays(90, TODAY, (i, d) => {
      if (i >= 72) d.skin_temp = Math.round((d.skin_temp! + 0.6) * 100) / 100;
    });
    const f = temperatureEngine(makeContext(days)).find((x) => x.rule === "temperature.skin_temp_trend_change");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("trend");
  });

  it("reports an association with resting heart rate", () => {
    const days = makeDays(90, TODAY);
    for (const d of days) d.skin_temp = Math.round((30 + (d.resting_hr ?? 52) * 0.06) * 100) / 100;
    const f = temperatureEngine(makeContext(days)).find((x) => x.rule === "temperature.skin_temp_vs_resting_hr");
    expect(f).toBeDefined();
    expect(f!.kind).toBe("correlation");
    expect(f!.value).toBeGreaterThan(0.5);
    expect(f!.evidence?.n).toBeGreaterThanOrEqual(14);
  });

  describe("deviationPanel and multi-metric deviation", () => {
    it("returns four rows with direction and readiness", () => {
      const panel = deviationPanel(makeContext(makeDays(90, TODAY)));
      expect(panel.map((r) => r.metric)).toEqual(["skin_temp", "resting_hr", "hrv_rmssd", "resp_rate"]);
      for (const r of panel) {
        expect(r.ready).toBe(true);
        expect(r.value).not.toBeNull();
        expect(r.z).not.toBeNull();
        expect(["up", "down", "flat"]).toContain(r.direction);
      }
    });

    it("reports not ready on a short history", () => {
      const panel = deviationPanel(makeContext(makeDays(5, TODAY)));
      for (const r of panel) {
        expect(r.ready).toBe(false);
        expect(r.z).toBeNull();
        expect(r.direction).toBeNull();
      }
    });

    it("fires a high multi-metric finding when temp, RHR and HRV move together", () => {
      const days = makeDays(90, TODAY, (i, d) => {
        if (i === 89) {
          d.skin_temp = 34.3;
          d.resting_hr = 62;
          d.hrv_rmssd = 40;
        }
      });
      const fs = temperatureEngine(makeContext(days));
      const f = fs.find((x) => x.rule === "temperature.multi_metric_deviation");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("high");
      expect(f!.title).toBe("Several overnight measures deviate together");
      expect(f!.value).toBeGreaterThanOrEqual(3);
      expect(f!.nextStep).toContain("not a diagnosis");
      expect(f!.explanation).not.toMatch(/confirmed/i);
    });

    it("does not fire when the deviations are discordant", () => {
      // Temperature up but HRV also up: not the concordant pattern.
      const days = makeDays(90, TODAY, (i, d) => {
        if (i === 89) {
          d.skin_temp = 34.3;
          d.hrv_rmssd = 110;
        }
      });
      const fs = temperatureEngine(makeContext(days));
      expect(rules(fs)).not.toContain("temperature.multi_metric_deviation");
    });
  });
});
