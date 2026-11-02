import { describe, expect, it } from "vitest";
import { dayStrain, detectWorkouts, hrrFraction, hrrZone, strainFromTrimp, trimpWeight } from "../../derive/strain";
import { D1, D2, localMs, PROFILE, scenario } from "./fixture";
import type { StrapMinute } from "../../derive/types";
import { blankMinute } from "./fixture";

const minutes = scenario();
const onDay = (day: string) => minutes.filter((m) => Date.parse(m.minute) >= localMs(day, 0) && Date.parse(m.minute) < localMs(day, 24));

describe("TRIMP maths", () => {
  it("uses Banister's male weighting and clips the reserve fraction", () => {
    expect(trimpWeight(0)).toBe(0);
    expect(trimpWeight(0.5)).toBeCloseTo(0.5 * 0.64 * Math.exp(0.96), 6);
    expect(hrrFraction(200, 50, 190)).toBe(1);
    expect(hrrFraction(40, 50, 190)).toBe(0);
    expect(hrrFraction(120, 50, 190)).toBeCloseTo(0.5, 6);
    expect(hrrFraction(120, 190, 190)).toBeNull();
  });

  it("maps TRIMP onto 0..21 with K = 180 so a hard day lands in the mid-to-high teens", () => {
    expect(strainFromTrimp(0)).toBe(0);
    expect(strainFromTrimp(230)).toBeGreaterThan(14.5);
    expect(strainFromTrimp(230)).toBeLessThan(16.5);
    expect(strainFromTrimp(320)).toBeGreaterThan(16.5);
    expect(strainFromTrimp(320)).toBeLessThan(18.5);
    expect(strainFromTrimp(1e6)).toBeLessThanOrEqual(21);
  });

  it("assigns heart-rate-reserve zones", () => {
    expect(hrrZone(0.3)).toBe(0);
    expect(hrrZone(0.5)).toBe(1);
    expect(hrrZone(0.65)).toBe(2);
    expect(hrrZone(0.95)).toBe(5);
  });
});

describe("dayStrain", () => {
  it("is higher on the run day than on the rest day and stays within 0..21", () => {
    const run = dayStrain(onDay(D1), PROFILE, 50);
    const rest = dayStrain(onDay(D2), PROFILE, 50);
    expect(run.strain).not.toBeNull();
    expect(rest.strain).not.toBeNull();
    expect(run.strain!).toBeGreaterThan(rest.strain!);
    for (const s of [run, rest]) {
      expect(s.strain!).toBeGreaterThanOrEqual(0);
      expect(s.strain!).toBeLessThanOrEqual(21);
      expect(s.kcal).toBeNull();
      expect(s.rhrSource).toBe("night");
    }
    expect(run.minutesByZone.reduce((a, b) => a + b, 0) + run.restMinutes).toBe(run.contactMinutes);
    expect(run.minutesByZone[2] + run.minutesByZone[3]).toBeGreaterThanOrEqual(40); // the 45 minutes at ~150 bpm sit at ~71% HRR
    expect(run.maxHr!).toBeGreaterThanOrEqual(150);
    expect(run.avgHr!).toBeGreaterThan(55);
  });

  it("falls back to the profile hint and reports null without any resting or maximum heart rate", () => {
    const hinted = dayStrain(onDay(D2), { ...PROFILE, restingHrHint: 52 }, null);
    expect(hinted.rhrSource).toBe("profile");
    expect(hinted.strain).not.toBeNull();
    const none = dayStrain(onDay(D2), PROFILE, null);
    expect(none.strain).toBeNull();
    expect(none.rhrSource).toBe("none");
    expect(none.avgHr).not.toBeNull();
    const noMax = dayStrain(onDay(D2), { ...PROFILE, maxHr: null }, 50);
    expect(noMax.strain).toBeNull();
  });
});

describe("detectWorkouts", () => {
  it("finds the 45-minute run with its duration and intensity", () => {
    const workouts = detectWorkouts(onDay(D1), PROFILE, 50);
    expect(workouts).toHaveLength(1);
    const w = workouts[0];
    expect(w.day).toBe(D1);
    expect(w.durationMin).toBeGreaterThanOrEqual(43);
    expect(w.durationMin).toBeLessThanOrEqual(47);
    expect(Math.abs(Date.parse(w.start) - localMs(D1, 17, 0))).toBeLessThanOrEqual(2 * 60_000);
    expect(w.avgHr).toBeGreaterThanOrEqual(146);
    expect(w.avgHr).toBeLessThanOrEqual(154);
    expect(w.strain).toBeGreaterThan(5);
    expect(w.strain).toBeLessThanOrEqual(21);
    expect(w.zoneShares.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.95);
    expect(detectWorkouts(onDay(D2), PROFILE, 50)).toHaveLength(0);
  });

  it("tolerates 3-minute dips, drops short efforts and merges efforts 5 minutes apart", () => {
    const start = localMs(D1, 9, 0);
    const mk = (i: number, hr: number): StrapMinute => ({ ...blankMinute(start + i * 60_000), hrAvg: hr, hrMin: hr, hrMax: hr, skinContact: 1, samples: 60, motion: 0.5 });
    const series: StrapMinute[] = [];
    for (let i = 0; i < 15; i++) series.push(mk(i, 150)); // 0..14 hot
    for (let i = 15; i < 18; i++) series.push(mk(i, 90)); // 3-minute dip, tolerated
    for (let i = 18; i < 30; i++) series.push(mk(i, 150)); // 18..29 hot: one run 0..29
    for (let i = 30; i < 35; i++) series.push(mk(i, 90)); // 5-minute gap
    for (let i = 35; i < 47; i++) series.push(mk(i, 150)); // merged into the first
    for (let i = 47; i < 70; i++) series.push(mk(i, 80)); // long rest
    for (let i = 70; i < 76; i++) series.push(mk(i, 150)); // 6 minutes: too short
    for (let i = 76; i < 90; i++) series.push(mk(i, 80));
    const out = detectWorkouts(series, PROFILE, 50);
    expect(out).toHaveLength(1);
    expect(out[0].durationMin).toBe(47);
  });

  it("returns nothing without a resting or maximum heart rate", () => {
    expect(detectWorkouts(onDay(D1), { ...PROFILE, maxHr: null }, 50)).toEqual([]);
    expect(detectWorkouts(onDay(D1), PROFILE, null)).toEqual([]);
  });
});
