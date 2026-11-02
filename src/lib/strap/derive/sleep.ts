/**
 * Sleep detection and staging from minute-level motion, heart rate and R-R intervals.
 *
 * Method (actigraphy plus heart rate, documented step by step):
 *
 * 1. Sleep windows. Minutes are grouped into noon-to-noon windows (`dayStartHour`, default 12) in the
 *    profile timezone, so one night never straddles two groups.
 * 2. Learned thresholds per window. The low-motion threshold is learned from that window's motion
 *    distribution: four times the 20th percentile (the still floor), kept within 0.01..0.08 g/s. The heart
 *    rate reference is the window's median over contact minutes. A minute is "restful" when it has contact,
 *    motion below the threshold and heart rate at or below 1.05 x the median. The heart-rate test is only
 *    applied when the window holds at least 12 h of contact, because a night-only wearer's median is a
 *    sleeping value and would reject half the night. Without any motion data the window falls back to a
 *    heart-rate-only rule (at or below 0.92 x median) and the episode's confidence is reduced.
 * 3. Candidates. Restful runs of at least 3 minutes are seeds; seeds separated by gaps of up to 20 minutes
 *    (restless minutes or missing data) are bridged into one candidate.
 * 4. Main sleep = the longest candidate in the window that overlaps 20:00..12:00 local and lasts at least
 *    3 h. Naps = other candidates of at least 20 minutes whose midpoint falls between 12:00 and 20:00.
 *    Other night candidates of at least 60 minutes are kept as "fragment" episodes so a split night is not
 *    silently lost; shorter leftovers are dropped.
 * 5. Stages per 5-minute window inside an episode, relative to that episode's own distributions:
 *    - awake when motion is high (at least 3 of the 5 minutes above the learned threshold, or the window
 *      median above it);
 *    - deep when mean heart rate is in the episode's lowest quartile AND motion is near zero AND the
 *      coefficient of variation of the per-minute RMSSD values is in the low part of the episode's range;
 *    - rem when motion is near zero AND heart rate is above the episode median AND RMSSD variability is in
 *      the high part of the range (above the 75th percentile of heart rate when no R-R data exist);
 *    - light otherwise.
 *    REM called inside the first 40 minutes is demoted to light (REM latency is rarely that short), then a
 *    3-window majority filter smooths light/deep/rem. Awake windows are not smoothed away because an
 *    8-minute awakening is real even when it only fills one window.
 *
 * Nothing here is EEG. See METHOD_NOTE.
 */
import { mean, median, quantile, sd, valid } from "@/lib/intel/stats";
import { rmssd } from "@/lib/ble/heartRate";
import { addDays, hasContact, indexBySlot, isoOfSlot, localClock, MINUTE_MS, normaliseMinutes, slotOf } from "./time";
import type { SleepEpisode, SleepStage, StagedMinute, StrapMinute, StrapProfile } from "./types";

export const METHOD_NOTE =
  "Sleep stages are estimates from wrist motion, heart rate and heart-rate variability (actigraphy plus heart rate), not EEG or polysomnography. " +
  "Light versus deep is the least reliable split. Onset, wake time and total sleep are the most reliable outputs. Not a medical device.";

export interface SleepOptions {
  /** Local hour at which the sleep day rolls over. Default 12 (noon). */
  dayStartHour?: number;
}

/** Tunables, exported so the README and tests can refer to them. */
export const SLEEP_PARAMS = {
  motionFloorQuantile: 0.2,
  motionFloorMultiplier: 4,
  motionThresholdMin: 0.01,
  motionThresholdMax: 0.08,
  hrTolerance: 1.05,
  hrOnlyFactor: 0.92,
  hrRuleMinContactMinutes: 720,
  seedMinutes: 3,
  bridgeMinutes: 20,
  mainMinMinutes: 180,
  napMinMinutes: 20,
  fragmentMinMinutes: 60,
  nightStartSinceNoon: 480,
  stageWindow: 5,
  nearZeroShare: 0.4,
  nearZeroFloor: 0.004,
  remLatencyMinutes: 40,
  disturbanceMinMinutes: 2,
} as const;

interface WindowStats {
  motionThreshold: number;
  hrMedian: number | null;
  contactMinutes: number;
  hasMotion: boolean;
}

