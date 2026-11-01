/**
 * Anomaly engine: personalised, explainable deviation checks over the unified daily model.
 *
 * Every method is a small named function in `detectors`, so each can be tested and each finding can
 * say which method produced it. A rule runs several methods on one metric and reports the one with
 * the strongest evidence; the others that agree are listed in `evidence.methodsAgreeing` so the same
 * deviation is never reported twice. Personal rules wait for a ready baseline; the fixed safety
 * thresholds do not depend on the person and may fire earlier.
 */

import { METRICS, type DailySummary, type Engine, type EngineContext, type Finding, type MetricKey, type Severity } from "../types";
import { changePoint as cusum, ewma, mad, mean, median, quantile, robustZ as robustZStat, round, sd, trailingRun, valid } from "../stats";
import { series } from "../baselines";
import { CLINICIAN_NOTE, completenessOf, finding, fmtMetric, severityFromZ } from "../findings";

/** Shown once on the dashboard, not repeated per finding. */
export const ANOMALY_DISCLAIMER =
  "No anomaly does not mean you are healthy. These checks compare recent readings with your own history; they are not a diagnosis and cannot rule anything out.";

export type AnomalyMethod =
  | "robust_z"
  | "rolling_median"
  | "ewma_drift"
  | "change_point"
  | "persistence"
  | "cluster"
  | "rolling_mean_deficit"
  | "acute_chronic_load"
  | "fixed_threshold";

export type Direction = "up" | "down" | "both";

/** One method's verdict on one metric. `z` is always in MAD units of the personal history. */
export interface MethodResult {
  method: AnomalyMethod;
  metric: MetricKey;
  /** Day the evidence ends (the metric's last valid day). */
  day: string;
  measurement: number;
  baseline: number;
  difference: number;
  z: number;
  samples: number;
  window: number;
  detail?: Record<string, unknown>;
}

export const RULES = {
  rhrHigh: "anomaly.rhr_high",
  hrvLow: "anomaly.hrv_low",
  respChange: "anomaly.resp_rate_change",
  tempChange: "anomaly.skin_temp_change",
  spo2Trend: "anomaly.spo2_trend",
  sleepSudden: "anomaly.sleep_sudden_reduction",
  sleepExtended: "anomaly.sleep_deficiency_extended",
  recoveryLow: "anomaly.recovery_low_consecutive",
  strainSudden: "anomaly.strain_sudden_increase",
  multiMetric: "anomaly.multi_metric_deviation",
  safetySpo2: "anomaly.safety_spo2",
  safetyRhr: "anomaly.safety_rhr",
  safetyResp: "anomaly.safety_resp",
} as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: RULES.rhrHigh, label: "Unusually high resting heart rate", description: "Resting heart rate above your personal threshold by robust z, rolling median, EWMA drift, change point or persistence." },
  { rule: RULES.hrvLow, label: "Unusually low HRV", description: "HRV below your personal threshold by robust z, rolling median, EWMA drift, change point or persistence." },
  { rule: RULES.respChange, label: "Unusual respiratory rate change", description: "Respiratory rate past your personal threshold in either direction." },
  { rule: RULES.tempChange, label: "Unusual skin temperature change", description: "Skin temperature past your personal threshold in either direction." },
  { rule: RULES.spo2Trend, label: "Unusual blood oxygen trend", description: "Blood oxygen low against your history, or drifting down over at least three nights." },
  { rule: RULES.sleepSudden, label: "Sudden sleep reduction", description: "Sleep more than 90 minutes below your 30-day median or past your personal threshold." },
  { rule: RULES.sleepExtended, label: "Extended sleep deficiency", description: "Seven-day mean sleep at least 45 minutes below your personal median." },
  { rule: RULES.recoveryLow, label: "Consecutive low recovery days", description: "Recovery below your 25th percentile for the configured number of consecutive days." },
  { rule: RULES.strainSudden, label: "Sudden strain increase", description: "Day strain past your personal threshold, or a seven-day load above 1.5 times your 28-day weekly average." },
  { rule: RULES.multiMetric, label: "Multi-metric deviation", description: "Two or more of resting heart rate up, HRV down, respiratory rate up, skin temperature up and blood oxygen down on the same day." },
  { rule: RULES.safetySpo2, label: "Blood oxygen below 90%", description: "Fixed safety threshold, independent of your baseline." },
  { rule: RULES.safetyRhr, label: "Resting heart rate above 100 or below 40", description: "Fixed safety threshold, independent of your baseline." },
  { rule: RULES.safetyResp, label: "Respiratory rate above 24 or below 8", description: "Fixed safety threshold, independent of your baseline." },
];

