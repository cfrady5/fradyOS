/**
 * Synthetic minute series for the derivation tests. Phoenix has no daylight saving, so local time is
 * always UTC-7 and the fixtures can be written in local clock terms.
 */
import type { StrapMinute, StrapProfile } from "../../derive/types";

export const TZ = "America/Phoenix";
const OFFSET_H = 7;

export const PROFILE: StrapProfile = { timezone: TZ, maxHr: 190, restingHrHint: null };

/** Deterministic pseudo-random in [0,1) so fixtures are stable across runs. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** UTC milliseconds of a local Phoenix clock time. */
export function localMs(day: string, hh: number, mm = 0): number {
  return Date.parse(`${day}T00:00:00Z`) + (hh + OFFSET_H) * 3_600_000 + mm * 60_000;
}

export const minuteIso = (ms: number) => new Date(ms).toISOString();

export function blankMinute(ms: number): StrapMinute {
  return { minute: minuteIso(ms), hrAvg: null, hrMin: null, hrMax: null, rr: [], motion: null, skinContact: null, rawSkinTemp: null, rawSpo2: null, rawResp: null, samples: 0 };
}

export type Stage = "awake" | "light" | "deep" | "rem";

export interface Segment {
  /** Minutes from the start of the night. */
  from: number;
  to: number;
  stage: Stage;
}

/** Stage-specific generator settings: heart rate, motion range and the per-minute jitter SD range of the R-R series. */
const STAGE_SETTINGS: Record<Stage, { hr: number; motion: [number, number]; jitter: [number, number] }> = {
  deep: { hr: 50, motion: [0, 0.001], jitter: [15, 15] },
  light: { hr: 54, motion: [0.004, 0.01], jitter: [20, 35] },
  rem: { hr: 58, motion: [0, 0.002], jitter: [10, 80] },
  awake: { hr: 62, motion: [0.08, 0.15], jitter: [25, 25] },
};

export interface SeriesBuilder {
  minutes: StrapMinute[];
  /** Appends `count` minutes starting at `startMs`, one per minute, built by `make`. */
  span(startMs: number, count: number, make: (i: number, ms: number) => StrapMinute): void;
}

export function builder(): SeriesBuilder {
  const minutes: StrapMinute[] = [];
  return {
    minutes,
    span(startMs, count, make) {
      for (let i = 0; i < count; i++) minutes.push(make(i, startMs + i * 60_000));
    },
  };
}

/**
 * R-R interval generator with a respiratory sinus arrhythmia modulation at `breathHz` (4% of the base
 * interval) plus Gaussian-ish jitter whose SD is chosen per minute from `jitterRange`. Phase carries
 * across calls so the breathing signal is continuous across minute boundaries.
 */
export function rrGenerator(random: () => number, breathHz = 0.25) {
  let t = 0;
  return (hr: number, jitterRange: [number, number]): number[] => {
    const base = 60_000 / hr;
    const sigma = jitterRange[0] + (jitterRange[1] - jitterRange[0]) * random();
    const out: number[] = [];
    let elapsed = 0;
    while (elapsed < 60_000) {
      const noise = (random() + random() + random() - 1.5) * 2 * sigma;
      const rr = base * (1 + 0.04 * Math.sin(2 * Math.PI * breathHz * t)) + noise;
      out.push(Math.round(rr));
      elapsed += rr;
      t += rr / 1000;
    }
    return out;
  };
}

export interface NightOptions {
  startMs: number;
  segments: Segment[];
  random: () => number;
  rr: (hr: number, jitter: [number, number]) => number[];
}

/** Appends a staged night to the builder. */
export function addNight(b: SeriesBuilder, { startMs, segments, random, rr }: NightOptions): void {
  for (const seg of segments) {
    const s = STAGE_SETTINGS[seg.stage];
    b.span(startMs + seg.from * 60_000, seg.to - seg.from, (_, ms) => {
      const hr = s.hr + Math.round((random() - 0.5) * 2);
      return {
        ...blankMinute(ms),
        hrAvg: hr,
        hrMin: hr - 1,
        hrMax: hr + 1,
        rr: rr(hr, s.jitter),
        motion: s.motion[0] + (s.motion[1] - s.motion[0]) * random(),
        skinContact: 1,
        samples: 60,
      };
    });
  }
}

