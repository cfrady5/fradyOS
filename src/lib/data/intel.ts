import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/data/health";
import { emptyValues, METRIC_KEYS, type Baseline, type BehaviorEntry, type DailySummary, type DerivedKey, type MetricKey, type Severity } from "@/lib/intel/types";

export interface IntelEvent {
  id: string;
  rule_key: string;
  engine: string;
  kind: string;
  metric: MetricKey | null;
  day: string;
  severity: Severity;
  status: "open" | "resolved" | "dismissed";
  title: string;
  value: number | null;
  baseline: number | null;
  delta: number | null;
  delta_pct: number | null;
  method: string;
  completeness: number;
  explanation: string;
  next_step: string;
  evidence: Record<string, unknown> | null;
  detected_at: string;
  last_seen_at: string;
}

export interface IntelDerived {
  key: DerivedKey;
  day: string;
  value: number | null;
  formula_version: string;
  factors: { key: string; label: string; weight: number; score: number | null; detail: string }[];
  completeness: number;
  note: string | null;
}

export interface IntelInsight {
  id: string;
  key: string;
  day: string;
  rank: number;
  category: string;
  severity: Severity;
  title: string;
  body: string;
  recommendation: string | null;
  href: string | null;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
}

export interface IntelCorrelation {
  key: string;
  x_label: string;
  y_label: string;
  lag_days: number;
  method: string;
  sample_n: number;
  r: number | null;
  ci_low: number | null;
  ci_high: number | null;
  diff: number | null;
  diff_ci_low: number | null;
  diff_ci_high: number | null;
  period_start: string | null;
  period_end: string | null;
  detail: Record<string, unknown> | null;
}

export interface WhoopStatus {
  connected: boolean;
  status: string | null;
  error: string | null;
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  backfillDone: boolean;
}

export interface IntelJob {
  id: string;
  kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: Record<string, unknown> | null;
}

export interface IntelPreferences {
  in_app: boolean;
  email: boolean;
  min_severity: Severity;
  z_moderate: number;
  persist_days: number;
}

