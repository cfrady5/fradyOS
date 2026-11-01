import type { MetricTone } from "@/components/app/metric";

/** Pure helpers over imported health rows: windows, averages, baselines and the tones screens use. */
export interface DayStat {
  day: string;
  recovery: number | null;
  strain: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  sleep_total_min: number | null;
  sleep_performance_pct: number | null;
  sleep_efficiency_pct: number | null;
  deep_min: number | null;
  rem_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  spo2_pct: number | null;
  resp_rate: number | null;
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** The last `n` rows (rows are sorted by day ascending). */
export function lastN<T>(rows: T[], n: number): T[] {
  return rows.slice(Math.max(0, rows.length - n));
}

/** Rows within the `n` days ending at `today` (inclusive). */
export function windowDays<T extends { day: string }>(rows: T[], today: string, n: number): T[] {
  const from = shiftDay(today, -(n - 1));
  return rows.filter((r) => r.day >= from && r.day <= today);
}

export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** WHOOP's recovery bands: 67+ green, 34 to 66 yellow, under 34 red. */
export function recoveryTone(r: number | null | undefined): MetricTone {
  if (r == null) return "neutral";
  if (r >= 67) return "good";
  if (r >= 34) return "warning";
  return "serious";
}

export function sleepPerformanceTone(p: number | null | undefined): MetricTone {
  if (p == null) return "neutral";
  if (p >= 85) return "good";
  if (p >= 70) return "warning";
  return "serious";
}

/** Strain is effort, not a problem: tone only flags a very high load. */
export function strainTone(s: number | null | undefined): MetricTone {
  if (s == null) return "neutral";
  return s >= 18 ? "warning" : "neutral";
}

export function fmtHours(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function fmt1(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "–";
  return `${Math.round(v * 10) / 10}${suffix}`;
}

export function fmt0(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "–";
  return `${Math.round(v)}${suffix}`;
}

export interface HealthSummary {
  /** The most recent day with any data, or null. */
  latest: DayStat | null;
  /** Days since `latest` relative to today (0 = today). */
  staleDays: number | null;
  recovery7: number | null;
  hrv7: number | null;
  hrv30: number | null;
  rhr7: number | null;
  rhr30: number | null;
  sleep7: number | null;
  strain7: number | null;
  /** Sum of strain over the last 7 days. */
  strainWeek: number | null;
  daysTracked: number;
}

export function summarize(rows: DayStat[], today: string): HealthSummary {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const latest = [...sorted].reverse().find((r) => r.recovery != null || r.sleep_total_min != null || r.strain != null) ?? null;
  const w7 = windowDays(sorted, today, 7);
  const w30 = windowDays(sorted, today, 30);
  const strainVals = w7.map((r) => r.strain).filter((s): s is number => s != null);
  return {
    latest,
    staleDays: latest ? Math.round((Date.parse(today) - Date.parse(latest.day)) / 86_400_000) : null,
    recovery7: mean(w7.map((r) => r.recovery)),
    hrv7: mean(w7.map((r) => r.hrv_ms)),
    hrv30: mean(w30.map((r) => r.hrv_ms)),
    rhr7: mean(w7.map((r) => r.resting_hr)),
    rhr30: mean(w30.map((r) => r.resting_hr)),
    sleep7: mean(w7.map((r) => r.sleep_total_min)),
    strain7: mean(w7.map((r) => r.strain)),
    strainWeek: strainVals.length ? strainVals.reduce((a, b) => a + b, 0) : null,
    daysTracked: sorted.length,
  };
}

/** Percent change of a 7-day figure against its 30-day baseline, rounded. */
export function deltaPct(short: number | null, long: number | null): number | null {
  if (short == null || long == null || long === 0) return null;
  return Math.round(((short - long) / long) * 100);
}

/** Fill a continuous day axis so charts show gaps as gaps rather than squeezing days together. */
export function dailySeries(rows: DayStat[], today: string, n: number): { days: string[]; byDay: Map<string, DayStat> } {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(shiftDay(today, -i));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return { days, byDay };
}

export function durationMin(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
}