const ENGINE = "anomaly" as const;

// ---------------------------------------------------------------------------------------------
// Windows and scales

export interface MetricWindow {
  metric: MetricKey;
  /** Last valid scored day of the metric. */
  day: string;
  value: number;
  /** Days up to and including `day`. */
  rows: DailySummary[];
  /** Trailing 90 calendar days of the metric ending on `day` (the day is the last entry). */
  full: (number | null)[];
  /** `full` without the day under test. */
  hist: (number | null)[];
}

/** The metric's last valid day and its 90-day history, excluding that day. */
export function metricWindow(days: DailySummary[], metric: MetricKey): MetricWindow | null {
  let idx = -1;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i].scored ? days[i][metric] : null;
    if (typeof v === "number" && Number.isFinite(v)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const rows = days.slice(0, idx + 1);
  const full = series(rows, metric, 90);
  return { metric, day: rows[idx].day, value: full[full.length - 1] as number, rows, full, hist: full.slice(0, -1) };
}

/** MAD scale of a history, falling back to SD when MAD is zero. Null when there is no spread. */
export function scaleOf(xs: (number | null | undefined)[]): number | null {
  const m = mad(xs);
  if (m != null && m > 0) return m;
  const s = sd(xs);
  return s != null && s > 0 ? s : null;
}

/** True when a signed z lies past the threshold in the wanted direction. */
export function past(z: number, threshold: number, direction: Direction): boolean {
  if (direction === "up") return z >= threshold;
  if (direction === "down") return z <= -threshold;
  return Math.abs(z) >= threshold;
}

// ---------------------------------------------------------------------------------------------
// Detectors

