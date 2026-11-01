/**
 * Long-term engine: 90-day direction of the core measures, monthly series for the dashboard and the
 * experimental Health Trend summary.
 *
 * Health Trend is a direction summary of the person's own 90-day slopes. It is labelled experimental
 * and is not a biological age or any other population-referenced figure.
 */

import { METRICS, type DerivedScore, type EngineContext, type Finding, type MetricKey } from "../types";
import { mad, mean, round, sd, slope, tail, valid } from "../stats";
import { series } from "../baselines";
import { completenessOf, finding, fmtMetric } from "../findings";

const ENGINE = "longterm" as const;
export const TREND_VERSION = "trend.v1";

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "longterm.rhr_improvement", label: "Resting heart rate improving", description: "90-day downward slope of at least 2 bpm with the 30-day mean below the 60-day mean." },
  { rule: "longterm.hrv_improvement", label: "HRV improving", description: "90-day upward slope of at least 5 ms with the 30-day mean above the 60-day mean." },
  { rule: "longterm.sleep_consistency_change", label: "Sleep consistency change", description: "Sleep consistency moved by 5 points or more over 90 days." },
  { rule: "longterm.sleep_efficiency_change", label: "Sleep efficiency change", description: "Sleep efficiency moved by 3 points or more over 90 days." },
  { rule: "longterm.cardiovascular_load_change", label: "Cardiovascular load change", description: "Day strain moved by 2 points or more over 90 days." },
  { rule: "longterm.recovery_consistency", label: "Recovery consistency change", description: "Coefficient of variation of recovery over the last 90 days against the period before." },
  { rule: "longterm.activity_consistency", label: "Activity consistency change", description: "Coefficient of variation of day strain over the last 90 days against the period before." },
  { rule: "longterm.respiratory_stability", label: "Respiratory stability", description: "Whether overnight respiratory rate has stayed tight and level over 90 days." },
  { rule: "longterm.skin_temp_stability", label: "Skin temperature stability", description: "Whether overnight skin temperature has stayed tight and level over 90 days." },
  { rule: "longterm.multi_month_summary", label: "Multi-month change summary", description: "Which measures moved materially over the last 90 days." },
];

const SERIES_METRICS: MetricKey[] = ["resting_hr", "hrv_rmssd", "recovery_score", "sleep_total_min", "sleep_consistency", "sleep_efficiency", "day_strain", "resp_rate", "skin_temp", "spo2"];
const TREND_METRICS: MetricKey[] = ["resting_hr", "hrv_rmssd", "sleep_consistency", "sleep_efficiency", "recovery_score"];
const MIN_TREND_DAYS = 60;

export interface LongTermSeries {
  metric: MetricKey;
  monthly: { month: string; mean: number | null; n: number }[];
  slope90: number | null;
}

/** Monthly means over the full history plus the 90-day slope, per dashboard metric. */
export function longTermSeries(ctx: EngineContext): LongTermSeries[] {
  return SERIES_METRICS.map((metric) => {
    const buckets = new Map<string, number[]>();
    for (const d of ctx.days) {
      const month = d.day.slice(0, 7);
      if (!buckets.has(month)) buckets.set(month, []);
      const v = d.scored ? d[metric] : null;
      if (typeof v === "number" && Number.isFinite(v)) buckets.get(month)!.push(v);
    }
    const monthly = [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, vs]) => ({ month, mean: round(mean(vs), METRICS[metric].decimals + 1), n: vs.length }));
    return { metric, monthly, slope90: round(slope(series(ctx.days, metric, 90)), 5) };
  });
}

function cv(xs: (number | null)[]): number | null {
  const v = valid(xs);
  const m = mean(v);
  const s = sd(v);
  return v.length >= 14 && m != null && s != null && m !== 0 ? s / Math.abs(m) : null;
}

/** Scored days in the last 90 that carry at least one of the trend inputs. */
function scoredDays(ctx: EngineContext): number {
  return tail(ctx.days, 90).filter((d) => d.scored && TREND_METRICS.some((m) => typeof d[m] === "number")).length;
}

/**
 * Experimental Health Trend: 0..100 where 50 is no change. Each input's 90-day slope is scaled by its own
 * 90-day MAD (change over 90 days in MAD units, clipped to -1..1), signed so that positive is better, and
 * averaged. Day strain enters as an activity-consistency proxy via the change in its CV, not its slope.
 */