export interface IntelData {
  notReady: boolean;
  hasRun: boolean;
  days: DailySummary[];
  baselines: Partial<Record<MetricKey, Baseline>>;
  events: IntelEvent[];
  derived: IntelDerived[];
  insights: IntelInsight[];
  correlations: IntelCorrelation[];
  behaviors: BehaviorEntry[];
  rulesDisabled: string[];
  preferences: IntelPreferences;
  whoop: WhoopStatus;
  jobs: IntelJob[];
  capabilities: { provider: string; metric: string; available: boolean; notes: string | null }[];
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function shapeSummary(r: Record<string, unknown>): DailySummary {
  const values = (r.values ?? {}) as Record<string, unknown>;
  const s: DailySummary = { ...emptyValues(), day: String(r.day), provider: (r.provider as DailySummary["provider"]) ?? null, completeness: num(r.completeness) ?? 0, scored: r.scored !== false };
  for (const k of METRIC_KEYS) s[k] = num(values[k]);
  return s;
}

/** Everything the intelligence screens read. Tolerates the tables not existing yet. */
export const getIntelData = cache(async (userId: string, today: string): Promise<IntelData> => {
  const supabase = await createClient();
  const from = new Date(Date.parse(today) - 179 * 86_400_000).toISOString().slice(0, 10);
  const [summaries, baselines, events, derived, insights, correlations, behaviors, rules, prefs, whoop, jobs, caps] = await Promise.all([
    supabase.from("biometric_daily_summaries").select("*").eq("user_id", userId).gte("day", from).order("day", { ascending: true }),
    supabase.from("biometric_baselines").select("metric,as_of,stats").eq("user_id", userId).order("as_of", { ascending: false }).limit(METRIC_KEYS.length * 2),
    supabase.from("biometric_detected_events").select("*").eq("user_id", userId).order("day", { ascending: false }).limit(300),
    supabase.from("biometric_derived_metrics").select("*").eq("user_id", userId).gte("day", from).order("day", { ascending: true }),
    supabase.from("biometric_insights").select("*").eq("user_id", userId).order("day", { ascending: false }).order("rank", { ascending: true }).limit(40),
    supabase.from("biometric_correlations").select("*").eq("user_id", userId),
    supabase.from("health_behaviors").select("*").eq("user_id", userId).gte("day", from).order("day", { ascending: false }).order("at", { ascending: false }),
    supabase.from("biometric_detection_rules").select("rule_key,enabled").eq("user_id", userId).eq("enabled", false),
    supabase.from("biometric_notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("whoop_connections").select("status,error_message,last_synced_at,last_webhook_at,backfill_done").eq("user_id", userId).maybeSingle(),
    supabase.from("biometric_processing_jobs").select("id,kind,status,started_at,finished_at,error,stats").eq("user_id", userId).order("started_at", { ascending: false }).limit(5),
    supabase.from("biometric_source_capabilities").select("*"),
  ]);
  const missing = [summaries, baselines, events, derived, insights].some((r) => r.error && isMissingTable(r.error));
  for (const r of [summaries, baselines, events, derived, insights, correlations, behaviors, rules, jobs]) if (r.error && !isMissingTable(r.error)) throw new Error(r.error.message);

  const baselineMap: Partial<Record<MetricKey, Baseline>> = {};
  for (const row of (baselines.data ?? []) as { metric: MetricKey; stats: Baseline }[]) if (!baselineMap[row.metric]) baselineMap[row.metric] = row.stats;

  const insightRows = ((insights.data ?? []) as Record<string, unknown>[]).map(
    (r): IntelInsight => ({ id: String(r.id), key: String(r.key), day: String(r.day), rank: num(r.rank) ?? 0, category: String(r.category), severity: r.severity as Severity, title: String(r.title), body: String(r.body), recommendation: r.recommendation ? String(r.recommendation) : null, href: r.href ? String(r.href) : null, confidence: num(r.confidence), evidence: (r.evidence as Record<string, unknown>) ?? null }),
  );
  const latestInsightDay = insightRows[0]?.day;
  const pref = (prefs.data ?? null) as Record<string, unknown> | null;
  const w = (whoop.data ?? null) as Record<string, unknown> | null;
  const jobRows = ((jobs.data ?? []) as Record<string, unknown>[]).map((r): IntelJob => ({ id: String(r.id), kind: String(r.kind), status: String(r.status), started_at: String(r.started_at), finished_at: r.finished_at ? String(r.finished_at) : null, error: r.error ? String(r.error) : null, stats: (r.stats as Record<string, unknown>) ?? null }));

  return {
    notReady: missing,
    hasRun: jobRows.some((j) => j.status === "succeeded"),
    days: ((summaries.data ?? []) as Record<string, unknown>[]).map(shapeSummary),
    baselines: baselineMap,
    events: ((events.data ?? []) as Record<string, unknown>[]).map(
      (r): IntelEvent => ({
        id: String(r.id), rule_key: String(r.rule_key), engine: String(r.engine), kind: String(r.kind), metric: (r.metric as MetricKey) ?? null, day: String(r.day), severity: r.severity as Severity, status: r.status as IntelEvent["status"], title: String(r.title), value: num(r.value), baseline: num(r.baseline), delta: num(r.delta), delta_pct: num(r.delta_pct), method: String(r.method), completeness: num(r.completeness) ?? 0, explanation: String(r.explanation), next_step: String(r.next_step), evidence: (r.evidence as Record<string, unknown>) ?? null, detected_at: String(r.detected_at), last_seen_at: String(r.last_seen_at),
      }),
    ),
    derived: ((derived.data ?? []) as Record<string, unknown>[]).map((r): IntelDerived => ({ key: r.key as DerivedKey, day: String(r.day), value: num(r.value), formula_version: String(r.formula_version), factors: (r.factors as IntelDerived["factors"]) ?? [], completeness: num(r.completeness) ?? 0, note: r.note ? String(r.note) : null })),
    insights: insightRows.filter((i) => i.day === latestInsightDay),
    correlations: ((correlations.data ?? []) as Record<string, unknown>[]).map((r): IntelCorrelation => ({ key: String(r.key), x_label: String(r.x_label), y_label: String(r.y_label), lag_days: num(r.lag_days) ?? 0, method: String(r.method), sample_n: num(r.sample_n) ?? 0, r: num(r.r), ci_low: num(r.ci_low), ci_high: num(r.ci_high), diff: num(r.diff), diff_ci_low: num(r.diff_ci_low), diff_ci_high: num(r.diff_ci_high), period_start: r.period_start ? String(r.period_start) : null, period_end: r.period_end ? String(r.period_end) : null, detail: (r.detail as Record<string, unknown>) ?? null })),
    behaviors: ((behaviors.data ?? []) as Record<string, unknown>[]).map((b): BehaviorEntry => ({ id: String(b.id), day: String(b.day), at: b.at ? String(b.at) : null, kind: b.kind as BehaviorEntry["kind"], amount: num(b.amount), unit: b.unit ? String(b.unit) : null, note: b.note ? String(b.note) : null })),
    rulesDisabled: ((rules.data ?? []) as { rule_key: string }[]).map((r) => r.rule_key),
    preferences: { in_app: pref?.in_app !== false, email: pref?.email === true, min_severity: (pref?.min_severity as Severity) ?? "moderate", z_moderate: num(pref?.z_moderate) ?? 2, persist_days: num(pref?.persist_days) ?? 3 },
    whoop: { connected: !!w && w.status !== "disconnected", status: w ? String(w.status) : null, error: w?.error_message ? String(w.error_message) : null, lastSyncedAt: w?.last_synced_at ? String(w.last_synced_at) : null, lastWebhookAt: w?.last_webhook_at ? String(w.last_webhook_at) : null, backfillDone: w?.backfill_done === true },
    jobs: jobRows,
    capabilities: ((caps.data ?? []) as Record<string, unknown>[]).map((c) => ({ provider: String(c.provider), metric: String(c.metric), available: c.available !== false, notes: c.notes ? String(c.notes) : null })),
  };
});
