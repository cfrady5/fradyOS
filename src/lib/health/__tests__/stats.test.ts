import { describe, expect, it } from "vitest";
import { dailySeries, deltaPct, fmtHours, mean, recoveryTone, shiftDay, summarize, windowDays, type DayStat } from "../stats";

const row = (day: string, p: Partial<DayStat> = {}): DayStat => ({ day, recovery: null, strain: null, resting_hr: null, hrv_ms: null, sleep_total_min: null, sleep_performance_pct: null, sleep_efficiency_pct: null, deep_min: null, rem_min: null, light_min: null, awake_min: null, spo2_pct: null, resp_rate: null, ...p });

describe("health stats", () => {
  it("averages, windows and shifts days", () => {
    expect(mean([1, null, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    const rows = [row("2026-03-01"), row("2026-03-04"), row("2026-03-07"), row("2026-03-08")];
    expect(windowDays(rows, "2026-03-07", 7).map((r) => r.day)).toEqual(["2026-03-01", "2026-03-04", "2026-03-07"]);
  });
  it("summarises the recent window against the baseline", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(row(shiftDay("2026-03-30", -i), { recovery: 60, hrv_ms: i < 7 ? 80 : 100, resting_hr: 50, strain: 10, sleep_total_min: 420 }));
    const s = summarize(rows, "2026-03-30");
    expect(s.latest?.day).toBe("2026-03-30");
    expect(s.staleDays).toBe(0);
    expect(s.hrv7).toBe(80);
    expect(s.hrv30).toBeCloseTo((7 * 80 + 23 * 100) / 30, 5);
    expect(s.strainWeek).toBe(70);
    expect(deltaPct(s.hrv7, s.hrv30)).toBe(-16);
    expect(s.daysTracked).toBe(30);
  });
  it("tones and formats", () => {
    expect(recoveryTone(80)).toBe("good");
    expect(recoveryTone(50)).toBe("warning");
    expect(recoveryTone(20)).toBe("serious");
    expect(recoveryTone(null)).toBe("neutral");
    expect(fmtHours(432)).toBe("7h 12m");
    expect(fmtHours(null)).toBe("–");
    const { days, byDay } = dailySeries([row("2026-03-02", { recovery: 1 })], "2026-03-03", 3);
    expect(days).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(byDay.get("2026-03-02")?.recovery).toBe(1);
  });
});
