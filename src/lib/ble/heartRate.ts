/**
 * Bluetooth Heart Rate Profile decoding and the live-session maths. Pure functions, no browser APIs,
 * so they run in tests and on the server.
 *
 * A WHOOP strap exposes the standard Heart Rate Service (0x180D) without any bond, which is how
 * FRADY can read it live while the strap stays paired to the WHOOP app.
 */
export const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
export const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";
export const BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";
export const BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb";

export interface HeartRateMeasurement {
  /** Beats per minute, 0 when the sensor has no reading. */
  bpm: number;
  /** R-R intervals in milliseconds, oldest first, when the device sends them. */
  rr: number[];
  /** Skin contact: true / false when reported, null when the device does not support it. */
  contact: boolean | null;
  /** Energy expended in kJ when present. */
  energyKj: number | null;
}

/** Decodes one Heart Rate Measurement characteristic value (Bluetooth SIG, GATT 0x2A37). */
export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement {
  if (view.byteLength < 2) return { bpm: 0, rr: [], contact: null, energyKj: null };
  const flags = view.getUint8(0);
  const is16 = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const energyPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let offset = 1;
  let bpm: number;
  if (is16) {
    bpm = view.byteLength >= offset + 2 ? view.getUint16(offset, true) : 0;
    offset += 2;
  } else {
    bpm = view.getUint8(offset);
    offset += 1;
  }

  let energyKj: number | null = null;
  if (energyPresent && view.byteLength >= offset + 2) {
    energyKj = view.getUint16(offset, true);
    offset += 2;
  }

  const rr: number[] = [];
  if (rrPresent) {
    while (view.byteLength >= offset + 2) {
      // Units of 1/1024 s.
      rr.push(Math.round((view.getUint16(offset, true) / 1024) * 1000));
      offset += 2;
    }
  }

  return { bpm, rr, contact: contactSupported ? contactDetected : null, energyKj };
}

/** One stored sample: seconds since the session start, bpm, and any R-R intervals received in that second. */
export type LiveSample = [offsetSec: number, bpm: number, rr?: number[]];

/**
 * Root mean square of successive differences of R-R intervals, in ms. The HRV number WHOOP reports
 * is also RMSSD, measured during deep sleep; a daytime value is naturally lower and noisier.
 * Intervals outside 300..2000 ms or jumping more than 20% are dropped as artefacts.
 */
export function rmssd(rr: number[]): number | null {
  const clean: number[] = [];
  for (const v of rr) {
    if (v < 300 || v > 2000) continue;
    const prev = clean[clean.length - 1];
    if (prev != null && Math.abs(v - prev) / prev > 0.2) continue;
    clean.push(v);
  }
  if (clean.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < clean.length; i++) sum += (clean[i] - clean[i - 1]) ** 2;
  return Math.round(Math.sqrt(sum / (clean.length - 1)) * 10) / 10;
}

export interface LiveSessionStats {
  sampleCount: number;
  durationSec: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  rmssdMs: number | null;
}

/** Summary numbers for a run of samples; zero-bpm samples (no reading) are ignored. */
export function sessionStats(samples: LiveSample[]): LiveSessionStats {
  const hrs = samples.map((s) => s[1]).filter((v) => v > 0);
  const rr = samples.flatMap((s) => s[2] ?? []);
  const durationSec = samples.length ? Math.max(0, samples[samples.length - 1][0] - samples[0][0]) : 0;
  return {
    sampleCount: samples.length,
    durationSec,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    minHr: hrs.length ? Math.min(...hrs) : null,
    rmssdMs: rmssd(rr),
  };
}

/** Heart-rate zones as a share of max, the usual five-band split. */
export function hrZone(bpm: number, maxHr: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (bpm <= 0 || maxHr <= 0) return 0;
  const p = bpm / maxHr;
  if (p < 0.5) return 0;
  if (p < 0.6) return 1;
  if (p < 0.7) return 2;
  if (p < 0.8) return 3;
  if (p < 0.9) return 4;
  return 5;
}