export const detectors = {
  /** Today's reading against the 90-day history excluding today, in MAD units. */
  robustZ(days: DailySummary[], metric: MetricKey): MethodResult | null {
    const w = metricWindow(days, metric);
    if (!w) return null;
    const baseline = median(w.hist);
    const z = robustZStat(w.value, w.hist);
    if (baseline == null || z == null) return null;
    return { method: "robust_z", metric, day: w.day, measurement: w.value, baseline, difference: w.value - baseline, z, samples: valid(w.hist).length, window: 90 };
  },

  /**
   * Today's reading against the median of the previous seven days, scaled by the 90-day MAD so the
   * result is comparable with the robust z. Catches a jump after a recent shift the 90-day median has
   * already absorbed.
   */
  rollingMedianDeviation(days: DailySummary[], metric: MetricKey): MethodResult | null {
    const w = metricWindow(days, metric);
    if (!w) return null;
    const last7 = w.hist.slice(-7);
    const baseline = median(last7);
    const scale = scaleOf(w.hist);
    if (baseline == null || scale == null || valid(last7).length < 3) return null;
    const difference = w.value - baseline;
    return { method: "rolling_median", metric, day: w.day, measurement: w.value, baseline, difference, z: difference / scale, samples: valid(last7).length, window: 7 };
  },

  /**
   * EWMA (alpha 0.2) of the 90-day series including today, against the 90-day median, in MAD units.
   * `detail.sameSideRun` counts the trailing nights on the same side of the median as the drift.
   */
  ewmaDrift(days: DailySummary[], metric: MetricKey): MethodResult | null {
    const w = metricWindow(days, metric);
    if (!w) return null;
    const e = ewma(w.full);
    const baseline = median(w.hist);
    const scale = scaleOf(w.hist);
    if (e == null || baseline == null || scale == null) return null;
    const difference = e - baseline;
    const sign = Math.sign(difference);
    const sameSideRun = sign === 0 ? 0 : trailingRun(w.full, (x) => Math.sign(x - baseline) === sign);
    return { method: "ewma_drift", metric, day: w.day, measurement: e, baseline, difference, z: difference / scale, samples: valid(w.full).length, window: 90, detail: { sameSideRun, latest: w.value } };
  },

  /** CUSUM change point over the last 60 days. `measurement` is the mean level since the shift. */
  changePoint(days: DailySummary[], metric: MetricKey): MethodResult | null {
    const w = metricWindow(days, metric);
    if (!w) return null;
    const xs = w.full.slice(-60);
    const cp = cusum(xs);
    if (!cp) return null;
    const before = xs.slice(0, cp.index + 1);
    const after = xs.slice(cp.index + 1);
    const baseline = median(before);
    const level = mean(after);
    const scale = scaleOf(before) ?? scaleOf(w.hist);
    if (baseline == null || level == null) return null;
    const difference = level - baseline;
    const z = scale ? difference / scale : (cp.direction === "up" ? 1 : -1) * cp.magnitude;
    const changeRow = w.rows[w.rows.length - xs.length + cp.index + 1];
    return {
      method: "change_point",
      metric,
      day: w.day,
      measurement: level,
      baseline,
      difference,
      z,
      samples: valid(xs).length,
      window: 60,
      detail: { changeDay: changeRow?.day ?? null, direction: cp.direction, magnitude: cp.magnitude, daysSince: after.length },
    };
  },

  /**
   * Consecutive trailing days whose robust z (against the 90-day history minus that day) lies past
   * the threshold in the given direction. A missing day breaks the run. Null when today is not past
   * the threshold; otherwise `detail.run` holds the count and `z` is today's value.
   */
  persistence(days: DailySummary[], metric: MetricKey, threshold: number, direction: Direction): MethodResult | null {
    const w = metricWindow(days, metric);
    if (!w) return null;
    const zs: number[] = [];
    for (let j = w.full.length - 1; j >= 0 && zs.length < 60; j--) {
      const v = w.full[j];
      if (typeof v !== "number") break;
      const hist = w.full.slice(0, j).concat(w.full.slice(j + 1));
      const z = robustZStat(v, hist);
      if (z == null || !past(z, threshold, direction)) break;
      zs.push(z);
    }
    if (!zs.length) return null;
    const baseline = median(w.hist);
    if (baseline == null) return null;
    return {
      method: "persistence",
      metric,
      day: w.day,
      measurement: w.value,
      baseline,
      difference: w.value - baseline,
      z: zs[0],
      samples: zs.length,
      window: zs.length,
      detail: { run: zs.length, threshold, direction, dailyZ: zs.map((z) => round(z, 2)) },
    };
  },

  /**
   * Metrics whose robust z lies past the threshold in the wanted direction on the same (latest) day.
   * Returns the member results and the day; null when fewer than two agree.
   */
  cluster(days: DailySummary[], members: { metric: MetricKey; direction: Direction }[], threshold: number): { day: string; members: MethodResult[]; candidates: MetricKey[] } | null {
    const results = members.map((m) => ({ ...m, r: detectors.robustZ(days, m.metric) })).filter((m) => m.r != null) as { metric: MetricKey; direction: Direction; r: MethodResult }[];
    if (results.length < 2) return null;
    const day = results.map((m) => m.r.day).sort().pop()!;
    const onDay = results.filter((m) => m.r.day === day);
    const hits = onDay.filter((m) => past(m.r.z, threshold, m.direction)).map((m) => m.r);
    if (hits.length < 2) return null;
    return { day, members: hits, candidates: onDay.map((m) => m.metric) };
  },
};

// ---------------------------------------------------------------------------------------------
// Evaluation shared by the single-metric rules

export interface Evaluation {
  best: MethodResult;
  agreeing: MethodResult[];
}

/** Persistence outranks single-day evidence; otherwise the largest deviation wins. */
function rank(a: MethodResult, b: MethodResult): number {
  if (a.method === "persistence" && b.method !== "persistence") return -1;
  if (b.method === "persistence" && a.method !== "persistence") return 1;
  return Math.abs(b.z) - Math.abs(a.z);
}

export function pickBest(hits: MethodResult[]): Evaluation | null {
  if (!hits.length) return null;
  const sorted = hits.slice().sort(rank);
  return { best: sorted[0], agreeing: sorted.slice(1) };
}

/**
 * Run the five generic methods on a metric. EWMA drift uses 0.6x the threshold because the smoothed
 * series has roughly a third of the day-to-day spread; `ewmaMinRun` demands that many trailing nights on
 * the drift's side. The rolling-median method is gated on a same-direction robust z of at least half
 * the threshold so a noisy week median does not flag an ordinary reading.
 */