/** Awake daytime minutes: heart rate 68..80, motion 0.03..0.3, R-R intervals present. */
export function addAwake(b: SeriesBuilder, startMs: number, count: number, random: () => number, rr: (hr: number, jitter: [number, number]) => number[]): void {
  b.span(startMs, count, (_, ms) => {
    const hr = 68 + Math.round(random() * 12);
    return { ...blankMinute(ms), hrAvg: hr, hrMin: hr - 3, hrMax: hr + 3, rr: rr(hr, [20, 40]), motion: 0.03 + random() * 0.27, skinContact: 1, samples: 60 };
  });
}

/** Steady effort at `hr` bpm with vigorous motion. */
export function addEffort(b: SeriesBuilder, startMs: number, count: number, hr: number, random: () => number): void {
  b.span(startMs, count, (_, ms) => {
    const v = hr + Math.round((random() - 0.5) * 6);
    return { ...blankMinute(ms), hrAvg: v, hrMin: v - 4, hrMax: v + 4, rr: [], motion: 0.4 + random() * 0.4, skinContact: 1, samples: 60 };
  });
}

/** A still nap at 60 bpm. */
export function addNap(b: SeriesBuilder, startMs: number, count: number, random: () => number, rr: (hr: number, jitter: [number, number]) => number[]): void {
  b.span(startMs, count, (_, ms) => {
    const hr = 60 + Math.round((random() - 0.5) * 2);
    return { ...blankMinute(ms), hrAvg: hr, hrMin: hr - 1, hrMax: hr + 1, rr: rr(hr, [20, 30]), motion: 0.001 + random() * 0.002, skinContact: 1, samples: 60 };
  });
}

/** The standard night used across tests: 460 minutes with two deep blocks, three REM blocks and a 10-minute awakening. */
export const NIGHT_SEGMENTS: Segment[] = [
  { from: 0, to: 60, stage: "light" },
  { from: 60, to: 110, stage: "deep" },
  { from: 110, to: 150, stage: "light" },
  { from: 150, to: 180, stage: "rem" },
  { from: 180, to: 230, stage: "deep" },
  { from: 230, to: 240, stage: "awake" },
  { from: 240, to: 290, stage: "light" },
  { from: 290, to: 340, stage: "rem" },
  { from: 340, to: 400, stage: "light" },
  { from: 400, to: 440, stage: "rem" },
  { from: 440, to: 460, stage: "light" },
];

/** A shorter plain night (440 minutes) for the second day. */
export const NIGHT2_SEGMENTS: Segment[] = [
  { from: 0, to: 50, stage: "light" },
  { from: 50, to: 100, stage: "deep" },
  { from: 100, to: 160, stage: "light" },
  { from: 160, to: 200, stage: "rem" },
  { from: 200, to: 250, stage: "deep" },
  { from: 250, to: 320, stage: "light" },
  { from: 320, to: 370, stage: "rem" },
  { from: 370, to: 440, stage: "light" },
];

export const D0 = "2026-10-14";
export const D1 = "2026-10-15";
export const D2 = "2026-10-16";
export const D3 = "2026-10-17";

/**
 * Three and a half days: an afternoon, a staged night ending 06:40 on D1, a day with a 40-minute nap at
 * 14:00 and a 45-minute run at 150 bpm at 17:00, a second night ending 06:30 on D2, a rest day, and a D3
 * with only two hours of contact.
 */
export function scenario(seed = 7): StrapMinute[] {
  const random = rng(seed);
  const rr = rrGenerator(random);
  const b = builder();
  addAwake(b, localMs(D0, 12, 0), 11 * 60, random, rr); // 12:00..23:00
  addNight(b, { startMs: localMs(D0, 23, 0), segments: NIGHT_SEGMENTS, random, rr }); // 23:00..06:40
  addAwake(b, localMs(D1, 6, 40), 7 * 60 + 20, random, rr); // 06:40..14:00
  addNap(b, localMs(D1, 14, 0), 40, random, rr); // 14:00..14:40
  addAwake(b, localMs(D1, 14, 40), 2 * 60 + 20, random, rr); // 14:40..17:00
  addEffort(b, localMs(D1, 17, 0), 45, 150, random); // 17:00..17:45
  addAwake(b, localMs(D1, 17, 45), 5 * 60 + 25, random, rr); // 17:45..23:10
  addNight(b, { startMs: localMs(D1, 23, 10), segments: NIGHT2_SEGMENTS, random, rr }); // 23:10..06:30
  addAwake(b, localMs(D2, 6, 30), 16 * 60 + 30, random, rr); // 06:30..23:00, no strap overnight
  addAwake(b, localMs(D3, 8, 0), 120, random, rr); // 08:00..10:00 only
  return b.minutes;
}
