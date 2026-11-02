/**
 * Overnight cardio metrics from a detected sleep episode.
 *
 * - restingHr: mean of the lowest contiguous 5-minute heart-rate window over asleep minutes of the main
 *   sleep. The 5-minute floor rejects single-minute dips. Null without 60 asleep minutes.
 * - overnightHrv: median of 5-minute RMSSD values (rmssd() from src/lib/ble/heartRate.ts, with its
 *   artefact rejection) over windows holding at least 100 R-R intervals in the last 3 hours of the episode.
 *   Restricting to the same part of the night keeps nights comparable; WHOOP's HRV is also a sleep RMSSD.
 * - respiratoryRate: breaths per minute from respiratory sinus arrhythmia. For each 5-minute window with at
 *   least 150 intervals the R-R series is resampled to 4 Hz by linear interpolation, a 10 s moving average
 *   is removed, and the dominant frequency in 0.1..0.5 Hz is found with a direct discrete Fourier transform
 *   under a Hann window. The night's value is the median over windows; null when fewer than 6 qualify.
 * - spo2Estimate and skinTempEstimate return null with a reason: the raw channels are uncalibrated and a
 *   calibration is never invented.
 */
import { mean, median } from "@/lib/intel/stats";
import { rmssd } from "@/lib/ble/heartRate";
import { hasContact, indexBySlot, normaliseMinutes, slotOf } from "./time";
import type { SleepEpisode, SleepStage, StrapMinute } from "./types";

export const CARDIO_PARAMS = {
  rhrWindowMinutes: 5,
  rhrMinAsleepMinutes: 60,
  hrvWindowMinutes: 5,
  hrvMinIntervals: 100,
  hrvTailMinutes: 180,
  hrvMinWindows: 3,
  respWindowMinutes: 5,
  respMinIntervals: 150,
  respMinWindows: 6,
  respSampleHz: 4,
  respMovingAverageSec: 10,
  respBandHz: [0.1, 0.5] as const,
  respBinHz: 0.005,
} as const;

function episodeIndex(episode: SleepEpisode, minutes: StrapMinute[]) {
  const index = indexBySlot(normaliseMinutes(minutes));
  const stage = new Map<number, SleepStage>();
  for (const s of episode.stages) stage.set(slotOf(s.minute), s.stage);
  return { index, stage, startSlot: slotOf(episode.start), endSlot: slotOf(episode.end) };
}

/** Mean of the lowest contiguous 5-minute heart-rate window over asleep minutes; null without 60 asleep minutes. */
export function restingHr(episode: SleepEpisode, minutes: StrapMinute[]): number | null {
  if (episode.minutesAsleep < CARDIO_PARAMS.rhrMinAsleepMinutes) return null;
  const { index, stage, startSlot, endSlot } = episodeIndex(episode, minutes);
  const n = CARDIO_PARAMS.rhrWindowMinutes;
  let best: number | null = null;
  for (let s = startSlot; s + n <= endSlot; s++) {
    let sum = 0;
    let ok = true;
    for (let k = s; k < s + n; k++) {
      const m = index.get(k);
      if (!m || !hasContact(m) || stage.get(k) === "awake") {
        ok = false;
        break;
      }
      sum += m.hrAvg!;
    }
    if (!ok) continue;
    const avg = sum / n;
    if (best == null || avg < best) best = avg;
  }
  return best == null ? null : Math.round(best);
}

/** Median 5-minute RMSSD over the last 3 hours of the episode; null with fewer than 3 qualifying windows. */
export function overnightHrv(episode: SleepEpisode, minutes: StrapMinute[]): number | null {
  const { index, stage, startSlot, endSlot } = episodeIndex(episode, minutes);
  const n = CARDIO_PARAMS.hrvWindowMinutes;
  const from = Math.max(startSlot, endSlot - CARDIO_PARAMS.hrvTailMinutes);
  const values: number[] = [];
  for (let s = from; s + n <= endSlot; s += n) {
    const rr: number[] = [];
    let awake = 0;
    for (let k = s; k < s + n; k++) {
      const m = index.get(k);
      if (!m) continue;
      if (stage.get(k) === "awake") awake++;
      rr.push(...m.rr);
    }
    if (awake >= 3 || rr.length < CARDIO_PARAMS.hrvMinIntervals) continue;
    const v = rmssd(rr);
    if (v != null) values.push(v);
  }
  if (values.length < CARDIO_PARAMS.hrvMinWindows) return null;
  const med = median(values);
  return med == null ? null : Math.round(med * 10) / 10;
}

