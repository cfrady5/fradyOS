import { describe, expect, it } from "vitest";
import { hrZone, parseHeartRateMeasurement, rmssd, sessionStats, type LiveSample } from "../heartRate";

const view = (bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe("parseHeartRateMeasurement", () => {
  it("reads an 8-bit value with no extras", () => {
    expect(parseHeartRateMeasurement(view([0x00, 72]))).toEqual({ bpm: 72, rr: [], contact: null, energyKj: null });
  });

  it("reads a 16-bit value, contact flags and R-R intervals in 1/1024 s", () => {
    // flags: 16-bit (1) | contact detected (2) | contact supported (4) | rr present (16)
    const m = parseHeartRateMeasurement(view([0x17, 0x2c, 0x01, 0x00, 0x04, 0x33, 0x03]));
    expect(m.bpm).toBe(300);
    expect(m.contact).toBe(true);
    expect(m.rr).toEqual([1000, 800]);
  });

  it("skips energy expended before the R-R block", () => {
    const m = parseHeartRateMeasurement(view([0x18, 60, 0x10, 0x00, 0x00, 0x04]));
    expect(m.energyKj).toBe(16);
    expect(m.rr).toEqual([1000]);
  });

  it("tolerates a truncated packet", () => {
    expect(parseHeartRateMeasurement(view([0x01])).bpm).toBe(0);
  });
});

describe("rmssd", () => {
  it("returns null without two clean intervals", () => {
    expect(rmssd([])).toBeNull();
    expect(rmssd([900])).toBeNull();
  });
  it("computes the root mean square of successive differences", () => {
    expect(rmssd([1000, 1020, 980, 1000])).toBeCloseTo(Math.sqrt((400 + 1600 + 400) / 3), 1);
  });
  it("drops artefacts outside the plausible range and large jumps", () => {
    expect(rmssd([1000, 100, 1000, 1000, 2500])).toBe(0);
    expect(rmssd([1000, 1500, 1000])).toBe(0);
  });
});

describe("sessionStats", () => {
  it("summarises samples and ignores zero readings", () => {
    const s: LiveSample[] = [
      [0, 0],
      [1, 60, [1000]],
      [2, 70, [980, 1000]],
      [3, 80],
    ];
    const st = sessionStats(s);
    expect(st).toMatchObject({ sampleCount: 4, durationSec: 3, avgHr: 70, maxHr: 80, minHr: 60 });
    expect(st.rmssdMs).toBeCloseTo(20, 0);
  });
  it("handles an empty run", () => {
    expect(sessionStats([])).toEqual({ sampleCount: 0, durationSec: 0, avgHr: null, maxHr: null, minHr: null, rmssdMs: null });
  });
});

describe("hrZone", () => {
  it("maps the share of max heart rate to five bands", () => {
    expect(hrZone(0, 190)).toBe(0);
    expect(hrZone(100, 190)).toBe(1);
    expect(hrZone(125, 190)).toBe(2);
    expect(hrZone(140, 190)).toBe(3);
    expect(hrZone(160, 190)).toBe(4);
    expect(hrZone(185, 190)).toBe(5);
  });
});
