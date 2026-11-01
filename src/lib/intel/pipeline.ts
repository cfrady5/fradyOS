import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIntelligence, type ComputeResult } from "./compute";
import { ALGORITHM_VERSION, CORE_METRICS, METRICS, METRIC_KEYS, type BehaviorEntry, type RuleSettings, type Severity } from "./types";
import { isMissingTable, shapeDay, shapeSleep, shapeWorkout } from "@/lib/data/health";
import { loadApiDays } from "@/lib/whoop/records";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

const CHUNK = 400;
const SEVERITY_ORDER: Severity[] = ["info", "low", "moderate", "high"];
const GROUP_TYPE: Record<string, string> = { sleep: "sleep", activity: "daily", cardio: "daily", recovery: "daily", respiratory: "sleep", temperature: "sleep" };

export interface RunOptions {
  kind: "recompute" | "import" | "whoop_sync" | "whoop_webhook" | "scheduled";
  today: string;
  timezone: string;
}

export interface RunStats {
  days: number;
  findings: number;
  newEvents: number;
  resolved: number;
  insights: number;
  notified: number;
  engineErrors: { engine: string; message: string }[];
}

async function chunked(client: Client, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Loads everything the engines need for one user. Tolerates tables that are not created yet. */
export async function loadInputs(client: Client, userId: string, timezone: string) {
  const [days, sleeps, workouts, behaviors, prefs, rules] = await Promise.all([
    client.from("health_days").select("*").eq("user_id", userId).order("day", { ascending: true }).limit(400),
    client.from("health_sleeps").select("*").eq("user_id", userId).order("start_at", { ascending: true }).limit(800),
    client.from("health_workouts").select("*").eq("user_id", userId).order("start_at", { ascending: true }).limit(1500),
    client.from("health_behaviors").select("*").eq("user_id", userId).order("day", { ascending: true }).limit(2000),
    client.from("biometric_notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
    client.from("biometric_detection_rules").select("rule_key,enabled").eq("user_id", userId),
  ]);
  for (const r of [days, sleeps, workouts]) if (r.error && !isMissingTable(r.error)) throw new Error(r.error.message);
  const apiDays = await loadApiDays(client, userId, timezone);
  const pref = (prefs.data ?? null) as { in_app: boolean; email: boolean; min_severity: Severity; z_moderate: number; persist_days: number } | null;
  const disabled = new Set(((rules.data ?? []) as { rule_key: string; enabled: boolean }[]).filter((r) => !r.enabled).map((r) => r.rule_key));
  const settings: Partial<RuleSettings> = { zModerate: pref?.z_moderate ?? 2, persistDays: pref?.persist_days ?? 3, disabled };
  const behaviorRows = (behaviors.data ?? []) as Record<string, unknown>[];
  return {
    days: ((days.data ?? []) as Record<string, unknown>[]).map(shapeDay),
    sleeps: ((sleeps.data ?? []) as Record<string, unknown>[]).map(shapeSleep),
    workouts: ((workouts.data ?? []) as Record<string, unknown>[]).map(shapeWorkout),
    apiDays,
    behaviors: behaviorRows.map(
      (b): BehaviorEntry => ({
        id: String(b.id),
        day: String(b.day),
        at: b.at ? String(b.at) : null,
        kind: b.kind as BehaviorEntry["kind"],
        amount: typeof b.amount === "number" ? b.amount : b.amount == null ? null : Number(b.amount),
        unit: b.unit ? String(b.unit) : null,
        note: b.private ? null : b.note ? String(b.note) : null,
      }),
    ),
    settings,
    pref: pref ?? { in_app: true, email: false, min_severity: "moderate" as Severity, z_moderate: 2, persist_days: 3 },
  };
}

/** Normalise, baseline, detect, score, rank and persist. Idempotent: every write is an upsert keyed by natural identity. */
export async function runHealthIntelligence(client: Client, userId: string, opts: RunOptions): Promise<{ ok: true; stats: RunStats; result: ComputeResult } | { ok: false; error: string }> {
  const { data: job } = await client.from("biometric_processing_jobs").insert({ user_id: userId, kind: opts.kind, status: "running" }).select("id").single();
  const jobId = (job as { id: string } | null)?.id;
  const finish = async (patch: Record<string, unknown>) => {
    if (jobId) await client.from("biometric_processing_jobs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", jobId);
  };
  try {
    const inputs = await loadInputs(client, userId, opts.timezone);
    const result = computeIntelligence({ ...inputs, today: opts.today, timezone: opts.timezone });
    const stats = await persist(client, userId, result, inputs.pref, opts);
    await finish({ status: "succeeded", stats, window_start: result.calendar[0]?.day ?? null, window_end: opts.today });
    return { ok: true, stats, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ status: "failed", error });
    return { ok: false, error };
  }
}

async function persist(client: Client, userId: string, r: ComputeResult, pref: { in_app: boolean; min_severity: Severity }, opts: RunOptions): Promise<RunStats> {
  const now = new Date().toISOString();

  // Measurements: one row per present metric per day; core metrics that are missing on a scored day are recorded as missing.
  const measurements: Record<string, unknown>[] = [];
  for (const s of r.summaries) {
    const provider = s.provider ?? "whoop_export";
    for (const k of METRIC_KEYS) {
      const v = s[k];
      const missing = v == null;
      if (missing && !CORE_METRICS.includes(k)) continue;
      measurements.push({
        user_id: userId,
        metric: k,
        day: s.day,
        value: missing ? null : v,
        unit: METRICS[k].unit,
        provider,
        measurement_type: GROUP_TYPE[METRICS[k].group] ?? "daily",
        availability: missing ? (s.scored ? "missing" : "unscored") : "available",
        quality: "ok",
        synced_at: now,
        algorithm_version: ALGORITHM_VERSION,
      });
    }
  }
  await chunked(client, "biometric_measurements", measurements, "user_id,provider,metric,day");

  await chunked(
    client,
    "biometric_daily_summaries",
    r.summaries.map((s) => {
      const values: Record<string, number | null> = {};
      for (const k of METRIC_KEYS) values[k] = s[k];
      return { user_id: userId, day: s.day, provider: s.provider, values, completeness: s.completeness, scored: s.scored, algorithm_version: r.version, computed_at: now };
    }),
    "user_id,day",
  );

  await chunked(
    client,
    "biometric_baselines",
    METRIC_KEYS.map((k) => ({ user_id: userId, metric: k, as_of: opts.today, version: r.baselines[k].version, sample_n: r.baselines[k].n, ready: r.baselines[k].ready, stats: r.baselines[k], computed_at: now })),
    "user_id,metric,as_of,version",
  );

  // Events: upsert current findings, keep dismissed ones dismissed, resolve open ones no longer detected.
  const { data: existingRows } = await client.from("biometric_detected_events").select("rule_key,day,status").eq("user_id", userId).in("status", ["open", "dismissed"]);
  const existing = new Map(((existingRows ?? []) as { rule_key: string; day: string; status: string }[]).map((e) => [`${e.rule_key}|${e.day}`, e.status]));
  const currentKeys = new Set(r.findings.map((f) => `${f.rule}|${f.day}`));
  const currentRules = new Set(r.findings.map((f) => f.rule));
  let newEvents = 0;
  const notify: typeof r.findings = [];
  const eventRows = r.findings.map((f) => {
    const key = `${f.rule}|${f.day}`;
    const prior = existing.get(key);
    if (!prior) {
      newEvents++;
      if (f.kind !== "status" && SEVERITY_ORDER.indexOf(f.severity) >= SEVERITY_ORDER.indexOf(pref.min_severity)) notify.push(f);
    }
    return {
      user_id: userId,
      rule_key: f.rule,
      engine: f.engine,
      kind: f.kind,
      metric: f.metric,
      day: f.day,
      severity: f.severity,
      status: prior === "dismissed" ? "dismissed" : "open",
      title: f.title.slice(0, 200),
      value: f.value,
      baseline: f.baseline,
      delta: f.delta,
      delta_pct: f.deltaPct,
      method: f.method.slice(0, 120),
      completeness: f.completeness,
      explanation: f.explanation.slice(0, 2000),
      next_step: f.nextStep.slice(0, 1000),
      evidence: f.evidence ?? null,
      algorithm_version: r.version,
      last_seen_at: now,
      resolved_at: null,
    };
  });
  await chunked(client, "biometric_detected_events", eventRows, "user_id,rule_key,day");
  let resolved = 0;
  const toResolve = [...existing.entries()].filter(([key, status]) => status === "open" && !currentKeys.has(key) && !currentRules.has(key.split("|")[0]));
  for (const [key] of toResolve) {
    const [rule_key, day] = key.split("|");
    const { error } = await client.from("biometric_detected_events").update({ status: "resolved", resolved_at: now }).eq("user_id", userId).eq("rule_key", rule_key).eq("day", day);
    if (!error) resolved++;
  }

  await chunked(
    client,
    "biometric_derived_metrics",
    r.derived.map((d) => ({ user_id: userId, key: d.key, day: d.day, value: d.value, formula_version: d.version, factors: d.factors, completeness: d.completeness, note: d.note, computed_at: now })),
    "user_id,key,day",
  );

  await chunked(
    client,
    "biometric_correlations",
    r.correlations.map((c) => ({
      user_id: userId,
      key: c.key,
      x_label: c.xLabel,
      y_label: c.yLabel,
      lag_days: c.lagDays,
      method: c.method,
      sample_n: c.n,
      r: c.r,
      ci_low: c.ciLow,
      ci_high: c.ciHigh,
      diff: c.diff,
      diff_ci_low: c.diffCiLow,
      diff_ci_high: c.diffCiHigh,
      period_start: c.periodStart,
      period_end: c.periodEnd,
      detail: c.detail,
      computed_at: now,
    })),
    "user_id,key",
  );

  await client.from("biometric_insights").delete().eq("user_id", userId).eq("day", opts.today);
  await chunked(
    client,
    "biometric_insights",
    r.insights.map((i) => ({ user_id: userId, key: i.key, day: opts.today, rank: i.rank, category: i.category, severity: i.severity, title: i.title.slice(0, 200), body: i.body.slice(0, 2000), recommendation: i.recommendation, href: i.href, confidence: i.confidence, evidence: i.evidence, generated_at: now })),
    "user_id,key,day",
  );

  let notified = 0;
  if (pref.in_app && notify.length) {
    const rows = notify.slice(0, 10).map((f) => ({
      user_id: userId,
      kind: "health",
      title: f.title.slice(0, 200),
      body: f.explanation.slice(0, 500),
      href: "/health/events",
      entity_type: "biometric_event",
      dedupe_key: `biometric:${f.rule}:${f.day}`,
    }));
    const { error } = await client.from("notifications").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    if (!error) notified = rows.length;
  }

  return { days: r.summaries.length, findings: r.findings.length, newEvents, resolved, insights: r.insights.length, notified, engineErrors: r.engineErrors };
}