/** Linear resample of an irregularly timed series (seconds, values) to a fixed rate. */
function resample(times: number[], values: number[], hz: number): number[] {
  if (times.length < 2) return [];
  const out: number[] = [];
  const step = 1 / hz;
  let j = 0;
  for (let t = times[0]; t <= times[times.length - 1]; t += step) {
    while (j + 1 < times.length && times[j + 1] < t) j++;
    const t0 = times[j];
    const t1 = times[Math.min(j + 1, times.length - 1)];
    const v0 = values[j];
    const v1 = values[Math.min(j + 1, values.length - 1)];
    out.push(t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v0);
  }
  return out;
}

/** Removes a centred moving average of `width` samples (detrend). */
function removeMovingAverage(xs: number[], width: number): number[] {
  const half = Math.floor(width / 2);
  const out = new Array<number>(xs.length);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < xs.length; i++) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(xs.length - 1, i + half);
    while (hi < wantHi) sum += xs[++hi];
    while (lo < wantLo) sum -= xs[lo++];
    out[i] = xs[i] - sum / (hi - lo + 1);
  }
  return out;
}

/**
 * Dominant frequency (Hz) of a cleaned R-R series inside the breathing band, or null when the series is too
 * short or has no energy. Exported for tests and for callers that want a single-window estimate.
 */
export function dominantBreathingFrequency(rr: number[]): number | null {
  const times: number[] = [];
  const values: number[] = [];
  let t = 0;
  for (const v of rr) {
    if (v < 300 || v > 2000) continue;
    t += v / 1000;
    times.push(t);
    values.push(v);
  }
  if (times.length < 30) return null;
  const hz = CARDIO_PARAMS.respSampleHz;
  const series = removeMovingAverage(resample(times, values, hz), CARDIO_PARAMS.respMovingAverageSec * hz + 1);
  const n = series.length;
  if (n < hz * 30) return null;
  const [lo, hi] = CARDIO_PARAMS.respBandHz;
  let bestF: number | null = null;
  let bestP = 0;
  for (let f = lo; f <= hi + 1e-9; f += CARDIO_PARAMS.respBinHz) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / hz;
    for (let i = 0; i < n; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const x = series[i] * hann;
      re += x * Math.cos(w * i);
      im -= x * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      bestF = f;
    }
  }
  return bestP > 0 ? bestF : null;
}

/** Median breaths per minute over qualifying 5-minute windows of the episode; null with fewer than 6 windows. */
export function respiratoryRate(episode: SleepEpisode, minutes: StrapMinute[]): number | null {
  const { index, stage, startSlot, endSlot } = episodeIndex(episode, minutes);
  const n = CARDIO_PARAMS.respWindowMinutes;
  const rates: number[] = [];
  for (let s = startSlot; s + n <= endSlot; s += n) {
    const rr: number[] = [];
    let awake = 0;
    for (let k = s; k < s + n; k++) {
      const m = index.get(k);
      if (!m) continue;
      if (stage.get(k) === "awake") awake++;
      rr.push(...m.rr);
    }
    if (awake >= 3 || rr.length < CARDIO_PARAMS.respMinIntervals) continue;
    const f = dominantBreathingFrequency(rr);
    if (f != null) rates.push(f * 60);
  }
  if (rates.length < CARDIO_PARAMS.respMinWindows) return null;
  const med = median(rates);
  return med == null ? null : Math.round(med * 10) / 10;
}

export interface UnavailableEstimate {
  value: null;
  reason: string;
}

/** Always null: the red/IR channels are raw counts without a per-device calibration, so no saturation is derivable. */
export function spo2Estimate(minutes: StrapMinute[]): UnavailableEstimate {
  const n = minutes.filter((m) => m.rawSpo2 != null).length;
  return {
    value: null,
    reason: n
      ? `${n} minutes carry raw red/IR optical counts, but they are uncalibrated and no ratio-of-ratios calibration exists for this device; no SpO2 is estimated.`
      : "No raw optical channel present; no SpO2 is estimated.",
  };
}

/** Always null: the thermal channel is a raw ADC value whose transfer function is unknown. */
export function skinTempEstimate(minutes: StrapMinute[]): UnavailableEstimate {
  const n = minutes.filter((m) => m.rawSkinTemp != null).length;
  const avg = mean(minutes.map((m) => m.rawSkinTemp));
  return {
    value: null,
    reason: n
      ? `${n} minutes carry a raw skin-temperature ADC value (mean ${Math.round(avg ?? 0)}), but no calibration to degrees exists; no temperature is estimated.`
      : "No raw skin-temperature channel present; no temperature is estimated.",
  };
}