interface Candidate {
  startSlot: number;
  endSlot: number; // exclusive
  windowKey: string;
}

function windowKeyOf(ms: number, timeZone: string, dayStartHour: number): string {
  const clock = localClock(ms, timeZone);
  return clock.minutes >= dayStartHour * 60 ? clock.day : addDays(clock.day, -1);
}

function windowStats(rows: StrapMinute[]): WindowStats {
  const contact = rows.filter(hasContact);
  const motion = valid(contact.map((m) => m.motion));
  const floor = quantile(motion, SLEEP_PARAMS.motionFloorQuantile) ?? 0;
  const threshold = Math.min(SLEEP_PARAMS.motionThresholdMax, Math.max(SLEEP_PARAMS.motionThresholdMin, floor * SLEEP_PARAMS.motionFloorMultiplier));
  return {
    motionThreshold: threshold,
    hrMedian: median(contact.map((m) => m.hrAvg)),
    contactMinutes: contact.length,
    hasMotion: motion.length >= Math.max(10, contact.length * 0.1),
  };
}

function isRestful(m: StrapMinute, w: WindowStats): boolean {
  if (!hasContact(m)) return false;
  const hr = m.hrAvg!;
  if (!w.hasMotion) return w.hrMedian != null && hr <= w.hrMedian * SLEEP_PARAMS.hrOnlyFactor;
  if (m.motion == null || m.motion >= w.motionThreshold) return false;
  if (w.contactMinutes >= SLEEP_PARAMS.hrRuleMinContactMinutes && w.hrMedian != null && hr > w.hrMedian * SLEEP_PARAMS.hrTolerance) return false;
  return true;
}

/** Contiguous restful runs of at least `seedMinutes`, then bridged across gaps of up to `bridgeMinutes`. */
function buildCandidates(rows: StrapMinute[], restful: (m: StrapMinute) => boolean, timeZone: string, dayStartHour: number): Candidate[] {
  const seeds: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  let prevSlot: number | null = null;
  const close = (endSlot: number) => {
    if (runStart != null && endSlot - runStart >= SLEEP_PARAMS.seedMinutes) seeds.push({ start: runStart, end: endSlot });
    runStart = null;
  };
  for (const m of rows) {
    const slot = slotOf(m.minute);
    const contiguous = prevSlot != null && slot === prevSlot + 1;
    if (restful(m)) {
      if (runStart == null || !contiguous) {
        if (prevSlot != null) close(prevSlot + 1);
        runStart = slot;
      }
    } else if (runStart != null) {
      close(contiguous ? slot : prevSlot! + 1);
    }
    prevSlot = slot;
  }
  if (prevSlot != null) close(prevSlot + 1);

  const merged: { start: number; end: number }[] = [];
  for (const s of seeds) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end <= SLEEP_PARAMS.bridgeMinutes) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged.map((c) => {
    const midMs = ((c.start + c.end) / 2) * MINUTE_MS;
    return { startSlot: c.start, endSlot: c.end, windowKey: windowKeyOf(midMs, timeZone, dayStartHour) };
  });
}

interface StageWindow {
  startSlot: number;
  endSlot: number;
  hr: number | null;
  motionMedian: number | null;
  highMotionMinutes: number;
  motionMinutes: number;
  rmssdCv: number | null;
  stage: SleepStage;
}

function stageWindows(startSlot: number, endSlot: number, index: Map<number, StrapMinute>, motionThreshold: number): StageWindow[] {
  const windows: StageWindow[] = [];
  for (let s = startSlot; s < endSlot; s += SLEEP_PARAMS.stageWindow) {
    const e = Math.min(endSlot, s + SLEEP_PARAMS.stageWindow);
    const hrs: number[] = [];
    const motions: number[] = [];
    const minuteRmssd: number[] = [];
    let high = 0;
    for (let k = s; k < e; k++) {
      const m = index.get(k);
      if (!m) continue;
      if (hasContact(m)) hrs.push(m.hrAvg!);
      if (m.motion != null) {
        motions.push(m.motion);
        if (m.motion >= motionThreshold) high++;
      }
      if (m.rr.length >= 20) {
        const r = rmssd(m.rr);
        if (r != null) minuteRmssd.push(r);
      }
    }
    let cv: number | null = null;
    if (minuteRmssd.length >= 2) {
      const mu = mean(minuteRmssd)!;
      const sigma = sd(minuteRmssd) ?? 0;
      cv = mu > 0 ? sigma / mu : null;
    }
    windows.push({ startSlot: s, endSlot: e, hr: mean(hrs), motionMedian: median(motions), highMotionMinutes: high, motionMinutes: motions.length, rmssdCv: cv, stage: "light" });
  }
  return windows;
}

