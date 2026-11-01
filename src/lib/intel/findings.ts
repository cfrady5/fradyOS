import { METRICS, type Baseline, type DailySummary, type EngineKey, type Finding, type FindingKind, type MetricKey, type Severity } from "./types";
import { round, robustZ, valid } from "./stats";
import { series } from "./baselines";

/** Format a metric value with its unit for explanations. */
export function fmtMetric(metric: MetricKey, v: number | null | undefined): string {
  if (v == null) return "no reading";
  const m = METRICS[metric];
  const n = round(v, m.decimals);
  if (metric === "sleep_onset_min" || metric === "wake_min") return clockFromNoon(v);
  if (m.unit === "min") {
    const h = Math.floor(Math.abs(v) / 60);
    const mm = Math.round(Math.abs(v) % 60);
    return `${v < 0 ? "-" : ""}${h ? `${h}h ` : ""}${mm}m`;
  }
  return m.unit === "%" || m.unit === "°C" ? `${n}${m.unit}` : m.unit ? `${n} ${m.unit}` : String(n);
}

/** Minutes since the previous noon back to a clock time. */
export function clockFromNoon(v: number): string {
  const mins = ((Math.round(v) + 720) % 1440 + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function severityFromZ(absZ: number, zModerate: number): Severity {
  if (absZ >= zModerate * 1.5) return "high";
  if (absZ >= zModerate) return "moderate";
  if (absZ >= zModerate * 0.6) return "low";
  return "info";
}

/** Latest value of a metric compared with its 90-day robust baseline. */
export function deviation(days: DailySummary[], metric: MetricKey, baseline: Baseline): { value: number; z: number; delta: number; deltaPct: number | null; day: string } | null {
  if (!baseline.ready || baseline.last == null || baseline.median90 == null || baseline.lastDay == null) return null;
  const hist = series(days, metric, 90).slice(0, -1);
  const z = robustZ(baseline.last, hist);
  if (z == null) return null;
  const delta = baseline.last - baseline.median90;
  return { value: baseline.last, z, delta, deltaPct: baseline.median90 ? (delta / Math.abs(baseline.median90)) * 100 : null, day: baseline.lastDay };
}

export function completenessOf(days: DailySummary[], metric: MetricKey, n: number): number {
  const s = series(days, metric, n);
  return s.length ? valid(s).length / Math.min(n, s.length) : 0;
}

export interface FindingInput {
  rule: string;
  engine: EngineKey;
  kind: FindingKind;
  metric?: MetricKey | null;
  day: string;
  severity: Severity;
  title: string;
  value?: number | null;
  baseline?: number | null;
  method: string;
  completeness: number;
  explanation: string;
  nextStep: string;
  evidence?: Record<string, unknown>;
}

export function finding(i: FindingInput): Finding {
  const value = i.value ?? null;
  const baseline = i.baseline ?? null;
  const delta = value != null && baseline != null ? value - baseline : null;
  return {
    rule: i.rule,
    engine: i.engine,
    kind: i.kind,
    metric: i.metric ?? null,
    day: i.day,
    severity: i.severity,
    title: i.title,
    value: round(value, 2),
    baseline: round(baseline, 2),
    delta: round(delta, 2),
    deltaPct: delta != null && baseline ? round((delta / Math.abs(baseline)) * 100, 1) : null,
    method: i.method,
    completeness: round(i.completeness, 2) ?? 0,
    explanation: i.explanation,
    nextStep: i.nextStep,
    evidence: i.evidence,
  };
}

export const CLINICIAN_NOTE = "This is a deviation from your own history, not a diagnosis. If it persists or you feel unwell, check with a clinician.";
