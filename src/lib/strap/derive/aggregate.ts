/**
 * Minute aggregation: turns raw transport records into one StrapMinute per UTC minute.
 *
 * - Heart rate ignores zero readings and samples the device flagged as off-skin.
 * - Motion is the mean magnitude of the change in the gravity vector per second between successive
 *   samples (g/s). A perfectly still wrist gives 0. The previous minute's last gravity sample seeds the
 *   first difference when it is at most 5 s older, so one-sample-per-minute feeds still get a value.
 * - R-R intervals are concatenated oldest first and capped at 200 per minute; zero intervals (placeholders)
 *   are dropped.
 * - Raw optical, thermal and respiration channels are averaged as plain numbers; they stay uncalibrated.
 */
import { mean } from "@/lib/intel/stats";
import { MINUTE_MS, normaliseMinutes } from "./time";
import type { StrapMinute, StrapRecord } from "./types";

export const RR_PER_MINUTE_CAP = 200;
/** Largest gap between two gravity samples that still yields a motion difference. */
const MAX_MOTION_GAP_S = 5;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function minuteKey(unixSeconds: number): number {
  return Math.floor(unixSeconds / 60);
}

export function aggregateMinutes(records: StrapRecord[]): StrapMinute[] {
  const sorted = records.filter((r) => isNum(r.unix)).slice().sort((a, b) => a.unix - b.unix);
  const groups = new Map<number, StrapRecord[]>();
  for (const r of sorted) {
    const k = minuteKey(r.unix);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const out: StrapMinute[] = [];
  let prevGravity: { unix: number; g: [number, number, number] } | null = null;

  for (const [k, recs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const hr: number[] = [];
    const rr: number[] = [];
    const motionRates: number[] = [];
    const temps: number[] = [];
    const reds: number[] = [];
    const irs: number[] = [];
    const resps: number[] = [];
    let contactReported = 0;
    let contactOn = 0;

    for (const r of recs) {
      if (r.skinContact != null) {
        contactReported++;
        if (r.skinContact) contactOn++;
      }
      if (isNum(r.hr) && r.hr > 0 && r.skinContact !== false) hr.push(r.hr);
      for (const v of r.rr ?? []) if (isNum(v) && v > 0 && rr.length < RR_PER_MINUTE_CAP) rr.push(v);
      if (r.gravity && r.gravity.length === 3 && r.gravity.every(isNum)) {
        const g = r.gravity;
        if (prevGravity) {
          const dt = r.unix - prevGravity.unix;
          if (dt > 0 && dt <= MAX_MOTION_GAP_S) {
            const d = Math.hypot(g[0] - prevGravity.g[0], g[1] - prevGravity.g[1], g[2] - prevGravity.g[2]);
            motionRates.push(d / dt);
          }
        }
        prevGravity = { unix: r.unix, g: [g[0], g[1], g[2]] };
      }
      if (isNum(r.rawSkinTemp)) temps.push(r.rawSkinTemp);
      if (r.rawSpo2 && isNum(r.rawSpo2.red) && isNum(r.rawSpo2.ir)) {
        reds.push(r.rawSpo2.red);
        irs.push(r.rawSpo2.ir);
      }
      if (isNum(r.rawResp)) resps.push(r.rawResp);
    }

    const red = mean(reds);
    const ir = mean(irs);
    out.push({
      minute: new Date(k * MINUTE_MS).toISOString(),
      hrAvg: hr.length ? Math.round(mean(hr)! * 10) / 10 : null,
      hrMin: hr.length ? Math.min(...hr) : null,
      hrMax: hr.length ? Math.max(...hr) : null,
      rr,
      motion: motionRates.length ? mean(motionRates) : null,
      skinContact: contactReported ? contactOn / contactReported : null,
      rawSkinTemp: mean(temps),
      rawSpo2: red != null && ir != null ? { red, ir } : null,
      rawResp: mean(resps),
      samples: recs.length,
    });
  }
  return out;
}

/**
 * Merges two minute series keyed by minute. When both hold the same minute the row with more samples
 * wins (a re-offload with more complete data replaces a thin live capture); ties go to `incoming`.
 */
export function mergeMinutes(existing: StrapMinute[], incoming: StrapMinute[]): StrapMinute[] {
  return normaliseMinutes([...existing, ...incoming]);
}
