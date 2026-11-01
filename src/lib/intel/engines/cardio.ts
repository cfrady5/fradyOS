/**
 * Cardio engine: resting heart rate, HRV, workout heart rate and training load read from daily WHOOP
 * summaries. Everything here is a comparison with the person's own history; nothing classifies a
 * cardiac condition. There is no beat-level or live input to this engine.
 */

import type { Baseline, DailySummary, Engine, EngineContext, EngineKey, Finding, MetricKey, Severity } from "../types";
import { changePoint, correlationCI, mean, pearson, quantile, round, sd, slope, tail, trailingRun, valid, welch } from "../stats";
import { series } from "../baselines";
import { CLINICIAN_NOTE, completenessOf, deviation, finding, fmtMetric, severityFromZ } from "../findings";

const ENGINE: EngineKey = "cardio";

export const RULES = {
  rhrStatus: "cardio.rhr_baseline_status",
  rhrElevated: "cardio.rhr_elevated",
  rhrLow: "cardio.rhr_low",
  rhrLongTerm: "cardio.rhr_long_term_change",
  hrvStatus: "cardio.hrv_baseline_status",
  hrvSuppressed: "cardio.hrv_suppressed",
  hrvImproving: "cardio.hrv_improving",
  hrvFluctuation: "cardio.hrv_fluctuation",
  workoutAvgHrTrend: "cardio.workout_avg_hr_trend",
  workoutMaxHrTrend: "cardio.workout_max_hr_trend",
  workoutIntensity: "cardio.workout_intensity",
  adaptation: "cardio.adaptation",
  strainAccumulation: "cardio.strain_accumulation",
  fitnessPattern: "cardio.fitness_pattern",
  recoveryVsExertion: "cardio.recovery_vs_exertion",
  rhrVsSleep: "cardio.rhr_vs_sleep",
  hrvVsTrainingLoad: "cardio.hrv_vs_training_load",
  rhrSafetyHigh: "cardio.rhr_safety_high",
  rhrSafetyLow: "cardio.rhr_safety_low",
} as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: RULES.rhrStatus, label: "Resting HR baseline", description: "Where today's resting heart rate sits against your personal 90-day median and 30-day mean." },
  { rule: RULES.rhrElevated, label: "Elevated resting HR", description: "Resting heart rate well above your own baseline, or above your 75th percentile for several days in a row." },
  { rule: RULES.rhrLow, label: "Unusually low resting HR", description: "Resting heart rate well below your own baseline, or below your 25th percentile for several days in a row." },
  { rule: RULES.rhrLongTerm, label: "Long-term resting HR change", description: "A sustained shift in resting heart rate found by the 30-day slope or a CUSUM change point." },
  { rule: RULES.hrvStatus, label: "HRV baseline", description: "Where today's HRV sits against your personal 90-day median and 30-day mean." },
  { rule: RULES.hrvSuppressed, label: "HRV suppression", description: "HRV well below your own baseline, or below your 25th percentile for several days in a row." },
  { rule: RULES.hrvImproving, label: "HRV improving", description: "HRV trending upward over 30 and 90 days with the last week above the 30-day mean." },
  { rule: RULES.hrvFluctuation, label: "Unusual HRV fluctuation", description: "Day-to-day HRV variability over the last week is well above your typical weekly variability." },
  { rule: RULES.workoutAvgHrTrend, label: "Workout average HR trend", description: "Average heart rate during workouts in the last 30 days compared with the previous 30 days." },
  { rule: RULES.workoutMaxHrTrend, label: "Workout max HR trend", description: "Peak heart rate during workouts in the last 30 days compared with the previous 30 days." },
  { rule: RULES.workoutIntensity, label: "Workout cardiovascular intensity", description: "The latest workout's average heart rate as a share of the highest heart rate seen in 90 days." },
  { rule: RULES.adaptation, label: "Cardiovascular adaptation", description: "Resting HR down and HRV up over 60 days at a similar or higher training load." },
  { rule: RULES.strainAccumulation, label: "Strain accumulation", description: "This week's strain against the 4-week average weekly strain (acute to chronic ratio)." },
  { rule: RULES.fitnessPattern, label: "Long-term fitness pattern", description: "A 90-day summary of resting HR, HRV and weekly strain direction." },
  { rule: RULES.recoveryVsExertion, label: "Recovery vs exertion", description: "Association between the previous day's strain and the next morning's recovery score." },
  { rule: RULES.rhrVsSleep, label: "Resting HR vs sleep duration", description: "Association between a night's sleep duration and that morning's resting heart rate." },
  { rule: RULES.hrvVsTrainingLoad, label: "HRV vs training load", description: "Association between the trailing 7-day strain and HRV." },
  { rule: RULES.rhrSafetyHigh, label: "Resting HR above 100", description: "Fixed threshold: resting heart rate above 100 bpm on the latest day." },
  { rule: RULES.rhrSafetyLow, label: "Resting HR below 40", description: "Fixed threshold: resting heart rate below 40 bpm on the latest day." },
];

const SEV_ORDER: Severity[] = ["info", "low", "moderate", "high"];
const maxSeverity = (a: Severity, b: Severity): Severity => (SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b);
const minSeverity = (a: Severity, b: Severity): Severity => (SEV_ORDER.indexOf(a) <= SEV_ORDER.indexOf(b) ? a : b);

const CORRELATION_MIN_N = 14;
const CORRELATION_MIN_R = 0.3;
const WINDOW = 90;