export function evaluateMetric(ctx: EngineContext, metric: MetricKey, direction: Direction, opts: { ewmaMinRun?: number } = {}): Evaluation | null {
  const thr = ctx.settings.zModerate;
  const hits: MethodResult[] = [];
  const rz = detectors.robustZ(ctx.days, metric);
  if (rz && past(rz.z, thr, direction)) hits.push(rz);
  const rm = detectors.rollingMedianDeviation(ctx.days, metric);
  if (rm && rz && past(rm.z, thr, direction) && Math.sign(rm.z) === Math.sign(rz.z) && Math.abs(rz.z) >= thr * 0.5) hits.push(rm);
  const ew = detectors.ewmaDrift(ctx.days, metric);
  if (ew && past(ew.z, thr * 0.6, direction) && Number(ew.detail?.sameSideRun ?? 0) >= (opts.ewmaMinRun ?? 1)) hits.push(ew);
  const cp = detectors.changePoint(ctx.days, metric);
  if (cp && past(cp.z, thr, direction) && Number(cp.detail?.daysSince ?? 0) <= 30) hits.push(cp);
  const ps = detectors.persistence(ctx.days, metric, thr, direction);
  if (ps && ps.samples >= ctx.settings.persistDays) hits.push(ps);
  return pickBest(hits);
}

const METHOD_LABEL: Record<AnomalyMethod, string> = {
  robust_z: "robust z against your 90-day history",
  rolling_median: "deviation from your 7-day rolling median",
  ewma_drift: "EWMA drift from your 90-day median",
  change_point: "CUSUM change point over 60 days",
  persistence: "persistent deviation",
  cluster: "multi-metric cluster",
  rolling_mean_deficit: "7-day mean against your personal median",
  acute_chronic_load: "7-day load against your 28-day weekly average",
  fixed_threshold: "fixed safety threshold",
};

function z1(z: number): string {
  return `${round(Math.abs(z), 1)} MAD units`;
}

/** One sentence that names the method and the numbers it compared. */
export function describe(r: MethodResult): string {
  const m = r.metric;
  const dir = r.difference >= 0 ? "above" : "below";
  switch (r.method) {
    case "robust_z":
      return `${METRICS[m].label} was ${fmtMetric(m, r.measurement)} on ${r.day}, ${z1(r.z)} ${dir} your 90-day median of ${fmtMetric(m, r.baseline)} (${r.samples} days of history).`;
    case "rolling_median":
      return `${METRICS[m].label} was ${fmtMetric(m, r.measurement)} on ${r.day}, ${z1(r.z)} ${dir} your 7-day rolling median of ${fmtMetric(m, r.baseline)}.`;
    case "ewma_drift":
      return `The smoothed trend (EWMA) of ${METRICS[m].label.toLowerCase()} sits at ${fmtMetric(m, r.measurement)}, ${z1(r.z)} ${dir} your 90-day median of ${fmtMetric(m, r.baseline)}, after ${r.detail?.sameSideRun} nights on that side.`;
    case "change_point":
      return `A change point in ${METRICS[m].label.toLowerCase()} around ${r.detail?.changeDay}: the level since then averages ${fmtMetric(m, r.measurement)} against ${fmtMetric(m, r.baseline)} before (${z1(r.z)}).`;
    case "persistence":
      return `${METRICS[m].label} has been ${dir} your personal threshold for ${r.detail?.run} consecutive days, most recently ${fmtMetric(m, r.measurement)} against a 90-day median of ${fmtMetric(m, r.baseline)} (${z1(r.z)}).`;
    case "rolling_mean_deficit":
      return `Your 7-day mean ${METRICS[m].label.toLowerCase()} is ${fmtMetric(m, r.measurement)}, ${fmtMetric(m, Math.abs(r.difference))} ${dir} your personal median of ${fmtMetric(m, r.baseline)}.`;
    case "acute_chronic_load":
      return `Your 7-day ${METRICS[m].label.toLowerCase()} total is ${round(r.measurement, 1)}, ${round(Number(r.detail?.ratio), 2)}x your 28-day weekly average of ${round(r.baseline, 1)}.`;
    case "cluster":
    case "fixed_threshold":
      return "";
  }
}

export function evidenceOf(best: MethodResult, agreeing: MethodResult[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    measurement: round(best.measurement, 3),
    baseline: round(best.baseline, 3),
    difference: round(best.difference, 3),
    method: best.method,
    deviationLevel: round(best.z, 2),
    samples: best.samples,
    window: best.window,
    methodsAgreeing: agreeing.map((a) => ({ method: a.method, deviationLevel: round(a.z, 2), measurement: round(a.measurement, 3), baseline: round(a.baseline, 3), window: a.window })),
    ...(best.detail ?? {}),
    ...extra,
  };
}

function agreeingSentence(agreeing: MethodResult[]): string {
  if (!agreeing.length) return "";
  return ` Also flagged by ${agreeing.map((a) => METHOD_LABEL[a.method]).join(", ")}.`;
}

