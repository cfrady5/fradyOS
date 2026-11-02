/**
 * FRADY strain and workout detection from minute heart rate.
 *
 * Load per minute follows Banister's training impulse (TRIMP): with the heart-rate-reserve fraction
 * f = (hr - rhr) / (maxHr - rhr) clipped to 0..1, the minute weight is f * 0.64 * exp(1.92 * f). The 0.64 and
 * 1.92 constants are Banister's male fit of blood lactate against %HRR (the female fit is 0.86 and 1.67);
 * the male constants are used for everyone because the profile carries no sex, which slightly overweights
 * hard minutes for some users. TRIMP is summed over minutes with skin contact and mapped to FRADY's 0..21
 * scale with 21 * (1 - exp(-trimp / K)), K = 180, so a sedentary day sits near 7, a 60-minute hard session
 * lands around 15 and a very long hard day approaches 18..19. This is FRADY strain, not WHOOP's Strain,
 * even though the range is the same.
 *
 * Workouts are runs of at least 10 minutes with heart rate at or above 60% of heart-rate reserve, tolerating
 * dips of up to 3 consecutive minutes, merged when fewer than or equal to 5 minutes apart.
 */
import { hasContact, localClock, normaliseMinutes, slotOf, isoOfSlot } from "./time";
import type { DayStrain, DerivedWorkout, HrrZone, StrapMinute, StrapProfile } from "./types";

export const TRIMP_K = 180;
export const TRIMP_A = 0.64;
export const TRIMP_B = 1.92;
/** Lower bounds of heart-rate-reserve zones 1..5. */
export const HRR_ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export const WORKOUT_PARAMS = {
  minMinutes: 10,
  hrrThreshold: 0.6,
  dipMinutes: 3,
  mergeGapMinutes: 5,
} as const;

/** Heart-rate-reserve fraction clipped to 0..1, or null when the reserve is not positive. */
export function hrrFraction(hr: number, rhr: number, maxHr: number): number | null {
  const reserve = maxHr - rhr;
  if (!(reserve > 0)) return null;
  return Math.min(1, Math.max(0, (hr - rhr) / reserve));
}

/** Banister minute weight for a heart-rate-reserve fraction. */
export const trimpWeight = (f: number): number => f * TRIMP_A * Math.exp(TRIMP_B * f);

/** FRADY strain 0..21 for a TRIMP total. */
export const strainFromTrimp = (trimp: number): number => Math.round(21 * (1 - Math.exp(-trimp / TRIMP_K)) * 10) / 10;

export function hrrZone(f: number): HrrZone {
  let z: HrrZone = 0;
  HRR_ZONE_BOUNDS.forEach((b, i) => {
    if (f >= b) z = (i + 1) as HrrZone;
  });
  return z;
}

function resolveRhr(profile: StrapProfile, restingHr: number | null): { rhr: number | null; source: DayStrain["rhrSource"] } {
  if (restingHr != null && Number.isFinite(restingHr) && restingHr > 0) return { rhr: restingHr, source: "night" };
  const hint = profile.restingHrHint;
  if (hint != null && Number.isFinite(hint) && hint > 0) return { rhr: hint, source: "profile" };
  return { rhr: null, source: "none" };
}

/** Day strain over the given minutes (normally one local calendar day). */
export function dayStrain(minutes: StrapMinute[], profile: StrapProfile, restingHr: number | null): DayStrain {
  const rows = normaliseMinutes(minutes).filter(hasContact);
  const { rhr, source } = resolveRhr(profile, restingHr);
  const maxHr = profile.maxHr != null && Number.isFinite(profile.maxHr) && profile.maxHr > 0 ? profile.maxHr : null;
  const minutesByZone: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let restMinutes = 0;
  let trimp = 0;
  let computable = rhr != null && maxHr != null && maxHr > rhr;
  let hrSum = 0;
  let hrMax: number | null = null;

  for (const m of rows) {
    const hr = m.hrAvg!;
    hrSum += hr;
    hrMax = hrMax == null ? m.hrMax ?? hr : Math.max(hrMax, m.hrMax ?? hr);
    if (!computable) continue;
    const f = hrrFraction(hr, rhr!, maxHr!);
    if (f == null) {
      computable = false;
      continue;
    }
    trimp += trimpWeight(f);
    const z = hrrZone(f);
    if (z === 0) restMinutes++;
    else minutesByZone[z - 1]++;
  }

  return {
    strain: computable && rows.length ? strainFromTrimp(trimp) : null,
    trimp: computable && rows.length ? Math.round(trimp * 10) / 10 : null,
    minutesByZone,
    restMinutes,
    avgHr: rows.length ? Math.round(hrSum / rows.length) : null,
    maxHr: hrMax == null ? null : Math.round(hrMax),
    kcal: null,
    rhrUsed: rhr,
    rhrSource: source,
    contactMinutes: rows.length,
  };
}