function enabled(ctx: EngineContext, rule: string): boolean {
  return !ctx.settings.disabled.has(rule);
}

/** Most recent scored, valid reading with its position in `days`. */
function lastValid(days: DailySummary[], metric: MetricKey): { value: number; day: string; index: number } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i].scored ? days[i][metric] : null;
    if (typeof v === "number" && Number.isFinite(v)) return { value: v, day: days[i].day, index: i };
  }
  return null;
}

/** Trailing window means scaled to a full window, null when fewer than `minValid` samples are present. */
function rollingScaledSum(xs: (number | null)[], w: number, minValid: number): (number | null)[] {
  return xs.map((_, i) => {
    if (i + 1 < w) return null;
    const win = xs.slice(i + 1 - w, i + 1);
    const v = valid(win);
    return v.length >= minValid ? (v.reduce((a, b) => a + b, 0) / v.length) * w : null;
  });
}

function shiftBack(xs: (number | null)[], lag: number): (number | null)[] {
  return xs.map((_, i) => (i - lag >= 0 ? xs[i - lag] : null));
}

const describeR = (r: number) => `${Math.abs(r) >= 0.6 ? "a strong" : Math.abs(r) >= 0.45 ? "a moderate" : "a weak"} ${r < 0 ? "inverse" : "positive"}`;

// ---------------------------------------------------------------------------------------------------
// Status (rules 1 and 5)

