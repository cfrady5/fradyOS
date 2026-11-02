import { describe, expect, it } from "vitest";
import { detectSleep, METHOD_NOTE } from "../../derive/sleep";
import { D0, D1, D2, localMs, PROFILE, scenario } from "./fixture";

const minutes = scenario();
const episodes = detectSleep(minutes, PROFILE);
const mains = episodes.filter((e) => e.kind === "main");
const naps = episodes.filter((e) => e.nap);

const diffMin = (iso: string, ms: number) => Math.abs(Date.parse(iso) - ms) / 60_000;

describe("detectSleep", () => {
  it("finds both nights and the afternoon nap, nothing else", () => {
    expect(mains).toHaveLength(2);
    expect(naps).toHaveLength(1);
    expect(episodes.filter((e) => e.kind === "fragment")).toHaveLength(0);
  });

  it("places onset and wake of the first night within 10 minutes and assigns the wake day", () => {
    const night = mains[0];
    expect(night.day).toBe(D1);
    expect(diffMin(night.start, localMs(D0, 23, 0))).toBeLessThanOrEqual(10);
    expect(diffMin(night.end, localMs(D1, 6, 40))).toBeLessThanOrEqual(10);
    expect(night.onsetMin).toBeGreaterThanOrEqual(650);
    expect(night.onsetMin).toBeLessThanOrEqual(670);
    expect(night.wakeMin).toBeGreaterThanOrEqual(1110);
    expect(night.wakeMin).toBeLessThanOrEqual(1130);
    expect(mains[1].day).toBe(D2);
    expect(diffMin(mains[1].start, localMs(D1, 23, 10))).toBeLessThanOrEqual(10);
    expect(diffMin(mains[1].end, localMs(D2, 6, 30))).toBeLessThanOrEqual(10);
  });

  it("stages the night in plausible proportions and keeps the awakening", () => {
    const night = mains[0];
    const inBed = night.minutesAsleep + night.minutesAwake;
    expect(inBed).toBeGreaterThanOrEqual(450);
    expect(night.stages).toHaveLength(inBed);
    expect(night.light + night.deep + night.rem + night.awake).toBe(inBed);
    // Injected: deep 100, rem 120, light 230, awake 10.
    expect(night.deep).toBeGreaterThanOrEqual(60);
    expect(night.deep).toBeLessThanOrEqual(160);
    expect(night.rem).toBeGreaterThanOrEqual(60);
    expect(night.rem).toBeLessThanOrEqual(200);
    expect(night.light).toBeGreaterThanOrEqual(100);
    expect(night.awake).toBeGreaterThanOrEqual(5);
    expect(night.awake).toBeLessThanOrEqual(30);
    expect(night.disturbances).toBeGreaterThanOrEqual(1);
    expect(night.efficiency).toBeGreaterThan(90);
    expect(night.efficiency).toBeLessThanOrEqual(100);
    expect(night.confidence).toBeGreaterThan(0.8);
    const awakeStage = night.stages.filter((s) => s.stage === "awake");
    const bout = localMs(D1, 2, 50); // minute 230 of the night, 23:00 + 230 min
    expect(awakeStage.some((s) => Math.abs(Date.parse(s.minute) - bout) <= 10 * 60_000)).toBe(true);
    expect(night.stages.slice(0, 8).every((s) => s.stage !== "rem")).toBe(true);
  });

  it("locates the deep and REM blocks roughly where they were injected", () => {
    const night = mains[0];
    const stageAt = (minuteOfNight: number) => night.stages.find((s) => Date.parse(s.minute) === localMs(D0, 23, 0) + minuteOfNight * 60_000)?.stage;
    const share = (from: number, to: number, stage: string) => {
      let hit = 0;
      for (let m = from; m < to; m++) if (stageAt(m) === stage) hit++;
      return hit / (to - from);
    };
    expect(share(65, 105, "deep")).toBeGreaterThan(0.6);
    expect(share(185, 225, "deep")).toBeGreaterThan(0.6);
    expect(share(295, 335, "rem")).toBeGreaterThan(0.5);
    expect(share(405, 435, "rem")).toBeGreaterThan(0.5);
    expect(share(245, 285, "light")).toBeGreaterThan(0.6);
  });

  it("reports the nap on its own calendar day with its length", () => {
    const nap = naps[0];
    expect(nap.day).toBe(D1);
    expect(diffMin(nap.start, localMs(D1, 14, 0))).toBeLessThanOrEqual(5);
    expect(nap.minutesAsleep + nap.minutesAwake).toBeGreaterThanOrEqual(35);
    expect(nap.minutesAsleep + nap.minutesAwake).toBeLessThanOrEqual(45);
  });

  it("returns nothing for an empty series and says plainly that stages are not EEG", () => {
    expect(detectSleep([], PROFILE)).toEqual([]);
    expect(METHOD_NOTE).toMatch(/not EEG/);
    expect(METHOD_NOTE).toMatch(/estimates/);
  });
});