function ready(ctx: EngineContext, metric: MetricKey): boolean {
  return ctx.baselines[metric]?.ready === true;
}

function latest(ctx: EngineContext, metric: MetricKey): { day: string; value: number } | null {
  const w = metricWindow(ctx.days, metric);
  return w ? { day: w.day, value: w.value } : null;
}

// ---------------------------------------------------------------------------------------------
// Fixed safety thresholds

interface SafetyRule {
  rule: string;
  metric: MetricKey;
  low: number | null;
  high: number | null;
  advice: string;
}

const SAFETY: SafetyRule[] = [
  { rule: RULES.safetySpo2, metric: "spo2", low: 90, high: null, advice: "Check the strap fit and the reading on another night." },
  { rule: RULES.safetyRhr, metric: "resting_hr", low: 40, high: 100, advice: "A very low value can be normal for a trained athlete; a very high one is worth a closer look." },
  { rule: RULES.safetyResp, metric: "resp_rate", low: 8, high: 24, advice: "Check whether the night was unusual (illness, alcohol, altitude)." },
];

export function safetyCrossed(metric: MetricKey, value: number): { threshold: number; side: "low" | "high" } | null {
  const s = SAFETY.find((r) => r.metric === metric);
  if (!s) return null;
  if (s.low != null && value < s.low) return { threshold: s.low, side: "low" };
  if (s.high != null && value > s.high) return { threshold: s.high, side: "high" };
  return null;
}