function statusFinding(ctx: EngineContext, rule: string, metric: MetricKey, title: string): Finding | null {
  const b = ctx.baselines[metric];
  if (!b.ready || b.last == null || b.median90 == null || b.lastDay == null) return null;
  const pos = b.percentile == null ? "" : ` That is the ${Math.round(b.percentile)}th percentile of your last 90 days.`;
  return finding({
    rule,
    engine: ENGINE,
    kind: "status",
    metric,
    day: b.lastDay,
    severity: "info",
    title,
    value: b.last,
    baseline: b.median90,
    method: "latest reading vs personal 90-day median; 30-day mean for context",
    completeness: completenessOf(ctx.days, metric, WINDOW),
    explanation: `Latest ${fmtMetric(metric, b.last)} against a 90-day median of ${fmtMetric(metric, b.median90)} and a 30-day mean of ${fmtMetric(metric, b.mean30)} from ${b.n} readings.${pos}`,
    nextStep: "Nothing to act on. This is the reference the other cardio rules compare against.",
    evidence: { median90: round(b.median90, 2), mean30: round(b.mean30, 2), mean7: round(b.mean7, 2), n: b.n, p25: round(b.p25, 2), p75: round(b.p75, 2), percentile: round(b.percentile, 1) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Deviations (rules 2, 3, 6)

interface DeviationSpec {
  rule: string;
  metric: MetricKey;
  direction: "above" | "below";
  title: string;
  explain: (value: number, baseline: number, run: number) => string;
  nextStep: string;
}

function deviationFinding(ctx: EngineContext, spec: DeviationSpec): Finding | null {
  const { metric, direction } = spec;
  const b = ctx.baselines[metric];
  const dev = deviation(ctx.days, metric, b);
  if (!dev || b.p25 == null || b.p75 == null) return null;
  const { zModerate, persistDays } = ctx.settings;
  const zHit = direction === "above" ? dev.z >= zModerate : dev.z <= -zModerate;
  const quartile = direction === "above" ? b.p75 : b.p25;
  const s = series(ctx.days.slice(0, lastValidIndex(ctx.days, metric) + 1), metric, WINDOW);
  const run = trailingRun(s, (x) => (direction === "above" ? x > quartile : x < quartile));
  const persistent = run >= persistDays;
  if (!zHit && !persistent) return null;
  let severity = severityFromZ(Math.abs(dev.z), zModerate);
  if (persistent) severity = maxSeverity(severity, run >= persistDays * 2 ? "moderate" : "low");
  const method = [zHit ? `robust z ${round(dev.z, 2)} (MAD units vs 90-day median)` : null, persistent ? `${run} consecutive days ${direction} personal ${direction === "above" ? "p75" : "p25"} (${fmtMetric(metric, quartile)})` : null]
    .filter(Boolean)
    .join("; ");
  return finding({
    rule: spec.rule,
    engine: ENGINE,
    kind: "deviation",
    metric,
    day: dev.day,
    severity,
    title: spec.title,
    value: dev.value,
    baseline: b.median90,
    method,
    completeness: completenessOf(ctx.days, metric, WINDOW),
    explanation: spec.explain(dev.value, b.median90!, run),
    nextStep: spec.nextStep,
    evidence: { z: round(dev.z, 2), run, persistDays, zModerate, p25: round(b.p25, 2), p75: round(b.p75, 2), mean7: round(b.mean7, 2) },
  });
}

function lastValidIndex(days: DailySummary[], metric: MetricKey): number {
  const lv = lastValid(days, metric);
  return lv ? lv.index : days.length - 1;
}

// ---------------------------------------------------------------------------------------------------
// Rule 4: long-term RHR change

function rhrLongTermChange(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "resting_hr";
  const b = ctx.baselines[metric];
  if (!b.ready || b.lastDay == null || b.median90 == null) return null;
  const s90 = series(ctx.days, metric, WINDOW);
  const v90 = valid(s90);
  if (v90.length < 20) return null;
  const slope30 = b.slope30;
  const change30 = slope30 == null ? null : slope30 * 30;
  const cp = changePoint(s90, 0.5, 5);
  let shift: number | null = null;
  let before: number | null = null;
  let after: number | null = null;
  if (cp) {
    before = mean(s90.slice(0, cp.index + 1));
    after = mean(s90.slice(cp.index + 1));
    shift = before != null && after != null ? after - before : null;
  }
  const slopeHit = change30 != null && Math.abs(change30) >= 3;
  const cpHit = cp != null && shift != null && Math.abs(shift) >= 2;
  if (!slopeHit && !cpHit) return null;
  const direction: "up" | "down" = cpHit ? cp!.direction : change30! > 0 ? "up" : "down";
  const scale = b.mad90 && b.mad90 > 0 ? b.mad90 : (b.sd90 ?? 1);
  const magnitude = cpHit ? Math.abs(shift!) / scale : Math.abs(change30!) / scale;
  const severity: Severity = direction === "down" ? "info" : minSeverity(severityFromZ(magnitude, ctx.settings.zModerate), "moderate");
  const parts: string[] = [];
  if (slopeHit) parts.push(`the 30-day trend works out to ${change30! > 0 ? "+" : ""}${round(change30, 1)} bpm over the month`);
  if (cpHit) parts.push(`a change point around ${ctx.days[ctx.days.length - s90.length + cp!.index]?.day ?? "the window"} separates a mean of ${fmtMetric(metric, before)} before from ${fmtMetric(metric, after)} after`);
  return finding({
    rule: RULES.rhrLongTerm,
    engine: ENGINE,
    kind: "trend",
    metric,
    day: b.lastDay,
    severity,
    title: `Resting heart rate has shifted ${direction}`,
    value: cpHit ? after : b.mean7,
    baseline: cpHit ? before : b.median90,
    method: [slopeHit ? "OLS slope over 30 days" : null, cpHit ? "CUSUM change point (k 0.5, h 5) over 90 days" : null].filter(Boolean).join("; "),
    completeness: completenessOf(ctx.days, metric, WINDOW),
    explanation: `Your resting heart rate has moved ${direction} over the longer term: ${parts.join(", and ")}. ${direction === "up" ? "Sustained rises can accompany accumulated training load, poor sleep, illness, heat, alcohol or stress." : "A sustained fall often accompanies improving aerobic fitness or a lighter period."}`,
    nextStep: direction === "up" ? "Look at sleep, training load and life stress over the same weeks. " + CLINICIAN_NOTE : "No action needed. Keep an eye on whether HRV moves the same way.",
    evidence: { slope30: round(slope30, 4), change30: round(change30, 2), changePoint: cp ? { ...cp, magnitude: round(cp.magnitude, 2) } : null, meanBefore: round(before, 2), meanAfter: round(after, 2), shift: round(shift, 2), n: v90.length },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 7: HRV improvement trend

function hrvImproving(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "hrv_rmssd";
  const b = ctx.baselines[metric];
  if (!b.ready || b.lastDay == null || b.slope30 == null || b.rateOfChange == null || b.mean7 == null || b.mean30 == null) return null;
  if (b.slope30 <= 0 || (b.slope90 != null && b.slope90 <= 0) || b.rateOfChange <= 5) return null;
  return finding({
    rule: RULES.hrvImproving,
    engine: ENGINE,
    kind: "trend",
    metric,
    day: b.lastDay,
    severity: "info",
    title: "HRV is trending upward",
    value: b.mean7,
    baseline: b.mean30,
    method: "OLS slope over 30 and 90 days both positive; 7-day mean above 30-day mean by more than 5%",
    completeness: completenessOf(ctx.days, metric, WINDOW),
    explanation: `Your 7-day HRV mean of ${fmtMetric(metric, b.mean7)} is ${round(b.rateOfChange, 1)}% above the 30-day mean of ${fmtMetric(metric, b.mean30)}, and the 30-day slope is ${round(b.slope30 * 30, 1)} ms per month${b.slope90 != null ? ` with the 90-day slope also positive (${round(b.slope90 * 30, 1)} ms per month)` : ""}.`,
    nextStep: "A favourable direction. Keep whatever has changed in sleep, training and recovery habits over this period.",
    evidence: { slope30: round(b.slope30, 4), slope90: round(b.slope90, 4), rateOfChangePct: round(b.rateOfChange, 1), mean7: round(b.mean7, 2), mean30: round(b.mean30, 2) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 8: unusual HRV fluctuation

function hrvFluctuation(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "hrv_rmssd";
  const b = ctx.baselines[metric];
  if (!b.ready || b.lastDay == null) return null;
  const end = lastValidIndex(ctx.days, metric) + 1;
  const s90 = series(ctx.days.slice(0, end), metric, WINDOW);
  const cvOf = (win: (number | null)[]): number | null => {
    const v = valid(win);
    if (v.length < 5) return null;
    const m = mean(v)!;
    const s = sd(v);
    return s == null || m === 0 ? null : s / Math.abs(m);
  };
  const cv7 = cvOf(tail(s90, 7));
  if (cv7 == null) return null;
  const typicalCvs: number[] = [];
  for (let i = 7; i + 7 <= s90.length - 7; i += 7) {
    const cv = cvOf(s90.slice(i - 7, i));
    if (cv != null) typicalCvs.push(cv);
  }
  if (typicalCvs.length < 4) return null;
  const typical = quantile(typicalCvs, 0.5)!;
  if (typical <= 0) return null;
  const ratio = cv7 / typical;
  if (ratio < 1.75) return null;
  const severity: Severity = ratio >= 2.5 ? "moderate" : "low";
  return finding({
    rule: RULES.hrvFluctuation,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: b.lastDay,
    severity,
    title: "HRV is fluctuating more than usual",
    value: round(cv7 * 100, 1),
    baseline: round(typical * 100, 1),
    method: "7-day coefficient of variation vs the median of earlier weekly CVs in the 90-day window",
    completeness: completenessOf(ctx.days, metric, 7),
    explanation: `Day-to-day HRV variation over the last week (CV ${round(cv7 * 100, 1)}%) is ${round(ratio, 1)} times your typical weekly variation (CV ${round(typical * 100, 1)}%). Swings like this often follow irregular sleep, alcohol, travel, hard sessions or the start of an illness.`,
    nextStep: "Check what varied this week. If it continues alongside low recovery, treat it as a sign to ease off. " + CLINICIAN_NOTE,
    evidence: { cv7: round(cv7, 4), typicalCv: round(typical, 4), ratio: round(ratio, 2), weeksCompared: typicalCvs.length },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rules 9 and 10: workout HR trends

function workoutHrTrend(ctx: EngineContext, rule: string, metric: "workout_avg_hr" | "workout_max_hr", label: string): Finding | null {
  const days = ctx.days;
  const lv = lastValid(days, metric);
  if (!lv) return null;
  const recentRows = tail(days, 30);
  const previousRows = tail(days.slice(0, Math.max(0, days.length - 30)), 30);
  const recent = valid(series(recentRows, metric));
  const previous = valid(series(previousRows, metric));
  if (recent.length < 5 || previous.length < 5) return null;
  const w = welch(recent, previous);
  if (!w) return null;
  const excludesZero = w.ci[0] > 0 || w.ci[1] < 0;
  if (!excludesZero || Math.abs(w.diff) < 3) return null;
  const direction = w.diff > 0 ? "higher" : "lower";
  const perWorkoutSlope = slope(valid(series(tail(days, 60), metric)));
  const strainRecent = mean(series(recentRows, "workout_strain"));
  const strainPrevious = mean(series(previousRows, "workout_strain"));
  const strainNote = strainRecent != null && strainPrevious != null ? ` Mean workout strain was ${round(strainRecent, 1)} vs ${round(strainPrevious, 1)} in the same windows, which is worth reading alongside it.` : "";
  return finding({
    rule,
    engine: ENGINE,
    kind: "trend",
    metric,
    day: lv.day,
    severity: "info",
    title: `Workout ${label} heart rate is ${direction} than last month`,
    value: mean(recent),
    baseline: mean(previous),
    method: "Welch comparison of workout-day means, last 30 days vs previous 30 days; 95% CI excludes zero",
    completeness: Math.min(1, (recent.length + previous.length) / 40),
    explanation: `Across ${recent.length} workouts in the last 30 days your ${label} heart rate averaged ${fmtMetric(metric, mean(recent))}, ${direction} by ${fmtMetric(metric, Math.abs(w.diff))} than the ${previous.length} workouts in the 30 days before (95% CI ${round(w.ci[0], 1)} to ${round(w.ci[1], 1)} bpm).${strainNote} Heart rate during exercise moves with session type, intensity, heat, hydration and fatigue, so this describes your sessions, not your heart.`,
    nextStep: "Compare with the kind of sessions you did in each month. No action unless it does not match how hard you trained.",
    evidence: { diff: round(w.diff, 2), ci: [round(w.ci[0], 2), round(w.ci[1], 2)], nRecent: w.nA, nPrevious: w.nB, perWorkoutSlope60: round(perWorkoutSlope, 3), strainRecent: round(strainRecent, 2), strainPrevious: round(strainPrevious, 2) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 11: workout cardiovascular intensity

function workoutIntensity(ctx: EngineContext): Finding | null {
  const days = ctx.days;
  const lv = lastValid(days, "workout_avg_hr");
  if (!lv || lv.index < days.length - 7) return null;
  const peaks = [...valid(series(days, "max_hr", WINDOW)), ...valid(series(days, "workout_max_hr", WINDOW))];
  if (peaks.length < 5) return null;
  const peak = Math.max(...peaks);
  if (peak <= 0) return null;
  const share = lv.value / peak;
  const bucket = share >= 0.85 ? "very hard" : share >= 0.75 ? "hard" : share >= 0.65 ? "moderate" : "easy";
  const strain = days[lv.index].workout_strain;
  const minutes = days[lv.index].workout_min;
  return finding({
    rule: RULES.workoutIntensity,
    engine: ENGINE,
    kind: "status",
    metric: "workout_avg_hr",
    day: lv.day,
    severity: "info",
    title: `Latest workout intensity: ${bucket}`,
    value: round(share * 100, 1),
    baseline: null,
    method: "workout average HR as a share of the highest max HR recorded in 90 days; buckets at 65%, 75% and 85%",
    completeness: Math.min(1, peaks.length / 30),
    explanation: `The workout on ${lv.day} averaged ${fmtMetric("workout_avg_hr", lv.value)}, ${round(share * 100, 0)}% of the highest heart rate seen in the last 90 days (${fmtMetric("max_hr", peak)}), which FRADY buckets as ${bucket}.${strain != null ? ` WHOOP scored it ${round(strain, 1)} strain` : ""}${minutes != null ? ` over ${fmtMetric("workout_min", minutes)}` : ""}${strain != null || minutes != null ? "." : ""}`,
    nextStep: "Context for the recovery and strain rules. The buckets are relative to your own recorded peak, not a population norm.",
    evidence: { avgHr: lv.value, peakHr90: peak, share: round(share, 3), bucket, workoutStrain: strain, workoutMin: minutes },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 12: cardiovascular adaptation over 60 days

function adaptation(ctx: EngineContext): Finding | null {
  const days = ctx.days;
  if (days.length < 60 || !ctx.baselines.resting_hr.ready || !ctx.baselines.hrv_rmssd.ready) return null;
  const recentRows = tail(days, 30);
  const earlierRows = days.slice(days.length - 60, days.length - 30);
  const pick = (rows: DailySummary[], m: MetricKey) => valid(series(rows, m));
  const rhrR = pick(recentRows, "resting_hr");
  const rhrE = pick(earlierRows, "resting_hr");
  const hrvR = pick(recentRows, "hrv_rmssd");
  const hrvE = pick(earlierRows, "hrv_rmssd");
  const strR = pick(recentRows, "day_strain");
  const strE = pick(earlierRows, "day_strain");
  if ([rhrR, rhrE, hrvR, hrvE].some((v) => v.length < 15) || strR.length < 10 || strE.length < 10) return null;
  const rhrDelta = mean(rhrR)! - mean(rhrE)!;
  const hrvPct = ((mean(hrvR)! - mean(hrvE)!) / mean(hrvE)!) * 100;
  const strainRatio = mean(strR)! / Math.max(0.1, mean(strE)!);
  if (!(rhrDelta <= -1 && hrvPct >= 5 && strainRatio >= 0.9)) return null;
  const lv = lastValid(days, "hrv_rmssd") ?? lastValid(days, "resting_hr");
  return finding({
    rule: RULES.adaptation,
    engine: ENGINE,
    kind: "trend",
    metric: "resting_hr",
    day: lv?.day ?? ctx.today,
    severity: "info",
    title: "Signs of cardiovascular adaptation over 60 days",
    value: mean(rhrR),
    baseline: mean(rhrE),
    method: "last 30 days vs the 30 days before: RHR mean down at least 1 bpm, HRV mean up at least 5%, day strain at least 90% of the earlier window",
    completeness: Math.min(1, (rhrR.length + rhrE.length + hrvR.length + hrvE.length) / 120),
    explanation: `Compared with the month before, your resting heart rate averaged ${fmtMetric("resting_hr", Math.abs(rhrDelta))} lower (${fmtMetric("resting_hr", mean(rhrR))} vs ${fmtMetric("resting_hr", mean(rhrE))}) and HRV ${round(hrvPct, 0)}% higher (${fmtMetric("hrv_rmssd", mean(hrvR))} vs ${fmtMetric("hrv_rmssd", mean(hrvE))}), while daily strain stayed at ${round(strainRatio * 100, 0)}% of the earlier level. That combination is consistent with the body adapting to training.`,
    nextStep: "A favourable pattern. Keep the current balance of training and recovery rather than adding load because of it.",
    evidence: { rhrRecent: round(mean(rhrR), 2), rhrEarlier: round(mean(rhrE), 2), rhrDelta: round(rhrDelta, 2), hrvRecent: round(mean(hrvR), 2), hrvEarlier: round(mean(hrvE), 2), hrvPct: round(hrvPct, 1), strainRecent: round(mean(strR), 2), strainEarlier: round(mean(strE), 2), strainRatio: round(strainRatio, 2) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 13: strain accumulation (acute:chronic)

function acuteChronic(days: DailySummary[]): { acute: number; chronic: number; ratio: number; n7: number; n28: number } | null {
  const s28 = series(days, "day_strain", 28);
  const s7 = tail(s28, 7);
  const v7 = valid(s7);
  const v28 = valid(s28);
  if (v7.length < 5 || v28.length < 20) return null;
  const acute = mean(v7)! * 7;
  const chronic = mean(v28)! * 7;
  if (chronic <= 0) return null;
  return { acute, chronic, ratio: acute / chronic, n7: v7.length, n28: v28.length };
}

function strainAccumulation(ctx: EngineContext): Finding | null {
  if (!ctx.baselines.day_strain.ready) return null;
  const lv = lastValid(ctx.days, "day_strain");
  if (!lv) return null;
  const ac = acuteChronic(ctx.days.slice(0, lv.index + 1));
  if (!ac) return null;
  const { ratio } = ac;
  if (ratio < 1.3 && ratio > 0.7) return null;
  const high = ratio >= 1.3;
  const severity: Severity = !high ? "info" : ratio >= 1.5 ? "moderate" : "low";
  return finding({
    rule: RULES.strainAccumulation,
    engine: ENGINE,
    kind: "pattern",
    metric: "day_strain",
    day: lv.day,
    severity,
    title: high ? "Strain is accumulating faster than your recent norm" : "Strain this week is well below your recent norm",
    value: ac.acute,
    baseline: ac.chronic,
    method: "7-day strain sum vs the average weekly sum over 28 days (acute to chronic ratio), sums scaled from valid-day means",
    completeness: Math.min(1, ac.n28 / 28),
    explanation: `This week's strain sums to ${round(ac.acute, 1)} against a 4-week average week of ${round(ac.chronic, 1)}, a ratio of ${round(ratio, 2)}. ${high ? "Ratios above about 1.3 mean load has risen quickly relative to what your body has been used to, which is when recovery tends to lag." : "A ratio below about 0.7 is a markedly lighter week, which can be deliberate rest or a gap in wearing the strap."}`,
    nextStep: high ? "Consider holding load steady for a few days and watch recovery, HRV and resting heart rate." : "No action needed if the light week was intended.",
    evidence: { acute: round(ac.acute, 2), chronic: round(ac.chronic, 2), ratio: round(ratio, 3), n7: ac.n7, n28: ac.n28 },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 14: long-term fitness pattern

function fitnessPattern(ctx: EngineContext): Finding | null {
  const rhr = ctx.baselines.resting_hr;
  const hrv = ctx.baselines.hrv_rmssd;
  if (!rhr.ready || !hrv.ready || rhr.n < 45 || hrv.n < 45 || rhr.slope90 == null || hrv.slope90 == null || rhr.median90 == null || hrv.median90 == null) return null;
  const span = Math.min(WINDOW, ctx.days.length) - 1;
  const rhrChange = rhr.slope90 * span;
  const hrvChange = hrv.slope90 * span;
  const hrvPct = (hrvChange / hrv.median90) * 100;
  const s90 = series(ctx.days, "day_strain", WINDOW);
  const weeks: number[] = [];
  for (let end = s90.length; end - 7 >= 0; end -= 7) {
    const v = valid(s90.slice(end - 7, end));
    if (v.length >= 5) weeks.unshift(mean(v)! * 7);
  }
  const weeklyMean = mean(weeks);
  const spikes = weeklyMean ? weeks.filter((w) => w >= 1.3 * weeklyMean).length : 0;
  const direction = rhrChange <= -2 && hrvPct >= 5 ? "improving" : rhrChange >= 2 && hrvPct <= -5 ? "declining" : "stable or mixed";
  const lv = lastValid(ctx.days, "hrv_rmssd");
  return finding({
    rule: RULES.fitnessPattern,
    engine: ENGINE,
    kind: "trend",
    metric: "resting_hr",
    day: lv?.day ?? rhr.lastDay ?? ctx.today,
    severity: direction === "declining" ? "low" : "info",
    title: `90-day cardiovascular pattern: ${direction}`,
    value: rhrChange,
    baseline: null,
    method: "90-day OLS slopes of resting HR and HRV scaled to the window; weekly strain sums from valid-day means",
    completeness: Math.min(1, (rhr.n + hrv.n) / 180),
    explanation: `Over roughly ${span + 1} days your resting heart rate trend amounts to ${rhrChange > 0 ? "+" : ""}${round(rhrChange, 1)} bpm and HRV to ${hrvPct > 0 ? "+" : ""}${round(hrvPct, 0)}% of its median (${hrvChange > 0 ? "+" : ""}${round(hrvChange, 1)} ms).${weeklyMean != null ? ` Weekly strain averaged ${round(weeklyMean, 1)} across ${weeks.length} weeks, with ${spikes} week${spikes === 1 ? "" : "s"} at least 30% above that average.` : ""} FRADY reads this as ${direction}.${direction === "declining" ? " Rising resting heart rate with falling HRV over months often tracks accumulated fatigue, disrupted sleep or a stressful period." : ""}`,
    nextStep: direction === "declining" ? "Review the balance of training and recovery over the quarter. " + CLINICIAN_NOTE : "Nothing to act on. This summary updates daily as the window rolls forward.",
    evidence: { rhrSlope90: round(rhr.slope90, 4), rhrChange: round(rhrChange, 2), hrvSlope90: round(hrv.slope90, 4), hrvChange: round(hrvChange, 2), hrvChangePct: round(hrvPct, 1), weeklyStrain: weeks.map((w) => round(w, 1)), weeklyStrainMean: round(weeklyMean, 2), strainSpikeWeeks: spikes, direction, spanDays: span + 1 },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rules 15 to 17: correlations

interface CorrelationSpec {
  rule: string;
  metric: MetricKey;
  xs: (number | null)[];
  ys: (number | null)[];
  xLabel: string;
  yLabel: string;
  title: (r: number) => string;
  interpret: (r: number) => string;
  lag: number;
  completeness: number;
  evidence?: Record<string, unknown>;
}

function correlationFinding(ctx: EngineContext, spec: CorrelationSpec): Finding | null {
  const p = pearson(spec.xs, spec.ys);
  if (!p || p.n < CORRELATION_MIN_N || Math.abs(p.r) < CORRELATION_MIN_R) return null;
  const ci = correlationCI(p.r, p.n);
  const lv = lastValid(ctx.days, spec.metric);
  return finding({
    rule: spec.rule,
    engine: ENGINE,
    kind: "correlation",
    metric: spec.metric,
    day: lv?.day ?? ctx.today,
    severity: "info",
    title: spec.title(p.r),
    value: round(p.r, 3),
    baseline: null,
    method: `Pearson correlation over the last ${WINDOW} days${spec.lag ? `, lag ${spec.lag} day` : ""}; needs n >= ${CORRELATION_MIN_N} and |r| >= ${CORRELATION_MIN_R}`,
    completeness: spec.completeness,
    explanation: `Across ${p.n} paired days there is ${describeR(p.r)} association between ${spec.xLabel} and ${spec.yLabel} (r ${round(p.r, 2)}${ci ? `, 95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)}` : ""}). ${spec.interpret(p.r)} An association in your data is not a cause.`,
    nextStep: "Use this as a hint about what moves your numbers. It gets more reliable as more days accumulate.",
    evidence: { n: p.n, r: round(p.r, 4), ci: ci ? [round(ci[0], 4), round(ci[1], 4)] : null, lag: spec.lag, periodDays: WINDOW, x: spec.xLabel, y: spec.yLabel, ...spec.evidence },
  });
}

function correlations(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const days = tail(ctx.days, WINDOW + 7); // a little extra so lagged windows have history
  const strain = series(days, "day_strain");
  const recovery = series(days, "recovery_score");
  const sleep = series(days, "sleep_total_min");
  const rhr = series(days, "resting_hr");
  const hrv = series(days, "hrv_rmssd");
  const cut = (xs: (number | null)[]) => tail(xs, WINDOW);

  if (enabled(ctx, RULES.recoveryVsExertion)) {
    const f = correlationFinding(ctx, {
      rule: RULES.recoveryVsExertion,
      metric: "recovery_score",
      xs: cut(shiftBack(strain, 1)),
      ys: cut(recovery),
      xLabel: "the previous day's strain",
      yLabel: "the next morning's recovery score",
      lag: 1,
      title: (r) => (r < 0 ? "Harder days are followed by lower recovery" : "Harder days are followed by higher recovery"),
      interpret: (r) => (r < 0 ? "Your recovery tends to drop after higher-strain days, which is the expected direction." : "Your recovery tends to be higher after bigger days, which can happen when training days also bring better sleep or routine."),
      completeness: completenessOf(ctx.days, "recovery_score", WINDOW),
    });
    if (f) out.push(f);
  }
  if (enabled(ctx, RULES.rhrVsSleep)) {
    const f = correlationFinding(ctx, {
      rule: RULES.rhrVsSleep,
      metric: "resting_hr",
      xs: cut(sleep),
      ys: cut(rhr),
      xLabel: "sleep duration",
      yLabel: "that morning's resting heart rate",
      lag: 0,
      title: (r) => (r < 0 ? "Longer sleep goes with a lower resting heart rate" : "Longer sleep goes with a higher resting heart rate"),
      interpret: (r) => (r < 0 ? "More sleep tends to coincide with a lower resting heart rate for you." : "Longer nights have coincided with a higher resting heart rate, which sometimes happens when long sleeps follow illness, alcohol or very hard days."),
      completeness: Math.min(completenessOf(ctx.days, "sleep_total_min", WINDOW), completenessOf(ctx.days, "resting_hr", WINDOW)),
    });
    if (f) out.push(f);
  }
  if (enabled(ctx, RULES.hrvVsTrainingLoad)) {
    const load = shiftBack(rollingScaledSum(strain, 7, 5), 1);
    const f = correlationFinding(ctx, {
      rule: RULES.hrvVsTrainingLoad,
      metric: "hrv_rmssd",
      xs: cut(load),
      ys: cut(hrv),
      xLabel: "the trailing 7-day strain (through the previous day)",
      yLabel: "HRV",
      lag: 1,
      title: (r) => (r < 0 ? "Higher weekly training load goes with lower HRV" : "Higher weekly training load goes with higher HRV"),
      interpret: (r) => (r < 0 ? "Your HRV tends to be lower in weeks of accumulated load, a common fatigue signature." : "Your HRV has tended to rise with weekly load, which is sometimes seen when training is well tolerated."),
      completeness: Math.min(completenessOf(ctx.days, "day_strain", WINDOW), completenessOf(ctx.days, "hrv_rmssd", WINDOW)),
      evidence: { loadWindowDays: 7 },
    });
    if (f) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Fixed safety thresholds (independent of baselines)

const RHR_HIGH_LIMIT = 100;
const RHR_LOW_LIMIT = 40;

function safety(ctx: EngineContext): Finding[] {
  const lv = lastValid(ctx.days, "resting_hr");
  if (!lv) return [];
  const b: Baseline = ctx.baselines.resting_hr;
  const base = b.median90 ?? null;
  const out: Finding[] = [];
  if (lv.value > RHR_HIGH_LIMIT && enabled(ctx, RULES.rhrSafetyHigh)) {
    out.push(
      finding({
        rule: RULES.rhrSafetyHigh,
        engine: ENGINE,
        kind: "deviation",
        metric: "resting_hr",
        day: lv.day,
        severity: "moderate",
        title: `Resting heart rate above ${RHR_HIGH_LIMIT} bpm`,
        value: lv.value,
        baseline: base,
        method: `fixed threshold: resting HR > ${RHR_HIGH_LIMIT} bpm on the latest reading`,
        completeness: 1,
        explanation: `Your resting heart rate on ${lv.day} was ${fmtMetric("resting_hr", lv.value)}, above the fixed ${RHR_HIGH_LIMIT} bpm limit FRADY applies regardless of personal baseline${base != null ? ` (your 90-day median is ${fmtMetric("resting_hr", base)})` : ""}. Illness, fever, dehydration, alcohol, poor sleep, stimulants or a very hard day can all push a night's resting heart rate this high.`,
        nextStep: CLINICIAN_NOTE,
        evidence: { limit: RHR_HIGH_LIMIT, baselineReady: b.ready },
      }),
    );
  }
  if (lv.value < RHR_LOW_LIMIT && enabled(ctx, RULES.rhrSafetyLow)) {
    out.push(
      finding({
        rule: RULES.rhrSafetyLow,
        engine: ENGINE,
        kind: "deviation",
        metric: "resting_hr",
        day: lv.day,
        severity: "moderate",
        title: `Resting heart rate below ${RHR_LOW_LIMIT} bpm`,
        value: lv.value,
        baseline: base,
        method: `fixed threshold: resting HR < ${RHR_LOW_LIMIT} bpm on the latest reading`,
        completeness: 1,
        explanation: `Your resting heart rate on ${lv.day} was ${fmtMetric("resting_hr", lv.value)}, below the fixed ${RHR_LOW_LIMIT} bpm limit FRADY applies regardless of personal baseline${base != null ? ` (your 90-day median is ${fmtMetric("resting_hr", base)})` : ""}. Very low readings are common in well-trained people and can also come from a loose strap or a sensor artefact.`,
        nextStep: CLINICIAN_NOTE,
        evidence: { limit: RHR_LOW_LIMIT, baselineReady: b.ready },
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Engine

export const cardioEngine: Engine = (ctx) => {
  const out: Finding[] = [];
  const push = (f: Finding | null | undefined) => {
    if (f && enabled(ctx, f.rule)) out.push(f);
  };

  out.push(...safety(ctx));

  if (enabled(ctx, RULES.rhrStatus)) push(statusFinding(ctx, RULES.rhrStatus, "resting_hr", "Resting heart rate vs your baseline"));
  if (enabled(ctx, RULES.rhrElevated))
    push(
      deviationFinding(ctx, {
        rule: RULES.rhrElevated,
        metric: "resting_hr",
        direction: "above",
        title: "Resting heart rate is elevated against your baseline",
        explain: (v, b, run) => `Your latest resting heart rate of ${fmtMetric("resting_hr", v)} sits ${fmtMetric("resting_hr", v - b)} above your 90-day median of ${fmtMetric("resting_hr", b)}${run >= ctx.settings.persistDays ? `, and it has been above your usual upper quartile for ${run} days running` : ""}. Short rises like this often follow a hard day, alcohol, a late night, heat, travel or the early stage of a cold.`,
        nextStep: "Favour an easier day and good sleep, then see whether it settles. " + CLINICIAN_NOTE,
      }),
    );
  if (enabled(ctx, RULES.rhrLow))
    push(
      deviationFinding(ctx, {
        rule: RULES.rhrLow,
        metric: "resting_hr",
        direction: "below",
        title: "Resting heart rate is unusually low against your baseline",
        explain: (v, b, run) => `Your latest resting heart rate of ${fmtMetric("resting_hr", v)} sits ${fmtMetric("resting_hr", b - v)} below your 90-day median of ${fmtMetric("resting_hr", b)}${run >= ctx.settings.persistDays ? `, and it has been below your usual lower quartile for ${run} days running` : ""}. For many people this follows rest, good sleep or improving fitness; it can also be a strap or sensor artefact.`,
        nextStep: "Usually nothing to do. If you also feel lightheaded or unusually tired, " + CLINICIAN_NOTE.charAt(0).toLowerCase() + CLINICIAN_NOTE.slice(1),
      }),
    );
  if (enabled(ctx, RULES.rhrLongTerm)) push(rhrLongTermChange(ctx));

  if (enabled(ctx, RULES.hrvStatus)) push(statusFinding(ctx, RULES.hrvStatus, "hrv_rmssd", "HRV vs your baseline"));
  if (enabled(ctx, RULES.hrvSuppressed))
    push(
      deviationFinding(ctx, {
        rule: RULES.hrvSuppressed,
        metric: "hrv_rmssd",
        direction: "below",
        title: "HRV is suppressed against your baseline",
        explain: (v, b, run) => `Your latest HRV of ${fmtMetric("hrv_rmssd", v)} is ${fmtMetric("hrv_rmssd", b - v)} below your 90-day median of ${fmtMetric("hrv_rmssd", b)}${run >= ctx.settings.persistDays ? `, and it has been below your usual lower quartile for ${run} days running` : ""}. Suppressed HRV commonly follows hard training, short or late sleep, alcohol, stress or the start of an illness.`,
        nextStep: "Treat it as a signal to prioritise recovery for a day or two. " + CLINICIAN_NOTE,
      }),
    );
  if (enabled(ctx, RULES.hrvImproving)) push(hrvImproving(ctx));
  if (enabled(ctx, RULES.hrvFluctuation)) push(hrvFluctuation(ctx));

  if (enabled(ctx, RULES.workoutAvgHrTrend)) push(workoutHrTrend(ctx, RULES.workoutAvgHrTrend, "workout_avg_hr", "average"));
  if (enabled(ctx, RULES.workoutMaxHrTrend)) push(workoutHrTrend(ctx, RULES.workoutMaxHrTrend, "workout_max_hr", "peak"));
  if (enabled(ctx, RULES.workoutIntensity)) push(workoutIntensity(ctx));
  if (enabled(ctx, RULES.adaptation)) push(adaptation(ctx));
  if (enabled(ctx, RULES.strainAccumulation)) push(strainAccumulation(ctx));
  if (enabled(ctx, RULES.fitnessPattern)) push(fitnessPattern(ctx));

  out.push(...correlations(ctx));
  return out;
};
