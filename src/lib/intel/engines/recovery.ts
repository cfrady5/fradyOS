/**
 * Recovery engine: WHOOP's daily recovery score read against the person's own history, the sleep,
 * strain and workout context around it, and FRADY's own readiness score.
 *
 * Day convention: a row's `day` is the wake day. recovery_score, resting_hr, hrv_rmssd and the sleep
 * fields on row t describe the night that ended that morning; day_strain, workouts and naps on row t
 * happened during calendar day t. So "the day before" context for a recovery on row t is row t-1.
 */

import type { DailySummary, DerivedScore, Engine, EngineContext, EngineKey, Finding, MetricKey, Severity } from "../types";
import { correlationCI, mean, pearson, quantile, round, sd, tail, trailingRun, valid, welch } from "../stats";
import { series } from "../baselines";
import { CLINICIAN_NOTE, completenessOf, deviation, finding, fmtMetric, severityFromZ } from "../findings";

const ENGINE: EngineKey = "recovery";
const WINDOW = 90;
const CORRELATION_MIN_N = 14;
const CORRELATION_MIN_R = 0.3;
/** WHOOP's red zone starts below 34%. Used as a fixed floor alongside the personal p25. */
const RED_ZONE = 34;

export const RULES = {
  trend: "recovery.trend",
  improving: "recovery.improving",
  deteriorating: "recovery.deteriorating",
  lowStreak: "recovery.low_streak",
  volatility: "recovery.volatility",
  hrvDeviation: "recovery.hrv_deviation",
  rhrDeviation: "recovery.rhr_deviation",
  sleepDeficit: "recovery.sleep_deficit",
  strainDeficit: "recovery.strain_deficit",
  afterHardWorkouts: "recovery.after_hard_workouts",
  afterRestDays: "recovery.after_rest_days",
  afterNaps: "recovery.after_naps",
  vsSleepRegularity: "recovery.vs_sleep_regularity",
  vsPrevExertion: "recovery.vs_prev_exertion",
} as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: RULES.trend, label: "Recovery trend", description: "Direction of recovery over 30 days from the slope and the 7-day vs 30-day means." },
  { rule: RULES.improving, label: "Recovery improving", description: "Recovery has risen over the last month by a meaningful amount." },
  { rule: RULES.deteriorating, label: "Recovery deteriorating", description: "Recovery has fallen over the last month by a meaningful amount." },
  { rule: RULES.lowStreak, label: "Consecutive low-recovery days", description: "Recovery below your personal 25th percentile, or below 34%, for several days in a row." },
  { rule: RULES.volatility, label: "Recovery volatility", description: "Recovery over the last week is swinging far more than over the last 90 days." },
  { rule: RULES.hrvDeviation, label: "HRV deviation", description: "The latest HRV is far from your 90-day median in robust z terms." },
  { rule: RULES.rhrDeviation, label: "Resting HR deviation", description: "The latest resting heart rate is far from your 90-day median in robust z terms." },
  { rule: RULES.sleepDeficit, label: "Sleep-related recovery deficit", description: "Recovery is lower on mornings after sleep shorter than your personal 25th percentile." },
  { rule: RULES.strainDeficit, label: "Strain-related recovery deficit", description: "Recovery is lower on mornings after a day of strain above your personal 75th percentile." },
  { rule: RULES.afterHardWorkouts, label: "Recovery after hard workouts", description: "Mean recovery on mornings after a workout above your 75th percentile of workout strain vs other mornings." },
  { rule: RULES.afterRestDays, label: "Recovery after rest days", description: "Mean recovery on mornings after a day with no workout vs other mornings." },
  { rule: RULES.afterNaps, label: "Recovery after naps", description: "Mean recovery on mornings after a day with a nap vs mornings without." },
  { rule: RULES.vsSleepRegularity, label: "Recovery vs sleep regularity", description: "Association between sleep consistency and recovery score on the same morning." },
  { rule: RULES.vsPrevExertion, label: "Recovery vs previous-day exertion", description: "Association between the previous day's strain and the next morning's recovery score." },
];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function enabled(ctx: EngineContext, rule: string): boolean {
  return !ctx.settings.disabled.has(rule);
}

function lastValid(days: DailySummary[], metric: MetricKey): { value: number; day: string; index: number } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i].scored ? days[i][metric] : null;
    if (typeof v === "number" && Number.isFinite(v)) return { value: v, day: days[i].day, index: i };
  }
  return null;
}