export function healthTrend(ctx: EngineContext, day?: string): DerivedScore {
  const idx = day == null ? ctx.days.length - 1 : ctx.days.findIndex((d) => d.day === day);
  const days = idx >= 0 ? ctx.days.slice(0, idx + 1) : ctx.days;
  const sub: EngineContext = { ...ctx, days };
  const dayKey = idx >= 0 ? ctx.days[idx].day : day ?? ctx.today;
  const factors: DerivedScore["factors"] = [];
  const directions: number[] = [];
  const n = scoredDays(sub);
  const enough = n >= MIN_TREND_DAYS;

  for (const metric of TREND_METRICS) {
    const meta = METRICS[metric];
    const s90 = series(days, metric, 90);
    const sl = slope(s90);
    const scale = mad(s90);
    let dir: number | null = null;
    if (enough && sl != null && scale != null && scale > 0 && valid(s90).length >= 30) {
      dir = Math.max(-1, Math.min(1, (sl * 90) / scale));
      if (meta.better === "lower") dir = -dir;
    }
    if (dir != null) directions.push(dir);
    factors.push({
      key: metric,
      label: meta.label,
      weight: 0,
      score: dir == null ? null : round(50 + 50 * dir, 1),
      detail: sl == null || scale == null ? "Not enough history for a 90-day direction." : `${fmtMetric(metric, sl * 90).replace("no reading", "0")} change over 90 days against a MAD of ${round(scale, meta.decimals + 1)}; ${dir == null ? "excluded" : dir > 0.05 ? "moving in the favourable direction" : dir < -0.05 ? "moving in the unfavourable direction" : "little change"}.`,
    });
  }
  // Activity consistency proxy: change in CV of day strain, first half of the 90-day window against the second.
  {
    const s90 = series(days, "day_strain", 90);
    const half = Math.floor(s90.length / 2);
    const cvA = cv(s90.slice(0, half));
    const cvB = cv(s90.slice(half));
    let dir: number | null = null;
    if (enough && cvA != null && cvB != null && cvA > 0) dir = Math.max(-1, Math.min(1, (cvA - cvB) / cvA));
    if (dir != null) directions.push(dir);
    factors.push({
      key: "activity_consistency",
      label: "Activity consistency",
      weight: 0,
      score: dir == null ? null : round(50 + 50 * dir, 1),
      detail: cvA == null || cvB == null ? "Not enough strain history for a consistency comparison." : `Day strain CV ${round(cvA, 2)} in the first half of the window and ${round(cvB, 2)} in the second; ${dir == null ? "excluded" : dir > 0.05 ? "more even" : dir < -0.05 ? "less even" : "little change"}.`,
    });
  }

  const included = factors.filter((f) => f.score != null);
  for (const f of factors) f.weight = included.length && f.score != null ? round(100 / included.length, 1)! : 0;
  const value = enough && directions.length >= 3 ? 50 + 50 * (directions.reduce((a, b) => a + b, 0) / directions.length) : null;
  return {
    key: "health_trend",
    day: dayKey,
    value: round(value, 1),
    version: TREND_VERSION,
    factors,
    completeness: round(Math.min(1, n / 90), 2) ?? 0,
    note: `Health Trend is an experimental direction summary, not a biological age. 50 means no change over the last 90 days; above 50 means your own measures (resting HR, HRV, sleep consistency, sleep efficiency, recovery and activity consistency) have on balance moved in the favourable direction, below 50 the reverse. ${enough ? `Based on ${n} scored days.` : `Needs ${MIN_TREND_DAYS} scored days; ${n} so far.`}`,
  };
}

interface Movement {
  metric: MetricKey;
  change90: number;
  madUnits: number;
  direction: "up" | "down";
}

function movement(ctx: EngineContext, metric: MetricKey): Movement | null {
  const s90 = series(ctx.days, metric, 90);
  if (valid(s90).length < 30) return null;
  const sl = slope(s90);
  const scale = mad(s90);
  if (sl == null || scale == null || scale <= 0) return null;
  const change90 = sl * 90;
  return { metric, change90, madUnits: change90 / scale, direction: change90 >= 0 ? "up" : "down" };
}

