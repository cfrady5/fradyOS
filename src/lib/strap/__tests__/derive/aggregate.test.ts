import { describe, expect, it } from "vitest";
import { aggregateMinutes, mergeMinutes, RR_PER_MINUTE_CAP } from "../../derive/aggregate";
import type { StrapRecord } from "../../derive/types";

const T0 = Date.parse("2026-10-15T06:00:00Z") / 1000;

describe("aggregateMinutes", () => {
  it("groups records by UTC minute and averages heart rate, ignoring zeros and off-skin samples", () => {
    const records: StrapRecord[] = [
      { unix: T0 + 1, hr: 60, rr: [1000], skinContact: true },
      { unix: T0 + 2, hr: 0, rr: [], skinContact: true },
      { unix: T0 + 3, hr: 120, rr: [], skinContact: false },
      { unix: T0 + 4, hr: 64, rr: [980, 0], skinContact: true },
      { unix: T0 + 61, hr: 70, rr: [], skinContact: true },
    ];
    const out = aggregateMinutes(records);
    expect(out).toHaveLength(2);
    expect(out[0].minute).toBe("2026-10-15T06:00:00.000Z");
    expect(out[0].hrAvg).toBe(62);
    expect(out[0].hrMin).toBe(60);
    expect(out[0].hrMax).toBe(64);
    expect(out[0].rr).toEqual([1000, 980]);
    expect(out[0].skinContact).toBe(0.75);
    expect(out[0].samples).toBe(4);
    expect(out[1].minute).toBe("2026-10-15T06:01:00.000Z");
    expect(out[1].hrAvg).toBe(70);
  });

  it("derives motion from successive gravity-vector differences per second", () => {
    const still: StrapRecord[] = [0, 1, 2, 3].map((i) => ({ unix: T0 + i, hr: 60, rr: [], gravity: [0, 0, 1] as [number, number, number] }));
    expect(aggregateMinutes(still)[0].motion).toBe(0);
    const moving: StrapRecord[] = [
      { unix: T0, hr: 60, rr: [], gravity: [0, 0, 1] },
      { unix: T0 + 1, hr: 60, rr: [], gravity: [0.1, 0, 1] },
      { unix: T0 + 2, hr: 60, rr: [], gravity: [0.1, 0.1, 1] },
    ];
    expect(aggregateMinutes(moving)[0].motion).toBeCloseTo(0.1, 6);
    const single: StrapRecord[] = [{ unix: T0, hr: 60, rr: [], gravity: [0, 0, 1] }];
    expect(aggregateMinutes(single)[0].motion).toBeNull();
    const none: StrapRecord[] = [{ unix: T0, hr: 60, rr: [] }];
    expect(aggregateMinutes(none)[0].motion).toBeNull();
    expect(aggregateMinutes(none)[0].skinContact).toBeNull();
  });

  it("caps R-R intervals at 200 per minute and averages raw channels without calibrating them", () => {
    const records: StrapRecord[] = [];
    for (let i = 0; i < 60; i++) records.push({ unix: T0 + i, hr: 60, rr: [900, 910, 920, 930], rawSkinTemp: 1000 + i, rawSpo2: { red: 10, ir: 20 }, rawResp: 5 });
    const [m] = aggregateMinutes(records);
    expect(m.rr).toHaveLength(RR_PER_MINUTE_CAP);
    expect(m.rawSkinTemp).toBeCloseTo(1029.5, 6);
    expect(m.rawSpo2).toEqual({ red: 10, ir: 20 });
    expect(m.rawResp).toBe(5);
  });

  it("produces an empty-heart-rate minute when every sample lacks a reading", () => {
    const [m] = aggregateMinutes([{ unix: T0, hr: 0, rr: [] }, { unix: T0 + 5, hr: null, rr: [] }]);
    expect(m.hrAvg).toBeNull();
    expect(m.samples).toBe(2);
  });
});

describe("mergeMinutes", () => {
  it("keys by minute, prefers the row with more samples and keeps the result sorted", () => {
    const a = aggregateMinutes([{ unix: T0 + 120, hr: 60, rr: [] }, { unix: T0, hr: 50, rr: [] }]);
    const b = aggregateMinutes([
      { unix: T0 + 1, hr: 70, rr: [] },
      { unix: T0 + 2, hr: 72, rr: [] },
      { unix: T0 + 60, hr: 65, rr: [] },
    ]);
    const merged = mergeMinutes(a, b);
    expect(merged.map((m) => m.minute)).toEqual(["2026-10-15T06:00:00.000Z", "2026-10-15T06:01:00.000Z", "2026-10-15T06:02:00.000Z"]);
    expect(merged[0].hrAvg).toBe(71);
    expect(merged[0].samples).toBe(2);
  });
});