function shiftBack(xs: (number | null)[], lag: number): (number | null)[] {
  return xs.map((_, i) => (i - lag >= 0 ? xs[i - lag] : null));
}

const describeR = (r: number) => `${Math.abs(r) >= 0.6 ? "a strong" : Math.abs(r) >= 0.45 ? "a moderate" : "a weak"} ${r < 0 ? "inverse" : "positive"}`;

// ---------------------------------------------------------------------------------------------------
// Rules 47 to 49: trend, improvement, deterioration

const TREND_POINTS = 10;
const TREND_PCT = 8;

function recoveryTrend(ctx: EngineContext): Finding[] {
  const metric: MetricKey = "recovery_score";
  const b = ctx.baselines[metric];
  if (!b.ready || b.lastDay == null || b.slope30 == null || b.mean7 == null || b.mean30 == null || b.rateOfChange == null) return [];
  const change30 = b.slope30 * 30;
  const direction = change30 >= TREND_POINTS && b.rateOfChange >= TREND_PCT ? "rising" : change30 <= -TREND_POINTS && b.rateOfChange <= -TREND_PCT ? "falling" : "stable";
  const completeness = completenessOf(ctx.days, metric, 30);
  const out: Finding[] = [];
  const evidence = { slope30: round(b.slope30, 4), change30: round(change30, 2), mean7: round(b.mean7, 2), mean30: round(b.mean30, 2), rateOfChangePct: round(b.rateOfChange, 1), direction };
  if (enabled(ctx, RULES.trend)) {
    out.push(
      finding({
        rule: RULES.trend,
        engine: ENGINE,
        kind: "trend",
        metric,
        day: b.lastDay,
        severity: "info",
        title: `Recovery trend over 30 days: ${direction}`,
        value: b.mean7,
        baseline: b.mean30,
        method: "OLS slope over 30 days scaled to the month; 7-day mean vs 30-day mean",
        completeness,
        explanation: `Your 7-day recovery mean is ${fmtMetric(metric, b.mean7)} against a 30-day mean of ${fmtMetric(metric, b.mean30)} (${b.rateOfChange > 0 ? "+" : ""}${round(b.rateOfChange, 1)}%), and the 30-day slope amounts to ${change30 > 0 ? "+" : ""}${round(change30, 1)} points over the month. FRADY reads that as ${direction}.`,
        nextStep: direction === "falling" ? "See the deterioration finding for the detail." : "Nothing to act on. This is the reference the other recovery rules build on.",
        evidence,
      }),
    );
  }
  if (direction === "rising" && enabled(ctx, RULES.improving)) {
    out.push(
      finding({
        rule: RULES.improving,
        engine: ENGINE,
        kind: "trend",
        metric,
        day: b.lastDay,
        severity: "info",
        title: "Recovery has improved over the last month",
        value: b.mean7,
        baseline: b.mean30,
        method: `30-day change >= ${TREND_POINTS} points and 7-day mean >= ${TREND_PCT}% above the 30-day mean`,
        completeness,
        explanation: `Recovery has climbed by about ${round(change30, 0)} points over the month and the last week (${fmtMetric(metric, b.mean7)}) sits ${round(b.rateOfChange, 0)}% above the 30-day mean of ${fmtMetric(metric, b.mean30)}.`,
        nextStep: "A favourable direction. Note what changed in sleep, load or habits so you can keep it.",
        evidence,
      }),
    );
  }
  if (direction === "falling" && enabled(ctx, RULES.deteriorating)) {
    const severe = change30 <= -2 * TREND_POINTS || b.rateOfChange <= -2 * TREND_PCT;
    out.push(
      finding({
        rule: RULES.deteriorating,
        engine: ENGINE,
        kind: "trend",
        metric,
        day: b.lastDay,
        severity: severe ? "moderate" : "low",
        title: "Recovery has deteriorated over the last month",
        value: b.mean7,
        baseline: b.mean30,
        method: `30-day change <= -${TREND_POINTS} points and 7-day mean <= ${TREND_PCT}% below the 30-day mean`,
        completeness,
        explanation: `Recovery has dropped by about ${round(Math.abs(change30), 0)} points over the month and the last week (${fmtMetric(metric, b.mean7)}) sits ${round(Math.abs(b.rateOfChange), 0)}% below the 30-day mean of ${fmtMetric(metric, b.mean30)}. A month-long slide usually has a cause in sleep, training load, alcohol, stress or illness.`,
        nextStep: "Review the sleep and strain findings for the same period and consider a lighter week. " + CLINICIAN_NOTE,
        evidence,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Rule 50: consecutive low-recovery days

function lowStreak(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "recovery_score";
  const b = ctx.baselines[metric];
  const lv = lastValid(ctx.days, metric);
  if (!lv) return null;
  const p25 = b.ready ? b.p25 : null;
  const s = series(ctx.days.slice(0, lv.index + 1), metric, WINDOW);
  const run = trailingRun(s, (x) => x < RED_ZONE || (p25 != null && x < p25));
  const { persistDays } = ctx.settings;
  if (run < persistDays) return null;
  const redRun = trailingRun(s, (x) => x < RED_ZONE);
  const severity: Severity = redRun >= persistDays || run >= persistDays * 2 ? "moderate" : "low";
  const streak = valid(tail(s, run));
  return finding({
    rule: RULES.lowStreak,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: lv.day,
    severity,
    title: `${run} consecutive low-recovery days`,
    value: mean(streak),
    baseline: b.median90,
    method: `trailing run of days below personal p25${p25 != null ? ` (${fmtMetric(metric, p25)})` : " (not ready)"} or below the fixed ${RED_ZONE}% floor; needs ${persistDays} days`,
    completeness: completenessOf(ctx.days, metric, Math.max(run, 7)),
    explanation: `Recovery has been low for ${run} days in a row, averaging ${fmtMetric(metric, mean(streak))}${b.median90 != null ? ` against your 90-day median of ${fmtMetric(metric, b.median90)}` : ""}${redRun >= persistDays ? `, with ${redRun} of those days under ${RED_ZONE}%` : ""}. Runs like this usually follow a block of hard training, a stretch of poor sleep, travel or an illness.`,
    nextStep: "Reduce load until recovery returns to your usual range, and look at sleep first. " + CLINICIAN_NOTE,
    evidence: { run, redRun, persistDays, p25: round(p25, 2), floor: RED_ZONE, values: streak },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule 51: recovery volatility

function volatility(ctx: EngineContext): Finding | null {
  const metric: MetricKey = "recovery_score";
  const b = ctx.baselines[metric];
  if (!b.ready || b.sd90 == null || b.sd90 <= 0) return null;
  const lv = lastValid(ctx.days, metric);
  if (!lv) return null;
  const s7 = series(ctx.days.slice(0, lv.index + 1), metric, 7);
  const v7 = valid(s7);
  if (v7.length < 5) return null;
  const sd7 = sd(v7);
  if (sd7 == null) return null;
  const ratio = sd7 / b.sd90;
  if (ratio < 1.5) return null;
  return finding({
    rule: RULES.volatility,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: lv.day,
    severity: ratio >= 2 ? "moderate" : "low",
    title: "Recovery is swinging more than usual",
    value: sd7,
    baseline: b.sd90,
    method: "SD of the last 7 days vs the 90-day SD",
    completeness: v7.length / 7,
    explanation: `Recovery over the last week ranged from ${fmtMetric(metric, Math.min(...v7))} to ${fmtMetric(metric, Math.max(...v7))} (SD ${round(sd7, 1)}), ${round(ratio, 1)} times your 90-day spread (SD ${round(b.sd90, 1)}). Big swings often come from alternating very hard and very easy days, irregular sleep timing or alcohol on some nights.`,
    nextStep: "Look for what differed between the high and low mornings this week.",
    evidence: { sd7: round(sd7, 2), sd90: round(b.sd90, 2), ratio: round(ratio, 2), values: v7 },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rules 52 and 53: HRV and RHR deviation in recovery context

function cardioDeviation(ctx: EngineContext, rule: string, metric: "hrv_rmssd" | "resting_hr"): Finding | null {
  const b = ctx.baselines[metric];
  const dev = deviation(ctx.days, metric, b);
  if (!dev) return null;
  const { zModerate } = ctx.settings;
  if (Math.abs(dev.z) < zModerate) return null;
  const higher = dev.z > 0;
  const favourable = metric === "hrv_rmssd" ? higher : !higher;
  const severity = favourable ? "info" : severityFromZ(Math.abs(dev.z), zModerate);
  const label = metric === "hrv_rmssd" ? "HRV" : "Resting heart rate";
  return finding({
    rule,
    engine: ENGINE,
    kind: "deviation",
    metric,
    day: dev.day,
    severity,
    title: `${label} is ${higher ? "well above" : "well below"} your baseline this morning`,
    value: dev.value,
    baseline: b.median90,
    method: `robust z ${round(dev.z, 2)} (MAD units vs 90-day median); threshold ${zModerate}`,
    completeness: completenessOf(ctx.days, metric, WINDOW),
    explanation: `${label} this morning was ${fmtMetric(metric, dev.value)}, ${fmtMetric(metric, Math.abs(dev.delta))} ${higher ? "above" : "below"} your 90-day median of ${fmtMetric(metric, b.median90)} (robust z ${round(dev.z, 1)}). ${favourable ? "This is in the favourable direction and usually reflects good rest." : "This is one of the two inputs WHOOP weighs most in recovery, so it explains much of today's score."}`,
    nextStep: favourable ? "Nothing to act on." : "Read it together with the recovery, sleep and strain findings for today. " + CLINICIAN_NOTE,
    evidence: { z: round(dev.z, 2), zModerate, deltaPct: round(dev.deltaPct, 1) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Rules 54 to 58: conditional recovery comparisons (Welch)

interface SplitSpec {
  rule: string;
  /** Returns true when row i is in the "condition" group, false for the comparison group, null to skip. */
  inGroup: (days: DailySummary[], i: number) => boolean | null;
  minEach: number;
  /** When set, only a difference in this direction is reported. */
  direction?: "lower";
  title: (diff: number) => string;
  conditionLabel: string;
  otherLabel: string;
  method: string;
  interpret: (diff: number) => string;
  nextStep: string;
  evidence?: Record<string, unknown>;
}

function splitComparison(ctx: EngineContext, spec: SplitSpec): Finding | null {
  const metric: MetricKey = "recovery_score";
  if (!ctx.baselines[metric].ready) return null;
  const days = tail(ctx.days, WINDOW + 1);
  const a: number[] = [];
  const b: number[] = [];
  let lastConditionDay: string | null = null;
  for (let i = 1; i < days.length; i++) {
    const row = days[i];
    const rec = row.scored ? row.recovery_score : null;
    if (typeof rec !== "number" || !Number.isFinite(rec)) continue;
    const g = spec.inGroup(days, i);
    if (g == null) continue;
    if (g) {
      a.push(rec);
      lastConditionDay = row.day;
    } else b.push(rec);
  }
  if (a.length < spec.minEach || b.length < spec.minEach) return null;
  const w = welch(a, b);
  if (!w) return null;
  const excludesZero = w.ci[0] > 0 || w.ci[1] < 0;
  if (!excludesZero || Math.abs(w.diff) < 3) return null;
  if (spec.direction === "lower" && w.diff >= 0) return null;
  const lv = lastValid(ctx.days, metric);
  const severity: Severity = spec.direction === "lower" ? (Math.abs(w.diff) >= 15 ? "moderate" : "low") : "info";
  return finding({
    rule: spec.rule,
    engine: ENGINE,
    kind: "pattern",
    metric,
    day: lv?.day ?? ctx.today,
    severity,
    title: spec.title(w.diff),
    value: mean(a),
    baseline: mean(b),
    method: `${spec.method}; Welch comparison of means, 95% CI excludes zero, difference at least 3 points`,
    completeness: Math.min(1, (a.length + b.length) / Math.min(WINDOW, Math.max(1, ctx.days.length - 1))),
    explanation: `Over the last ${Math.min(WINDOW, ctx.days.length - 1)} days, recovery averaged ${fmtMetric(metric, mean(a))} on ${a.length} ${spec.conditionLabel}, against ${fmtMetric(metric, mean(b))} on ${b.length} ${spec.otherLabel}: a difference of ${w.diff > 0 ? "+" : ""}${round(w.diff, 1)} points (95% CI ${round(w.ci[0], 1)} to ${round(w.ci[1], 1)}). ${spec.interpret(w.diff)} This is a pattern in your own data, not a cause.`,
    nextStep: spec.nextStep,
    evidence: { diff: round(w.diff, 2), ci: [round(w.ci[0], 2), round(w.ci[1], 2)], nCondition: w.nA, nOther: w.nB, t: round(w.t, 2), lastConditionDay, ...spec.evidence },
  });
}

const prev = (days: DailySummary[], i: number, metric: MetricKey): number | null => {
  const d = days[i - 1];
  const v = d && d.scored ? d[metric] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const same = (days: DailySummary[], i: number, metric: MetricKey): number | null => {
  const d = days[i];
  const v = d.scored ? d[metric] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function conditionalComparisons(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const push = (f: Finding | null) => {
    if (f) out.push(f);
  };
  const sleepB = ctx.baselines.sleep_total_min;
  const strainB = ctx.baselines.day_strain;

  if (enabled(ctx, RULES.sleepDeficit) && sleepB.ready && sleepB.p25 != null) {
    const p25 = sleepB.p25;
    push(
      splitComparison(ctx, {
        rule: RULES.sleepDeficit,
        inGroup: (days, i) => {
          const s = same(days, i, "sleep_total_min");
          return s == null ? null : s < p25;
        },
        minEach: 5,
        direction: "lower",
        title: () => "Short nights are followed by lower recovery",
        conditionLabel: `mornings after less than ${fmtMetric("sleep_total_min", p25)} of sleep (your 25th percentile)`,
        otherLabel: "other mornings",
        method: "same-row sleep_total_min below personal p25 vs the rest",
        interpret: (d) => `Sleeping under your usual lower quartile costs you roughly ${round(Math.abs(d), 0)} recovery points on average.`,
        nextStep: "Protecting sleep duration is the most direct lever this pattern points to.",
        evidence: { sleepP25: round(p25, 1) },
      }),
    );
  }
  if (enabled(ctx, RULES.strainDeficit) && strainB.ready && strainB.p75 != null) {
    const p75 = strainB.p75;
    push(
      splitComparison(ctx, {
        rule: RULES.strainDeficit,
        inGroup: (days, i) => {
          const s = prev(days, i, "day_strain");
          return s == null ? null : s > p75;
        },
        minEach: 5,
        direction: "lower",
        title: () => "High-strain days are followed by lower recovery",
        conditionLabel: `mornings after a day above ${round(p75, 1)} strain (your 75th percentile)`,
        otherLabel: "other mornings",
        method: "previous-row day_strain above personal p75 vs the rest",
        interpret: (d) => `Your biggest days cost you roughly ${round(Math.abs(d), 0)} recovery points the next morning on average.`,
        nextStep: "Plan the morning after a big day as an easy one, and give those nights extra sleep.",
        evidence: { strainP75: round(p75, 2) },
      }),
    );
  }
  if (enabled(ctx, RULES.afterHardWorkouts)) {
    const ws = valid(series(ctx.days, "workout_strain", WINDOW));
    const p75 = ws.length >= 7 ? quantile(ws, 0.75) : null;
    if (p75 != null) {
      push(
        splitComparison(ctx, {
          rule: RULES.afterHardWorkouts,
          inGroup: (days, i) => {
            const s = prev(days, i, "workout_strain");
            return s == null ? false : s > p75;
          },
          minEach: 5,
          title: (d) => (d < 0 ? "Hard workouts are followed by lower recovery" : "Hard workouts are followed by higher recovery"),
          conditionLabel: `mornings after a workout above ${round(p75, 1)} workout strain (your 75th percentile)`,
          otherLabel: "other mornings",
          method: "previous-row workout_strain above the 90-day p75 of workout days vs the rest",
          interpret: (d) => (d < 0 ? "Your hardest sessions show up in the next morning's recovery." : "Your hardest sessions have not dented next-morning recovery; if anything it has been higher, which can happen when hard days come with early nights."),
          nextStep: "Useful when deciding how to space your hardest sessions.",
          evidence: { workoutStrainP75: round(p75, 2) },
        }),
      );
    }
  }
  if (enabled(ctx, RULES.afterRestDays)) {
    push(
      splitComparison(ctx, {
        rule: RULES.afterRestDays,
        inGroup: (days, i) => {
          const c = prev(days, i, "workout_count");
          return c == null ? null : c === 0;
        },
        minEach: 5,
        title: (d) => (d > 0 ? "Rest days are followed by higher recovery" : "Rest days are followed by lower recovery"),
        conditionLabel: "mornings after a day with no workout",
        otherLabel: "mornings after a workout day",
        method: "previous-row workout_count of 0 vs at least one workout",
        interpret: (d) => (d > 0 ? "A day off shows up as a recovery gain the next morning." : "Mornings after rest days have scored lower, which sometimes happens when rest days are also later nights or travel days."),
        nextStep: "Helps judge how much a rest day is worth to you right now.",
      }),
    );
  }
  if (enabled(ctx, RULES.afterNaps)) {
    push(
      splitComparison(ctx, {
        rule: RULES.afterNaps,
        inGroup: (days, i) => {
          const c = prev(days, i, "nap_count");
          return c == null ? null : c > 0;
        },
        minEach: 5,
        title: (d) => (d > 0 ? "Naps are followed by higher recovery" : "Naps are followed by lower recovery"),
        conditionLabel: "mornings after a day with a nap",
        otherLabel: "mornings after a day without one",
        method: "previous-row nap_count above 0 vs none",
        interpret: (d) => (d > 0 ? "Afternoon sleep seems to add to the next morning's recovery for you." : "Mornings after napping have scored lower; naps often follow short nights, so the nap may be a marker rather than the cause."),
        nextStep: "Context for deciding whether to nap on tired days.",
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Rules 59 and 60: correlations

interface CorrelationSpec {
  rule: string;
  xs: (number | null)[];
  ys: (number | null)[];
  xLabel: string;
  yLabel: string;
  lag: number;
  title: (r: number) => string;
  interpret: (r: number) => string;
  completeness: number;
}

function correlationFinding(ctx: EngineContext, spec: CorrelationSpec): Finding | null {
  const p = pearson(spec.xs, spec.ys);
  if (!p || p.n < CORRELATION_MIN_N || Math.abs(p.r) < CORRELATION_MIN_R) return null;
  const ci = correlationCI(p.r, p.n);
  const lv = lastValid(ctx.days, "recovery_score");
  return finding({
    rule: spec.rule,
    engine: ENGINE,
    kind: "correlation",
    metric: "recovery_score",
    day: lv?.day ?? ctx.today,
    severity: "info",
    title: spec.title(p.r),
    value: round(p.r, 3),
    baseline: null,
    method: `Pearson correlation over the last ${WINDOW} days${spec.lag ? `, lag ${spec.lag} day` : ""}; needs n >= ${CORRELATION_MIN_N} and |r| >= ${CORRELATION_MIN_R}`,
    completeness: spec.completeness,
    explanation: `Across ${p.n} paired days there is ${describeR(p.r)} association between ${spec.xLabel} and ${spec.yLabel} (r ${round(p.r, 2)}${ci ? `, 95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)}` : ""}). ${spec.interpret(p.r)} An association in your data is not a cause.`,
    nextStep: "Use this as a hint about what moves your recovery. It gets more reliable as more days accumulate.",
    evidence: { n: p.n, r: round(p.r, 4), ci: ci ? [round(ci[0], 4), round(ci[1], 4)] : null, lag: spec.lag, periodDays: WINDOW, x: spec.xLabel, y: spec.yLabel },
  });
}

function correlations(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const days = tail(ctx.days, WINDOW + 1);
  const cut = (xs: (number | null)[]) => tail(xs, WINDOW);
  const recovery = series(days, "recovery_score");
  if (enabled(ctx, RULES.vsSleepRegularity)) {
    const f = correlationFinding(ctx, {
      rule: RULES.vsSleepRegularity,
      xs: cut(series(days, "sleep_consistency")),
      ys: cut(recovery),
      xLabel: "sleep consistency",
      yLabel: "that morning's recovery",
      lag: 0,
      title: (r) => (r > 0 ? "More regular sleep goes with higher recovery" : "More regular sleep goes with lower recovery"),
      interpret: (r) => (r > 0 ? "Keeping bed and wake times steady has coincided with better recovery for you." : "Regular weeks have coincided with lower recovery, which can happen when your most regular stretches are also your heaviest training blocks."),
      completeness: Math.min(completenessOf(ctx.days, "sleep_consistency", WINDOW), completenessOf(ctx.days, "recovery_score", WINDOW)),
    });
    if (f) out.push(f);
  }
  if (enabled(ctx, RULES.vsPrevExertion)) {
    const f = correlationFinding(ctx, {
      rule: RULES.vsPrevExertion,
      xs: cut(shiftBack(series(days, "day_strain"), 1)),
      ys: cut(recovery),
      xLabel: "the previous day's strain",
      yLabel: "the next morning's recovery",
      lag: 1,
      title: (r) => (r < 0 ? "Bigger days are followed by lower recovery" : "Bigger days are followed by higher recovery"),
      interpret: (r) => (r < 0 ? "Your recovery tends to fall after higher-strain days, the expected direction." : "Your recovery has tended to be higher after bigger days, which can happen when training days also bring better sleep or routine."),
      completeness: Math.min(completenessOf(ctx.days, "day_strain", WINDOW), completenessOf(ctx.days, "recovery_score", WINDOW)),
    });
    if (f) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Engine

export const recoveryEngine: Engine = (ctx) => {
  const out: Finding[] = [];
  const push = (f: Finding | null) => {
    if (f && enabled(ctx, f.rule)) out.push(f);
  };
  out.push(...recoveryTrend(ctx));
  if (enabled(ctx, RULES.lowStreak)) push(lowStreak(ctx));
  if (enabled(ctx, RULES.volatility)) push(volatility(ctx));
  if (enabled(ctx, RULES.hrvDeviation)) push(cardioDeviation(ctx, RULES.hrvDeviation, "hrv_rmssd"));
  if (enabled(ctx, RULES.rhrDeviation)) push(cardioDeviation(ctx, RULES.rhrDeviation, "resting_hr"));
  out.push(...conditionalComparisons(ctx));
  out.push(...correlations(ctx));
  return out;
};

// ---------------------------------------------------------------------------------------------------
// Readiness score

export const READINESS_VERSION = "readiness.v1";

const READINESS_NOTE =
  "Readiness is FRADY's own composite of HRV, resting heart rate, sleep, recent strain and recent recovery against your own history. It is not WHOOP's recovery score and does not assess medical fitness to exercise. As a rule of thumb: below 40, favour an easy day; 40 to 70, a normal day; above 70, a harder session is reasonable if you feel up to it.";

/** Clipped linear map of x from [x0 -> 0] to [x1 -> 100]. Works with x1 < x0 for inverse scales. */
function linearScore(x: number, x0: number, x1: number): number {
  return clamp(((x - x0) / (x1 - x0)) * 100, 0, 100);
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function readinessScore(ctx: EngineContext, day?: string): DerivedScore {
  const target = day ?? ctx.today;
  let idx = ctx.days.findIndex((d) => d.day === target);
  if (idx < 0 && !day) idx = ctx.days.length - 1;
  const factors: DerivedScore["factors"] = [];
  const miss = (key: string, label: string, weight: number, detail: string) => factors.push({ key, label, weight, score: null, detail });

  if (idx < 0) {
    miss("hrv", "HRV vs baseline", 30, "No row for this day.");
    miss("rhr", "Resting HR vs baseline", 25, "No row for this day.");
    miss("sleep", "Sleep sufficiency", 20, "No row for this day.");
    miss("strain", "Recent strain", 15, "No row for this day.");
    miss("recovery", "Recent recovery", 10, "No row for this day.");
    return { key: "readiness", day: target, value: null, version: READINESS_VERSION, factors, completeness: 0, note: READINESS_NOTE };
  }

  const today = ctx.days[idx];
  const before = ctx.days.slice(0, idx);
  const todayVal = (m: MetricKey) => (today.scored ? num(today[m]) : null);

  // HRV: z of today vs the 30 days before, z -2 -> 0, z +1 -> 100.
  {
    const x = todayVal("hrv_rmssd");
    const hist = valid(series(before, "hrv_rmssd", 30));
    const m = mean(hist);
    const s = sd(hist);
    if (x == null) miss("hrv", "HRV vs baseline", 30, "No HRV reading this morning.");
    else if (m == null || s == null || s <= 0 || hist.length < 7) miss("hrv", "HRV vs baseline", 30, "Not enough HRV history in the last 30 days.");
    else {
      const z = (x - m) / s;
      factors.push({ key: "hrv", label: "HRV vs baseline", weight: 30, score: round(linearScore(z, -2, 1), 1)!, detail: `${fmtMetric("hrv_rmssd", x)} vs a 30-day mean of ${fmtMetric("hrv_rmssd", m)} (z ${round(z, 2)}; -2 scores 0, +1 scores 100).` });
    }
  }
  // RHR: inverse, z +2 -> 0, z -1 -> 100.
  {
    const x = todayVal("resting_hr");
    const hist = valid(series(before, "resting_hr", 30));
    const m = mean(hist);
    const s = sd(hist);
    if (x == null) miss("rhr", "Resting HR vs baseline", 25, "No resting heart rate reading this morning.");
    else if (m == null || s == null || s <= 0 || hist.length < 7) miss("rhr", "Resting HR vs baseline", 25, "Not enough resting heart rate history in the last 30 days.");
    else {
      const z = (x - m) / s;
      factors.push({ key: "rhr", label: "Resting HR vs baseline", weight: 25, score: round(linearScore(z, 2, -1), 1)!, detail: `${fmtMetric("resting_hr", x)} vs a 30-day mean of ${fmtMetric("resting_hr", m)} (z ${round(z, 2)}; +2 scores 0, -1 scores 100).` });
    }
  }
  // Sleep sufficiency: sleep vs need (or 30-day median), ratio 0.7 -> 0, 1.0 -> 100.
  {
    const x = todayVal("sleep_total_min");
    const need = todayVal("sleep_need_min");
    const ref = need ?? quantile(valid(series(before, "sleep_total_min", 30)), 0.5);
    if (x == null) miss("sleep", "Sleep sufficiency", 20, "No sleep total for last night.");
    else if (ref == null || ref <= 0) miss("sleep", "Sleep sufficiency", 20, "No sleep need and not enough sleep history to compare with.");
    else {
      const ratio = x / ref;
      factors.push({ key: "sleep", label: "Sleep sufficiency", weight: 20, score: round(linearScore(ratio, 0.7, 1.0), 1)!, detail: `${fmtMetric("sleep_total_min", x)} against ${need != null ? "a need of" : "a 30-day median of"} ${fmtMetric("sleep_total_min", ref)} (${round(ratio * 100, 0)}%; 70% scores 0, 100% scores 100).` });
    }
  }
  // Recent strain: yesterday's strain vs 28-day mean, ratio 0.5 -> 100, 1.5 -> 0.
  {
    const y = before.length ? (before[before.length - 1].scored ? num(before[before.length - 1].day_strain) : null) : null;
    const hist = valid(series(before, "day_strain", 28));
    const m = mean(hist);
    if (y == null) miss("strain", "Recent strain", 15, "No strain recorded for yesterday.");
    else if (m == null || m <= 0 || hist.length < 7) miss("strain", "Recent strain", 15, "Not enough strain history in the last 28 days.");
    else {
      const ratio = y / m;
      factors.push({ key: "strain", label: "Recent strain", weight: 15, score: round(linearScore(ratio, 1.5, 0.5), 1)!, detail: `Yesterday's strain ${round(y, 1)} against a 28-day mean of ${round(m, 1)} (${round(ratio * 100, 0)}%; 150% scores 0, 50% scores 100).` });
    }
  }
  // Recent recovery history: mean of the last 3 recovery scores (through today), already 0..100.
  {
    const last3 = valid(series(ctx.days.slice(0, idx + 1), "recovery_score", 3));
    if (last3.length < 2) miss("recovery", "Recent recovery", 10, "Fewer than two recovery scores in the last three days.");
    else factors.push({ key: "recovery", label: "Recent recovery", weight: 10, score: round(clamp(mean(last3)!, 0, 100), 1)!, detail: `Mean of the last ${last3.length} recovery scores: ${fmtMetric("recovery_score", mean(last3))}.` });
  }

  const present = factors.filter((f) => f.score != null);
  const weightPresent = present.reduce((a, f) => a + f.weight, 0);
  const completeness = round(weightPresent / 100, 2) ?? 0;
  const baselinesReady = ctx.baselines.hrv_rmssd.ready && ctx.baselines.resting_hr.ready;
  const value = present.length >= 2 && baselinesReady && weightPresent > 0 ? round(present.reduce((a, f) => a + f.weight * (f.score as number), 0) / weightPresent, 0) : null;
  const note = baselinesReady ? READINESS_NOTE : `${READINESS_NOTE} Not scored yet: the HRV and resting heart rate baselines need at least 14 scored days.`;
  return { key: "readiness", day: today.day, value, version: READINESS_VERSION, factors, completeness, note };
}
