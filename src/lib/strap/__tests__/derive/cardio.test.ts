import { describe, expect, it } from "vitest";
import { rmssd } from "@/lib/ble/heartRate";
import { dominantBreathingFrequency, overnightHrv, respiratoryRate, restingHr, skinTempEstimate, spo2Estimate } from "../../derive/cardio";
import { detectSleep } from "../../derive/sleep";
import { PROFILE, rng, rrGenerator, scenario } from "./fixture";

const minutes = scenario();
const night = detectSleep(minutes, PROFILE).find((e) => e.kind === "main")!;

describe("overnight cardio", () => {
  it("resting heart rate is the lowest sustained 5-minute mean, inside the deep blocks", () => {
    const rhr = restingHr(night, minutes);
    expect(rhr).not.toBeNull();
    expect(rhr!).toBeGreaterThanOrEqual(48);
    expect(rhr!).toBeLessThanOrEqual(53);
  });

  it("returns no resting heart rate for a short episode", () => {
    expect(restingHr({ ...night, minutesAsleep: 30 }, minutes)).toBeNull();
  });

  it("HRV is a 5-minute RMSSD median from the injected R-R series over the last 3 hours", () => {
    const hrv = overnightHrv(night, minutes);
    expect(hrv).not.toBeNull();
    expect(hrv!).toBeGreaterThan(30);
    expect(hrv!).toBeLessThan(200);
    // Cross-check against RMSSD over the whole tail: the median of windows should sit in the same band.
    const endMs = Date.parse(night.end);
    const tail = minutes.filter((m) => Date.parse(m.minute) >= endMs - 180 * 60_000 && Date.parse(m.minute) < endMs);
    const whole = rmssd(tail.flatMap((m) => m.rr))!;
    expect(Math.abs(hrv! - whole) / whole).toBeLessThan(0.5);
  });

  it("recovers an injected 15 breaths/min modulation within 1.5", () => {
    const resp = respiratoryRate(night, minutes);
    expect(resp).not.toBeNull();
    expect(Math.abs(resp! - 15)).toBeLessThanOrEqual(1.5);
  });

  it("dominant breathing frequency tracks the modulation on a bare R-R series", () => {
    const gen = rrGenerator(rng(3), 0.2); // 12 breaths/min
    const rr: number[] = [];
    for (let i = 0; i < 5; i++) rr.push(...gen(55, [20, 30]));
    const f = dominantBreathingFrequency(rr);
    expect(f).not.toBeNull();
    expect(Math.abs(f! * 60 - 12)).toBeLessThanOrEqual(1);
    expect(dominantBreathingFrequency([900, 910])).toBeNull();
  });

  it("never invents SpO2 or skin temperature from uncalibrated channels", () => {
    const spo2 = spo2Estimate(minutes);
    expect(spo2.value).toBeNull();
    expect(spo2.reason).toMatch(/no SpO2 is estimated/i);
    const withRaw = minutes.slice(0, 3).map((m) => ({ ...m, rawSpo2: { red: 1000, ir: 2000 }, rawSkinTemp: 20000 }));
    expect(spo2Estimate(withRaw).value).toBeNull();
    expect(spo2Estimate(withRaw).reason).toMatch(/uncalibrated/);
    const temp = skinTempEstimate(withRaw);
    expect(temp.value).toBeNull();
    expect(temp.reason).toMatch(/no calibration/);
  });
});