function safetyFindings(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  for (const s of SAFETY) {
    const w = metricWindow(ctx.days, s.metric);
    if (!w) continue;
    const crossed = safetyCrossed(s.metric, w.value);
    if (!crossed) continue;
    const z = valid(w.hist).length >= 3 ? robustZStat(w.value, w.hist) : null;
    const label = METRICS[s.metric].label;
    out.push(
      finding({
        rule: s.rule,
        engine: ENGINE,
        kind: "deviation",
        metric: s.metric,
        day: w.day,
        severity: "high",
        title: `${label} ${crossed.side === "low" ? "below" : "above"} ${fmtMetric(s.metric, crossed.threshold)}`,
        value: w.value,
        baseline: crossed.threshold,
        method: "fixed_threshold",
        completeness: 1,
        explanation: `${label} was ${fmtMetric(s.metric, w.value)} on ${w.day}, ${crossed.side === "low" ? "below" : "above"} the fixed safety threshold of ${fmtMetric(s.metric, crossed.threshold)}. This threshold does not depend on your baseline. ${CLINICIAN_NOTE}`,
        nextStep: `${s.advice} If it repeats or you feel unwell, check with a clinician.`,
        evidence: {
          measurement: w.value,
          baseline: crossed.threshold,
          difference: round(w.value - crossed.threshold, 3),
          method: "fixed_threshold",
          deviationLevel: round(z, 2),
          samples: 1,
          window: 1,
          side: crossed.side,
          baselineReady: ready(ctx, s.metric),
        },
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rule profiles

interface Profile {
  rule: string;
  metric: MetricKey;
  direction: Direction;
  title: (r: MethodResult) => string;
  nextStep: string;
  ewmaMinRun?: number;
}

const PROFILES: Profile[] = [
  {
    rule: RULES.rhrHigh,
    metric: "resting_hr",
    direction: "up",
    title: () => "Resting heart rate unusually high",
    nextStep: "Look for a late or hard workout, alcohol, short sleep, heat or the start of an illness in the last day or two.",
  },
  {
    rule: RULES.hrvLow,
    metric: "hrv_rmssd",
    direction: "down",
    title: () => "HRV unusually low",
    nextStep: "Consider recent strain, alcohol, stress and sleep. If it stays low for several days, ease training and watch for illness.",
  },
  {
    rule: RULES.respChange,
    metric: "resp_rate",
    direction: "both",
    title: (r) => `Respiratory rate unusually ${r.difference >= 0 ? "high" : "low"}`,
    nextStep: "Respiratory rate is usually very stable for a person. Check for illness, altitude, alcohol or a poor strap fit.",
  },
  {
    rule: RULES.tempChange,
    metric: "skin_temp",
    direction: "both",
    title: (r) => `Skin temperature unusually ${r.difference >= 0 ? "high" : "low"}`,
    nextStep: "Room temperature, bedding and cycle phase move skin temperature. A rise alongside higher resting heart rate is worth watching.",
  },
  {
    rule: RULES.spo2Trend,
    metric: "spo2",
    direction: "down",
    title: () => "Blood oxygen unusually low",
    nextStep: "Check the strap fit and sleeping position. If the trend continues or you notice breathing changes, check with a clinician.",
    ewmaMinRun: 3,
  },
];

function profileFinding(ctx: EngineContext, p: Profile): Finding | null {
  if (!ready(ctx, p.metric)) return null;
  const ev = evaluateMetric(ctx, p.metric, p.direction, { ewmaMinRun: p.ewmaMinRun });
  if (!ev) return null;
  const { best, agreeing } = ev;
  const now = latest(ctx, p.metric)!;
  const crossed = safetyCrossed(p.metric, now.value);
  const severity: Severity = crossed ? "high" : severityFromZ(Math.abs(best.z), ctx.settings.zModerate);
  const bl = ctx.baselines[p.metric];
  return finding({
    rule: p.rule,
    engine: ENGINE,
    kind: "deviation",
    metric: p.metric,
    day: best.day,
    severity,
    title: p.title(best),
    value: now.value,
    baseline: best.method === "ewma_drift" || best.method === "change_point" ? bl.median90 : best.baseline,
    method: best.method,
    completeness: completenessOf(ctx.days.slice(0, ctx.days.findIndex((d) => d.day === best.day) + 1), p.metric, 90),
    explanation: `${describe(best)}${agreeingSentence(agreeing)} Compared with your own history only.`,
    nextStep: crossed ? `${p.nextStep} ${CLINICIAN_NOTE}` : p.nextStep,
    evidence: evidenceOf(best, agreeing, { latest: now.value, personalThreshold: ctx.settings.zModerate, safetyThresholdCrossed: crossed != null }),
  });
}

/** 124: today's sleep below the 30-day median by more than 90 minutes, or past the personal threshold. */
function sleepSuddenReduction(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "sleep_total_min";
  if (!ready(ctx, metric)) return null;
  const w = metricWindow(ctx.days, metric);
  if (!w) return null;
  const thr = ctx.settings.zModerate;
  const hits: MethodResult[] = [];
  const rz = detectors.robustZ(ctx.days, metric);
  if (rz && rz.z <= -thr) hits.push(rz);
  const last30 = w.hist.slice(-30);
  const median30 = median(last30);
  const scale = scaleOf(w.hist);
  if (median30 != null && scale != null) {
    const difference = w.value - median30;
    if (difference < -90) {
      hits.push({ method: "rolling_median", metric, day: w.day, measurement: w.value, baseline: median30, difference, z: difference / scale, samples: valid(last30).length, window: 30, detail: { minuteThreshold: 90 } });
    }
  }
  const ev = pickBest(hits);
  if (!ev) return null;
  const { best, agreeing } = ev;
  const text =
    best.method === "rolling_median"
      ? `You slept ${fmtMetric(metric, w.value)} on ${w.day}, ${fmtMetric(metric, Math.abs(best.difference))} less than your 30-day median of ${fmtMetric(metric, best.baseline)} (${z1(best.z)}).`
      : describe(best);
  return finding({
    rule: RULES.sleepSudden,
    engine: ENGINE,
    kind: "deviation",
    metric,
    day: w.day,
    severity: severityFromZ(Math.max(Math.abs(best.z), thr), thr),
    title: "Sudden sleep reduction",
    value: w.value,
    baseline: best.baseline,
    method: best.method,
    completeness: completenessOf(w.rows, metric, 30),
    explanation: `${text}${agreeingSentence(agreeing)} One short night is common; the pattern matters more than the night.`,
    nextStep: "Protect tonight's sleep window and avoid stacking a hard session on a short night.",
    evidence: evidenceOf(best, agreeing, { minuteThreshold: 90, personalThreshold: thr }),
  });
}

/** 125: seven-day mean sleep at least 45 minutes below the personal (90-day) median. */
function sleepDeficiencyExtended(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "sleep_total_min";
  if (!ready(ctx, metric)) return null;
  const w = metricWindow(ctx.days, metric);
  if (!w) return null;
  const last7 = w.full.slice(-7);
  const m7 = mean(last7);
  const baseline = median(w.hist);
  const scale = scaleOf(w.hist);
  if (m7 == null || baseline == null || valid(last7).length < 5) return null;
  const difference = m7 - baseline;
  if (difference > -45) return null;
  const z = scale ? difference / scale : -ctx.settings.zModerate;
  const best: MethodResult = { method: "rolling_mean_deficit", metric, day: w.day, measurement: m7, baseline, difference, z, samples: valid(last7).length, window: 7, detail: { minuteThreshold: 45 } };
  const bySeverity = severityFromZ(Math.abs(z), ctx.settings.zModerate);
  const severity: Severity = bySeverity === "info" ? "low" : bySeverity;
  return finding({
    rule: RULES.sleepExtended,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: w.day,
    severity,
    title: "Extended sleep deficiency",
    value: m7,
    baseline,
    method: best.method,
    completeness: valid(last7).length / 7,
    explanation: `${describe(best)} A week of shorter sleep tends to show up in recovery, HRV and mood before it feels like a problem.`,
    nextStep: "Aim for an earlier, consistent bedtime for the next few nights rather than a single long catch-up sleep.",
    evidence: evidenceOf(best, [], { personalThreshold: ctx.settings.zModerate }),
  });
}

/** 126: recovery below the personal 25th percentile for persistDays consecutive days. */
function recoveryLowConsecutive(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "recovery_score";
  if (!ready(ctx, metric)) return null;
  const w = metricWindow(ctx.days, metric);
  if (!w) return null;
  const p25 = quantile(w.hist, 0.25);
  if (p25 == null) return null;
  const run = trailingRun(w.full, (x) => x < p25);
  const need = ctx.settings.persistDays;
  if (run < need) return null;
  const runValues = valid(w.full.slice(-run));
  const z = robustZStat(w.value, w.hist) ?? -ctx.settings.zModerate;
  const best: MethodResult = { method: "persistence", metric, day: w.day, measurement: w.value, baseline: p25, difference: w.value - p25, z, samples: run, window: run, detail: { run, threshold: p25, thresholdKind: "p25", runMean: round(mean(runValues), 1) } };
  return finding({
    rule: RULES.recoveryLow,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: w.day,
    severity: run >= need * 2 ? "high" : "moderate",
    title: `${run} consecutive low recovery days`,
    value: w.value,
    baseline: p25,
    method: "persistence",
    completeness: completenessOf(w.rows, metric, run),
    explanation: `Recovery has been below your 25th percentile (${fmtMetric(metric, p25)}) for ${run} consecutive days, averaging ${fmtMetric(metric, mean(runValues))}; today it was ${fmtMetric(metric, w.value)} against a 90-day median of ${fmtMetric(metric, median(w.hist))}.`,
    nextStep: "Treat this as a signal to reduce load and prioritise sleep until recovery returns to your usual range.",
    evidence: evidenceOf(best, [], { median90: round(median(w.hist), 2) }),
  });
}

/** 127: day strain past the personal threshold, or seven-day load above 1.5x the 28-day weekly average. */
function strainSuddenIncrease(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "day_strain";
  if (!ready(ctx, metric)) return null;
  const w = metricWindow(ctx.days, metric);
  if (!w) return null;
  const thr = ctx.settings.zModerate;
  const hits: MethodResult[] = [];
  const rz = detectors.robustZ(ctx.days, metric);
  if (rz && rz.z >= thr) hits.push(rz);
  const last7 = valid(w.full.slice(-7));
  const last28 = valid(w.full.slice(-28));
  let ratio: number | null = null;
  if (last7.length >= 5 && last28.length >= 21) {
    const sum7 = last7.reduce((a, b) => a + b, 0);
    const weekly28 = (last28.reduce((a, b) => a + b, 0) / last28.length) * 7;
    ratio = weekly28 > 0 ? sum7 / weekly28 : null;
    // The ratio alone is unstable when strain is tiny, so the week's mean must also sit clearly above
    // the personal median (0.6x the threshold, in MAD units).
    const med = median(w.hist);
    const scale = scaleOf(w.hist);
    const weekZ = med != null && scale != null ? (sum7 / last7.length - med) / scale : null;
    if (ratio != null && ratio > 1.5 && weekZ != null && weekZ >= thr * 0.6) {
      hits.push({ method: "acute_chronic_load", metric, day: w.day, measurement: sum7, baseline: weekly28, difference: sum7 - weekly28, z: rz?.z ?? 0, samples: last7.length, window: 7, detail: { ratio: round(ratio, 2), ratioThreshold: 1.5, chronicWindow: 28, weekMeanZ: round(weekZ, 2) } });
    }
  }
  if (!hits.length) return null;
  // A single-day spike is the "sudden" evidence; the load ratio supports it when both fire.
  const best = hits.find((h) => h.method === "robust_z") ?? hits[0];
  const agreeing = hits.filter((h) => h !== best);
  const sevZ = rz && rz.z >= thr ? severityFromZ(rz.z, thr) : "info";
  const sevRatio: Severity = ratio != null && ratio > 1.5 ? (ratio >= 2 ? "high" : "moderate") : "info";
  const order: Severity[] = ["info", "low", "moderate", "high"];
  const severity = order[Math.max(order.indexOf(sevZ), order.indexOf(sevRatio))];
  return finding({
    rule: RULES.strainSudden,
    engine: ENGINE,
    kind: "deviation",
    metric,
    day: w.day,
    severity,
    title: "Sudden strain increase",
    value: best.method === "robust_z" ? w.value : best.measurement,
    baseline: best.baseline,
    method: best.method,
    completeness: completenessOf(w.rows, metric, 28),
    explanation: `${describe(best)}${agreeingSentence(agreeing)} A jump in load often precedes lower HRV and recovery over the next days.`,
    nextStep: "Build in an easier day or two; sleep and fuel to match the extra load.",
    evidence: evidenceOf(best, agreeing, { latest: w.value, loadRatio: round(ratio, 2), personalThreshold: thr }),
  });
}

/** 128: concordant deviations across the illness-shaped set of metrics on the same day. */
const CLUSTER_MEMBERS: { metric: MetricKey; direction: Direction }[] = [
  { metric: "resting_hr", direction: "up" },
  { metric: "hrv_rmssd", direction: "down" },
  { metric: "resp_rate", direction: "up" },
  { metric: "skin_temp", direction: "up" },
  { metric: "spo2", direction: "down" },
];

function multiMetricDeviation(ctx: EngineContext): Finding | null {
  const members = CLUSTER_MEMBERS.filter((m) => ready(ctx, m.metric));
  if (members.length < 2) return null;
  const c = detectors.cluster(ctx.days, members, ctx.settings.zModerate);
  if (!c) return null;
  const n = c.members.length;
  const meanAbsZ = mean(c.members.map((m) => Math.abs(m.z)))!;
  const parts = c.members.map((m) => `${METRICS[m.metric].label.toLowerCase()} ${m.difference >= 0 ? "up" : "down"} (${fmtMetric(m.metric, m.measurement)} vs ${fmtMetric(m.metric, m.baseline)}, ${z1(m.z)})`);
  return finding({
    rule: RULES.multiMetric,
    engine: ENGINE,
    kind: "pattern",
    metric: null,
    day: c.day,
    severity: n >= 3 ? "high" : "moderate",
    title: `${n} metrics deviating together`,
    value: n,
    baseline: 0,
    method: "cluster",
    completeness: c.candidates.length / CLUSTER_MEMBERS.length,
    explanation: `On ${c.day}, ${n} of ${c.candidates.length} checked metrics moved in the direction seen with illness or heavy stress: ${parts.join("; ")}. Each is measured against your own 90-day history.`,
    nextStep: `Concordant changes are more informative than any one metric. Take it easy today and watch tomorrow's readings. ${CLINICIAN_NOTE}`,
    evidence: {
      measurement: n,
      baseline: 0,
      difference: n,
      method: "cluster",
      deviationLevel: round(meanAbsZ, 2),
      samples: Math.min(...c.members.map((m) => m.samples)),
      window: 90,
      personalThreshold: ctx.settings.zModerate,
      members: c.members.map((m) => ({ metric: m.metric, measurement: round(m.measurement, 3), baseline: round(m.baseline, 3), difference: round(m.difference, 3), deviationLevel: round(m.z, 2), direction: m.difference >= 0 ? "up" : "down" })),
      checked: c.candidates,
      methodsAgreeing: [],
    },
  });
}

// ---------------------------------------------------------------------------------------------

export const anomalyEngine: Engine = (ctx) => {
  const out: Finding[] = [];
  const emit = (f: Finding | null) => {
    if (f && !ctx.settings.disabled.has(f.rule)) out.push(f);
  };
  for (const p of PROFILES) emit(profileFinding(ctx, p));
  emit(sleepSuddenReduction(ctx));
  emit(sleepDeficiencyExtended(ctx));
  emit(recoveryLowConsecutive(ctx));
  emit(strainSuddenIncrease(ctx));
  emit(multiMetricDeviation(ctx));
  for (const f of safetyFindings(ctx)) emit(f);
  return out;
};

export default anomalyEngine;