interface Run {
  startSlot: number;
  endSlot: number; // exclusive
}

/** Runs of at least 10 minutes at or above 60% HRR, tolerating 3-minute dips, merged when 5 minutes apart or less. */
export function detectWorkouts(minutes: StrapMinute[], profile: StrapProfile, restingHr: number | null): DerivedWorkout[] {
  const rows = normaliseMinutes(minutes);
  const { rhr } = resolveRhr(profile, restingHr);
  const maxHr = profile.maxHr;
  if (rhr == null || maxHr == null || !(maxHr > rhr) || !rows.length) return [];
  const timeZone = profile.timezone || "UTC";
  const index = new Map<number, StrapMinute>();
  for (const m of rows) index.set(slotOf(m.minute), m);
  const firstSlot = slotOf(rows[0].minute);
  const lastSlot = slotOf(rows[rows.length - 1].minute);

  const isHot = (slot: number): boolean => {
    const m = index.get(slot);
    if (!m || !hasContact(m)) return false;
    const f = hrrFraction(m.hrAvg!, rhr, maxHr);
    return f != null && f >= WORKOUT_PARAMS.hrrThreshold;
  };

  const runs: Run[] = [];
  let runStart: number | null = null;
  let lastHot = -1;
  for (let s = firstSlot; s <= lastSlot; s++) {
    if (isHot(s)) {
      if (runStart == null) runStart = s;
      lastHot = s;
    } else if (runStart != null && s - lastHot > WORKOUT_PARAMS.dipMinutes) {
      runs.push({ startSlot: runStart, endSlot: lastHot + 1 });
      runStart = null;
    }
  }
  if (runStart != null) runs.push({ startSlot: runStart, endSlot: lastHot + 1 });

  const kept = runs.filter((r) => r.endSlot - r.startSlot >= WORKOUT_PARAMS.minMinutes);
  const merged: Run[] = [];
  for (const r of kept) {
    const last = merged[merged.length - 1];
    if (last && r.startSlot - last.endSlot <= WORKOUT_PARAMS.mergeGapMinutes) last.endSlot = r.endSlot;
    else merged.push({ ...r });
  }

  return merged.map((r) => {
    const zoneMinutes = [0, 0, 0, 0, 0];
    let trimp = 0;
    let hrSum = 0;
    let n = 0;
    let hrMax = 0;
    for (let s = r.startSlot; s < r.endSlot; s++) {
      const m = index.get(s);
      if (!m || !hasContact(m)) continue;
      const hr = m.hrAvg!;
      n++;
      hrSum += hr;
      hrMax = Math.max(hrMax, m.hrMax ?? hr);
      const f = hrrFraction(hr, rhr, maxHr)!;
      trimp += trimpWeight(f);
      const z = hrrZone(f);
      if (z > 0) zoneMinutes[z - 1]++;
    }
    const duration = r.endSlot - r.startSlot;
    return {
      start: isoOfSlot(r.startSlot),
      end: isoOfSlot(r.endSlot),
      day: localClock(r.startSlot * 60_000, timeZone).day,
      durationMin: duration,
      avgHr: n ? Math.round(hrSum / n) : 0,
      maxHr: Math.round(hrMax),
      strain: strainFromTrimp(trimp),
      trimp: Math.round(trimp * 10) / 10,
      zoneShares: zoneMinutes.map((z) => (n ? Math.round((z / n) * 1000) / 1000 : 0)) as [number, number, number, number, number],
    };
  });
}
