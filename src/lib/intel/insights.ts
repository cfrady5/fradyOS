import { METRICS, type Baseline, type DerivedScore, type Finding, type MetricKey, type Severity } from "./types";
import { fmtMetric } from "./findings";

export interface Insight {
  key: string;
  rank: number;
  category: "deviation" | "trend" | "score" | "pattern" | "correlation" | "status";
  severity: Severity;
  title: string;
  body: string;
  recommendation: string | null;
  href: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 100, moderate: 60, low: 30, info: 5 };
const KIND_WEIGHT: Record<Finding["kind"], number> = { deviation: 20, pattern: 15, trend: 10, correlation: 8, status: 0 };
const ENGINE_HREF: Record<Finding["engine"], string> = {
  cardio: "/health/heart",
  recovery: "/health",
  sleep: "/health/sleep",
  respiratory: "/health/breathing",
  temperature: "/health/breathing",
  activity: "/health/load",
  load: "/health/load",
  longterm: "/health/trends",
  anomaly: "/health/events",
  behavior: "/health/habits",
};

/**
 * Ranks what the engines found into a feed. Usefulness = severity, then kind (a deviation outranks a
 * trend), then recency and completeness. One insight per rule; status findings only appear when nothing
 * else does for that engine.
 */
export function rankInsights(findings: Finding[], derived: DerivedScore[], baselines: Record<MetricKey, Baseline>, today: string, limit = 12): Insight[] {
  const scored = findings
    .filter((f) => f.kind !== "status" || f.severity !== "info")
    .map((f) => {
      const ageDays = Math.max(0, (Date.parse(today) - Date.parse(f.day)) / 86_400_000);
      const score = SEVERITY_WEIGHT[f.severity] + KIND_WEIGHT[f.kind] + f.completeness * 10 - ageDays * 3;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);

  const out: Insight[] = [];
  const seenRule = new Set<string>();
  const perMetric = new Map<string, number>();
  for (const { f, score } of scored) {
    if (seenRule.has(f.rule)) continue;
    const metricKey = f.metric ?? f.rule;
    const n = perMetric.get(metricKey) ?? 0;
    if (f.kind === "deviation" && n >= 2) continue;
    perMetric.set(metricKey, n + 1);
    seenRule.add(f.rule);
    out.push({
      key: f.rule,
      rank: 0,
      category: f.kind === "status" ? "status" : f.kind,
      severity: f.severity,
      title: f.title,
      body: f.explanation,
      recommendation: f.nextStep || null,
      href: ENGINE_HREF[f.engine],
      confidence: Math.round(Math.min(1, 0.4 + f.completeness * 0.6) * 100) / 100,
      evidence: { value: f.value, baseline: f.baseline, delta: f.delta, deltaPct: f.deltaPct, method: f.method, day: f.day, score: Math.round(score), ...(f.evidence ?? {}) },
    });
    if (out.length >= limit) break;
  }

  // Score summaries sit near the top when they moved materially since yesterday.
  for (const d of derived) {
    if (d.day !== today || d.value == null) continue;
    const prev = derived.find((x) => x.key === d.key && x.day < today && x.value != null);
    const change = prev?.value != null ? d.value - prev.value : null;
    if (change != null && Math.abs(change) < 8) continue;
    const top = d.factors.filter((x) => x.score != null).sort((a, b) => Math.abs((b.score ?? 50) - 50) * b.weight - Math.abs((a.score ?? 50) - 50) * a.weight)[0];
    const label = d.key === "readiness" ? "Readiness" : d.key === "sleep_quality_index" ? "Sleep Quality Index" : d.key === "physiological_load" ? "Physiological Load" : "Health Trend";
    out.unshift({
      key: `score.${d.key}`,
      rank: 0,
      category: "score",
      severity: "info",
      title: `${label} is ${Math.round(d.value)}${change != null ? ` (${change > 0 ? "+" : ""}${Math.round(change)} since yesterday)` : ""}`,
      body: top ? `The largest factor is ${top.label.toLowerCase()}: ${top.detail}` : d.note,
      recommendation: null,
      href: d.key === "sleep_quality_index" ? "/health/sleep" : d.key === "physiological_load" ? "/health/load" : d.key === "health_trend" ? "/health/trends" : "/health",
      confidence: d.completeness,
      evidence: { factors: d.factors, version: d.version },
    });
  }

  // Baseline movers that no rule claimed, phrased plainly.
  for (const k of ["hrv_rmssd", "resting_hr", "sleep_total_min"] as MetricKey[]) {
    const b = baselines[k];
    if (!b.ready || b.last == null || b.median90 == null || b.rateOfChange == null) continue;
    if (Math.abs(b.rateOfChange) < 8 || out.some((i) => i.evidence && (i.evidence as { metric?: string }).metric === k)) continue;
    if (seenRule.has(`baseline.${k}`)) continue;
    out.push({
      key: `baseline.${k}`,
      rank: 0,
      category: "trend",
      severity: "info",
      title: `${METRICS[k].label} this week is ${Math.abs(Math.round(b.rateOfChange))}% ${b.rateOfChange > 0 ? "above" : "below"} your 30-day average`,
      body: `7-day mean ${fmtMetric(k, b.mean7)} against a 30-day mean of ${fmtMetric(k, b.mean30)} (90-day median ${fmtMetric(k, b.median90)}, ${b.n} samples).`,
      recommendation: null,
      href: ENGINE_HREF[METRICS[k].group === "sleep" ? "sleep" : "cardio"],
      confidence: 0.7,
      evidence: { metric: k, mean7: b.mean7, mean30: b.mean30, median90: b.median90 },
    });
  }

  return out.slice(0, limit).map((i, idx) => ({ ...i, rank: idx + 1 }));
}