function classify(windows: StageWindow[], motionThreshold: number): void {
  const hrs = windows.map((w) => w.hr);
  const q25 = quantile(hrs, 0.25);
  const q50 = quantile(hrs, 0.5);
  const q75 = quantile(hrs, 0.75);
  const cvs = windows.map((w) => w.rmssdCv);
  const cvLow = quantile(cvs, 0.4);
  const cvHigh = quantile(cvs, 0.6);
  const nearZero = Math.max(SLEEP_PARAMS.nearZeroFloor, motionThreshold * SLEEP_PARAMS.nearZeroShare);

  for (const w of windows) {
    const highMotion = w.motionMinutes > 0 && (w.highMotionMinutes >= 3 || (w.motionMedian != null && w.motionMedian >= motionThreshold));
    if (highMotion) {
      w.stage = "awake";
      continue;
    }
    const still = w.motionMedian != null && w.motionMedian <= nearZero;
    if (w.hr == null || q25 == null || q50 == null) {
      w.stage = "light";
      continue;
    }
    const cvIsLow = w.rmssdCv == null || cvLow == null || w.rmssdCv <= cvLow;
    const cvIsHigh = w.rmssdCv != null && cvHigh != null && w.rmssdCv > cvHigh;
    if (still && w.hr <= q25 && cvIsLow) {
      w.stage = "deep";
      continue;
    }
    const remByHrv = cvIsHigh && w.hr > q50;
    const remByHrOnly = w.rmssdCv == null && q75 != null && w.hr > q75;
    if (still && (remByHrv || remByHrOnly)) {
      w.stage = "rem";
      continue;
    }
    w.stage = "light";
  }

  // REM within the first 40 minutes is implausible; call it light.
  const first = windows[0]?.startSlot ?? 0;
  for (const w of windows) if (w.stage === "rem" && w.startSlot - first < SLEEP_PARAMS.remLatencyMinutes) w.stage = "light";

  // 3-window majority filter over light/deep/rem. Awake windows are left as they are.
  const before = windows.map((w) => w.stage);
  for (let i = 0; i < windows.length; i++) {
    if (before[i] === "awake") continue;
    const votes: SleepStage[] = [before[i]];
    if (i > 0 && before[i - 1] !== "awake") votes.push(before[i - 1]);
    if (i + 1 < windows.length && before[i + 1] !== "awake") votes.push(before[i + 1]);
    const counts = new Map<SleepStage, number>();
    for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [stage, n] of counts) if (n >= 2 && stage !== before[i]) windows[i].stage = stage;
  }
}

function countDisturbances(stages: StagedMinute[]): number {
  let count = 0;
  let run = 0;
  for (const s of stages) {
    if (s.stage === "awake") run++;
    else {
      if (run >= SLEEP_PARAMS.disturbanceMinMinutes) count++;
      run = 0;
    }
  }
  if (run >= SLEEP_PARAMS.disturbanceMinMinutes) count++;
  return count;
}