export function longtermEngine(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const on = (rule: string) => !ctx.settings.disabled.has(rule);
  const day = ctx.today;
  const trendMethod = "Ordinary least-squares slope over 90 days, expressed as change across the period";

  // 109 RHR improvement.
  const rhr = ctx.baselines.resting_hr;
  const rhrMove = movement(ctx, "resting_hr");
  if (on("longterm.rhr_improvement") && rhr.ready && rhrMove && rhrMove.change90 <= -2 && rhr.mean30 != null && rhr.mean60 != null && rhr.mean30 < rhr.mean60) {
    out.push(
      finding({
        rule: "longterm.rhr_improvement",
        engine: ENGINE,
        kind: "trend",
        metric: "resting_hr",
        day: rhr.lastDay ?? day,
        severity: "info",
        title: "Resting heart rate trending lower over three months",
        value: rhr.mean30,
        baseline: rhr.mean60,
        method: trendMethod,
        completeness: completenessOf(ctx.days, "resting_hr", 90),
        explanation: `Resting heart rate has fallen about ${round(Math.abs(rhrMove.change90), 1)} bpm across the last 90 days; the 30-day mean (${fmtMetric("resting_hr", rhr.mean30)}) is below the 60-day mean (${fmtMetric("resting_hr", rhr.mean60)}).`,
        nextStep: "A gradual fall in resting heart rate is a common sign of improving aerobic fitness or better recovery. Nothing to do but keep it up.",
        evidence: { change90: round(rhrMove.change90, 2), madUnits: round(rhrMove.madUnits, 2), slope90: round(rhr.slope90, 5) },
      }),
    );
  }

  // 110 HRV improvement.
  const hrv = ctx.baselines.hrv_rmssd;
  const hrvMove = movement(ctx, "hrv_rmssd");
  if (on("longterm.hrv_improvement") && hrv.ready && hrvMove && hrvMove.change90 >= 5 && hrv.mean30 != null && hrv.mean60 != null && hrv.mean30 > hrv.mean60) {
    out.push(
      finding({
        rule: "longterm.hrv_improvement",
        engine: ENGINE,
        kind: "trend",
        metric: "hrv_rmssd",
        day: hrv.lastDay ?? day,
        severity: "info",
        title: "HRV trending higher over three months",
        value: hrv.mean30,
        baseline: hrv.mean60,
        method: trendMethod,
        completeness: completenessOf(ctx.days, "hrv_rmssd", 90),
        explanation: `HRV has risen about ${round(hrvMove.change90, 1)} ms across the last 90 days; the 30-day mean (${fmtMetric("hrv_rmssd", hrv.mean30)}) is above the 60-day mean (${fmtMetric("hrv_rmssd", hrv.mean60)}).`,
        nextStep: "A slow rise in HRV usually accompanies consistent training and sleep. It is a direction in your own data, not a fitness score.",
        evidence: { change90: round(hrvMove.change90, 2), madUnits: round(hrvMove.madUnits, 2), slope90: round(hrv.slope90, 5) },
      }),
    );
  }

  // 111 to 113 either-direction changes.
  const changeRule = (rule: string, metric: MetricKey, threshold: number, label: string, unit: (v: number) => string) => {
    if (!on(rule)) return;
    const b = ctx.baselines[metric];
    const mv = movement(ctx, metric);
    if (!b.ready || !mv || Math.abs(mv.change90) < threshold) return;
    out.push(
      finding({
        rule,
        engine: ENGINE,
        kind: "trend",
        metric,
        day: b.lastDay ?? day,
        severity: "info",
        title: `${label} ${mv.direction} over three months`,
        value: b.mean30,
        baseline: b.mean60,
        method: trendMethod,
        completeness: completenessOf(ctx.days, metric, 90),
        explanation: `${label} has moved ${mv.direction} by about ${unit(Math.abs(mv.change90))} across the last 90 days (${round(Math.abs(mv.madUnits), 1)} MAD units). The 30-day mean is ${fmtMetric(metric, b.mean30)} against a 60-day mean of ${fmtMetric(metric, b.mean60)}.`,
        nextStep: "Three-month movements are slow and usually reflect routine rather than any one event.",
        evidence: { change90: round(mv.change90, 2), madUnits: round(mv.madUnits, 2), slope90: round(b.slope90, 5) },
      }),
    );
  };
  changeRule("longterm.sleep_consistency_change", "sleep_consistency", 5, "Sleep consistency", (v) => `${round(v, 0)} points`);
  changeRule("longterm.sleep_efficiency_change", "sleep_efficiency", 3, "Sleep efficiency", (v) => `${round(v, 1)} points`);
  changeRule("longterm.cardiovascular_load_change", "day_strain", 2, "Day strain", (v) => `${round(v, 1)} points`);

  // 114 and 115 consistency changes: CV over the last 90 days against the period before (or the two halves).
  const consistencyRule = (rule: string, metric: MetricKey, label: string) => {
    if (!on(rule)) return;
    const all = series(ctx.days, metric, 180);
    const last90 = tail(all, 90);
    const before = all.slice(0, Math.max(0, all.length - 90));
    let recent: (number | null)[];
    let prior: (number | null)[];
    let method: string;
    if (valid(before).length >= 30) {
      recent = last90;
      prior = before;
      method = "Coefficient of variation over the last 90 days against the previous 90";
    } else {
      const half = Math.floor(last90.length / 2);
      prior = last90.slice(0, half);
      recent = last90.slice(half);
      method = "Coefficient of variation over the second half of the last 90 days against the first half";
    }
    const cvRecent = cv(recent);
    const cvPrior = cv(prior);
    if (cvRecent == null || cvPrior == null || cvPrior === 0) return;
    const rel = (cvRecent - cvPrior) / cvPrior;
    if (Math.abs(rel) < 0.25) return;
    out.push(
      finding({
        rule,
        engine: ENGINE,
        kind: "trend",
        metric,
        day: ctx.baselines[metric].lastDay ?? day,
        severity: "info",
        title: `${label} has become ${rel < 0 ? "more" : "less"} consistent`,
        value: cvRecent,
        baseline: cvPrior,
        method,
        completeness: completenessOf(ctx.days, metric, 90),
        explanation: `Day-to-day variation in ${label.toLowerCase()} (CV) is ${round(cvRecent, 2)} recently against ${round(cvPrior, 2)} before, a ${Math.round(Math.abs(rel) * 100)}% ${rel < 0 ? "fall" : "rise"} in relative spread.`,
        nextStep: rel < 0 ? "Steadier readings usually follow a steadier routine." : "Wider swings can be planned (hard and easy weeks) or a sign of an unsettled routine.",
        evidence: { cvRecent: round(cvRecent, 3), cvPrior: round(cvPrior, 3), relChange: round(rel, 3) },
      }),
    );
  };
  consistencyRule("longterm.recovery_consistency", "recovery_score", "Recovery");
  consistencyRule("longterm.activity_consistency", "day_strain", "Activity");

  // 116 and 117 stability statuses.
  const stabilityRule = (rule: string, metric: MetricKey, sdLimit: number, shiftLimit: number, label: string) => {
    if (!on(rule)) return;
    const b = ctx.baselines[metric];
    if (!b.ready || b.sd90 == null || b.slope90 == null || b.n < 30) return;
    const shift = b.slope90 * 90;
    const stable = b.sd90 <= sdLimit && Math.abs(shift) < shiftLimit;
    out.push(
      finding({
        rule,
        engine: ENGINE,
        kind: "status",
        metric,
        day: b.lastDay ?? day,
        severity: "info",
        title: stable ? `${label} has been stable over three months` : `${label} has varied over three months`,
        value: b.sd90,
        baseline: sdLimit,
        method: `90-day standard deviation at or below ${sdLimit} and 90-day change under ${shiftLimit}`,
        completeness: completenessOf(ctx.days, metric, 90),
        explanation: `${label} had a 90-day standard deviation of ${round(b.sd90, 2)} ${METRICS[metric].unit} and drifted ${round(shift, 2)} ${METRICS[metric].unit} across the period around a median of ${fmtMetric(metric, b.median90)}.`,
        nextStep: stable ? "A tight, level overnight series makes any future deviation easier to spot." : "A wider spread lowers the sensitivity of deviation alerts for this measure; the baseline adapts automatically.",
        evidence: { sd90: round(b.sd90, 3), change90: round(shift, 3), n: b.n },
      }),
    );
  };
  stabilityRule("longterm.respiratory_stability", "resp_rate", 1.0, 1.0, "Overnight respiratory rate");
  stabilityRule("longterm.skin_temp_stability", "skin_temp", 0.3, 0.3, "Overnight skin temperature");

  // 118 multi-month summary.
  if (on("longterm.multi_month_summary") && scoredDays(ctx) >= MIN_TREND_DAYS) {
    const moved = SERIES_METRICS.map((m) => movement(ctx, m)).filter((m): m is Movement => m != null && Math.abs(m.madUnits) >= 1);
    const list = moved.map((m) => `${METRICS[m.metric].label.toLowerCase()} ${m.direction} ${fmtMetric(m.metric, Math.abs(m.change90))}`);
    out.push(
      finding({
        rule: "longterm.multi_month_summary",
        engine: ENGINE,
        kind: "trend",
        metric: null,
        day,
        severity: "info",
        title: moved.length ? `${moved.length} measure${moved.length === 1 ? "" : "s"} moved materially over three months` : "No material three-month change",
        value: moved.length,
        baseline: SERIES_METRICS.length,
        method: "90-day slope per metric, material when the change across the period is at least one MAD",
        completeness: round(Math.min(1, scoredDays(ctx) / 90), 2) ?? 0,
        explanation: moved.length ? `Over the last 90 days: ${list.join("; ")}.` : "None of the tracked measures moved by more than one MAD across the last 90 days.",
        nextStep: "Three-month direction is the slow signal; the daily findings carry the detail.",
        evidence: { moved: moved.map((m) => ({ metric: m.metric, change90: round(m.change90, 3), madUnits: round(m.madUnits, 2), direction: m.direction })) },
      }),
    );
  }

  return out;
}
