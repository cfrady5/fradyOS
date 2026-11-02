/**
 * Minute arithmetic and local-clock helpers for the derivation layer. Pure, timezone-aware through
 * Intl only, so the same code runs in the browser, in tests and on the server.
 */
import type { StrapMinute } from "./types";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalClock {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Minutes since local midnight, 0..1439. */
  minutes: number;
  /** Minutes since the previous local noon, 0..1439. */
  sinceNoon: number;
}

/** Local clock reading for an instant in milliseconds since the epoch. */
export function localClock(ms: number, timeZone: string): LocalClock {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes, sinceNoon: minutes >= 720 ? minutes - 720 : minutes + 720 };
}

/** Minutes since the previous local noon for an ISO instant. */
export const minutesFromNoon = (iso: string, timeZone: string): number => localClock(Date.parse(iso), timeZone).sinceNoon;

/** Day arithmetic on YYYY-MM-DD strings. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of days from `from` to `to`. Empty when `to` precedes `from`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 5000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Minute slot index (minutes since the epoch) of an ISO instant. */
export const slotOf = (iso: string): number => Math.floor(Date.parse(iso) / MINUTE_MS);

/** ISO instant for a minute slot. */
export const isoOfSlot = (slot: number): string => new Date(slot * MINUTE_MS).toISOString();

/** The strap was worn and read a heart rate: a bpm is present and contact, when reported, was mostly on. */
export function hasContact(m: StrapMinute): boolean {
  return m.hrAvg != null && m.hrAvg > 0 && (m.skinContact == null || m.skinContact >= 0.5);
}

/** Sorted, deduplicated copy keyed by minute; when two rows share a minute the one with more samples wins. */
export function normaliseMinutes(minutes: StrapMinute[]): StrapMinute[] {
  const map = new Map<number, StrapMinute>();
  for (const m of minutes) {
    const slot = slotOf(m.minute);
    if (!Number.isFinite(slot)) continue;
    const prev = map.get(slot);
    if (!prev || m.samples >= prev.samples) map.set(slot, m);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);
}

/** Index of normalised minutes by slot for O(1) lookups. */
export function indexBySlot(minutes: StrapMinute[]): Map<number, StrapMinute> {
  const map = new Map<number, StrapMinute>();
  for (const m of minutes) map.set(slotOf(m.minute), m);
  return map;
}