function buildEpisode(c: Candidate, kind: SleepEpisode["kind"], index: Map<number, StrapMinute>, w: WindowStats, timeZone: string): SleepEpisode {
  const windows = stageWindows(c.startSlot, c.endSlot, index, w.motionThreshold);
  classify(windows, w.motionThreshold);
  const stages: StagedMinute[] = [];
  for (const win of windows) for (let k = win.startSlot; k < win.endSlot; k++) stages.push({ minute: isoOfSlot(k), stage: win.stage });

  const tally: Record<SleepStage, number> = { awake: 0, light: 0, deep: 0, rem: 0 };
  for (const s of stages) tally[s.stage]++;
  const inBed = c.endSlot - c.startSlot;
  const asleep = tally.light + tally.deep + tally.rem;

  let contactMinutes = 0;
  let rrMinutes = 0;
  for (let k = c.startSlot; k < c.endSlot; k++) {
    const m = index.get(k);
    if (!m) continue;
    if (hasContact(m)) contactMinutes++;
    if (m.rr.length >= 20) rrMinutes++;
  }
  const coverage = contactMinutes / inBed;
  const rrShare = rrMinutes / inBed;
  const lengthFactor = Math.min(1, inBed / SLEEP_PARAMS.mainMinMinutes);
  const motionFactor = w.hasMotion ? 1 : 0.5;
  const confidence = Math.max(0, Math.min(1, (0.6 * coverage + 0.3 * rrShare + 0.1 * lengthFactor) * motionFactor));

  const startMs = c.startSlot * MINUTE_MS;
  const endMs = c.endSlot * MINUTE_MS;
  const day = kind === "nap" ? localClock(startMs, timeZone).day : localClock(endMs, timeZone).day;

  return {
    start: isoOfSlot(c.startSlot),
    end: isoOfSlot(c.endSlot),
    day,
    nap: kind === "nap",
    kind,
    minutesAsleep: asleep,
    minutesAwake: tally.awake,
    stages,
    light: tally.light,
    deep: tally.deep,
    rem: tally.rem,
    awake: tally.awake,
    efficiency: inBed > 0 ? Math.round((asleep / inBed) * 1000) / 10 : 0,
    disturbances: countDisturbances(stages),
    onsetMin: localClock(startMs, timeZone).sinceNoon,
    wakeMin: localClock(endMs, timeZone).sinceNoon,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Detects rest episodes and stages them. Returns main sleeps, naps and night fragments sorted by start.
 * Episodes are estimates; see METHOD_NOTE.
 */
export function detectSleep(minutes: StrapMinute[], profile: StrapProfile, opts: SleepOptions = {}): SleepEpisode[] {
  const dayStartHour = opts.dayStartHour ?? 12;
  const timeZone = profile.timezone || "UTC";
  const rows = normaliseMinutes(minutes);
  if (!rows.length) return [];
  const index = indexBySlot(rows);

  const byWindow = new Map<string, StrapMinute[]>();
  for (const m of rows) {
    const key = windowKeyOf(Date.parse(m.minute), timeZone, dayStartHour);
    const g = byWindow.get(key);
    if (g) g.push(m);
    else byWindow.set(key, [m]);
  }
  const stats = new Map<string, WindowStats>();
  for (const [key, group] of byWindow) stats.set(key, windowStats(group));
  const statsFor = (m: StrapMinute) => stats.get(windowKeyOf(Date.parse(m.minute), timeZone, dayStartHour))!;

  const candidates = buildCandidates(rows, (m) => isRestful(m, statsFor(m)), timeZone, dayStartHour);

  const grouped = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const g = grouped.get(c.windowKey);
    if (g) g.push(c);
    else grouped.set(c.windowKey, [c]);
  }

  const episodes: SleepEpisode[] = [];
  for (const [key, cands] of grouped) {
    const w = stats.get(key) ?? windowStats(byWindow.get(key) ?? []);
    const overlapsNight = (c: Candidate) => {
      const startOff = localClock(c.startSlot * MINUTE_MS, timeZone).sinceNoon;
      return startOff + (c.endSlot - c.startSlot) > SLEEP_PARAMS.nightStartSinceNoon;
    };
    const eligible = cands.filter((c) => c.endSlot - c.startSlot >= SLEEP_PARAMS.mainMinMinutes && overlapsNight(c));
    const main = eligible.length ? eligible.reduce((a, b) => (b.endSlot - b.startSlot > a.endSlot - a.startSlot ? b : a)) : null;
    for (const c of cands) {
      const len = c.endSlot - c.startSlot;
      if (c === main) {
        episodes.push(buildEpisode(c, "main", index, w, timeZone));
        continue;
      }
      const midOff = localClock(((c.startSlot + c.endSlot) / 2) * MINUTE_MS, timeZone).sinceNoon;
      if (midOff < SLEEP_PARAMS.nightStartSinceNoon) {
        if (len >= SLEEP_PARAMS.napMinMinutes) episodes.push(buildEpisode(c, "nap", index, w, timeZone));
      } else if (len >= SLEEP_PARAMS.fragmentMinMinutes) {
        episodes.push(buildEpisode(c, "fragment", index, w, timeZone));
      }
    }
  }
  return episodes.sort((a, b) => (a.start < b.start ? -1 : 1));
}
