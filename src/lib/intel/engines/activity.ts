/**
 * Activity engine: daily strain, workouts and training load from the strap's daily summaries.
 *
 * Steps and minute-level movement are not available from any connected source, so this engine emits a
 * single status finding saying so instead of step rules, and never substitutes a zero.
 */

import type { EngineContext, Finding, MetricKey, Severity } from "../types";
import { correlationCI, mean, pearson, round, sd, slope, tail, valid } from "../stats";
import { series } from "../baselines";
import { completenessOf, deviation, finding, fmtMetric, severityFromZ } from "../findings";

const ENGINE = "activity" as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "activity.steps_unavailable", label: "Steps not available", description: "No connected source provides step counts, so no step rules run." },
  { rule: "activity.strain_consistency", label: "Daily activity consistency", description: "How evenly day strain is spread over the last 28 days (coefficient of variation)." },
  { rule: "activity.workout_frequency", label: "Workout frequency", description: "Workouts per week over the last 4 weeks against the previous 8." },
  { rule: "activity.workout_duration_trend", label: "Workout duration trend", description: "Average workout length over the last 4 weeks against the previous 8." },
  { rule: "activity.workout_strain_trend", label: "Workout strain trend", description: "Average strain per workout over the last 4 weeks against the previous 8." },
  { rule: "activity.strain_status", label: "Daily strain", description: "The latest day strain against your 90-day median." },
  { rule: "activity.strain_deviation", label: "Daily strain deviation", description: "Day strain well above or below your own history." },
  { rule: "activity.acute_load_change", label: "Acute load change", description: "Strain over the last 7 days against the previous 7." },
  { rule: "activity.longterm_load_change", label: "Long-term load change", description: "Mean strain over the last 28 days against the previous 56." },
  { rule: "activity.strain_vs_recovery", label: "Strain and next-day recovery", description: "Association between day strain and the following morning's recovery score." },
  { rule: "activity.intensity_trend", label: "Workout intensity trend", description: "Average workout heart rate as a share of workout max, last 30 days against the previous 30." },
  { rule: "activity.energy_trend", label: "Energy expenditure trend", description: "Slope of daily energy expenditure over 30 days." },
  { rule: "activity.strain_vs_sleep", label: "Strain and the following night's sleep", description: "Association between day strain and the sleep that follows it." },
  { rule: "activity.strain_vs_resting_hr", label: "Strain and next-day resting heart rate", description: "Association between day strain and the following morning's resting heart rate." },
  { rule: "activity.strain_vs_hrv", label: "Strain and next-day HRV", description: "Association between day strain and the following morning's HRV." },
  { rule: "activity.rest_day_frequency", label: "Rest days", description: "Fewer than one rest day a week for three weeks." },
  { rule: "activity.acwr_status", label: "Acute to chronic workload", description: "7-day mean strain divided by 28-day mean strain, with bands." },
];

const MIN_CORR_N = 14;

export interface TrainingLoad {
  acute: number | null;
  chronic: number | null;
  ratio: number | null;
  /** Last 8 weekly strain sums, oldest first. Weeks are 7-day blocks counted back from today. */
  weeklyStrain: number[];
  restDaysPerWeek: number | null;
}

/** Split a trailing series into 7-day blocks counted back from the end; block 0 is the latest week. */
function weekBlocks(xs: (number | null)[], weeks: number): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const end = xs.length - w * 7;
    const start = end - 7;
    if (start < 0) break;
    out.push(xs.slice(start, end));
  }
  return out;
}

export function trainingLoad(ctx: EngineContext): TrainingLoad {
  const strain28 = series(ctx.days, "day_strain", 28);
  const acute = valid(tail(strain28, 7)).length >= 4 ? mean(tail(strain28, 7)) : null;
  const chronic = valid(strain28).length >= 14 ? mean(strain28) : null;
  const ratio = acute != null && chronic != null && chronic > 0 ? acute / chronic : null;
  const weeklyStrain = weekBlocks(series(ctx.days, "day_strain", 56), 8)
    .filter((b) => valid(b).length > 0)
    .map((b) => round(valid(b).reduce((a, v) => a + v, 0), 1)!)
    .reverse();
  const counts = series(ctx.days, "workout_count", 28);
  const known = valid(counts);
  const restDaysPerWeek = known.length >= 7 ? (known.filter((c) => c === 0).length / known.length) * 7 : null;
  return { acute: round(acute, 2), chronic: round(chronic, 2), ratio: round(ratio, 2), weeklyStrain, restDaysPerWeek: round(restDaysPerWeek, 2) };
}

function corrFinding(
  rule: string,
  metric: MetricKey,
  title: string,
  xs: (number | null)[],
  ys: (number | null)[],
  day: string,
  describe: (r: number) => string,
  lag: number,
): Finding | null {
  const p = pearson(xs, ys);
  if (!p || p.n < MIN_CORR_N) return null;
  const ci = correlationCI(p.r, p.n) ?? (Math.abs(p.r) >= 1 ? ([p.r, p.r] as [number, number]) : null);
  if (!ci || Math.abs(p.r) < 0.3 || (ci[0] < 0 && ci[1] > 0)) return null;
  return finding({
    rule,
    engine: ENGINE,
    kind: "correlation",
    metric,
    day,
    severity: "info",
    title,
    value: p.r,
    method: `Pearson correlation over the last 90 days${lag ? `, lag ${lag} day` : ""}`,
    completeness: p.n / 90,
    explanation: `${describe(p.r)} Across ${p.n} paired days r = ${round(p.r, 2)} (95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)}). This is an association in your own data, not a cause.`,
    nextStep: "Use it to plan hard days around the nights that matter rather than as a rule.",
    evidence: { n: p.n, r: round(p.r, 3), ci: [round(ci[0], 3), round(ci[1], 3)], period: 90, lag },
  });
}

/** Pair x on day t with y on day t+lag over the last 90 pairs. */
function lagPairs(ctx: EngineContext, x: MetricKey, y: MetricKey, lag: number): [(number | null)[], (number | null)[]] {
  const xs = series(ctx.days, x, 90 + lag);
  const ys = series(ctx.days, y, 90 + lag);
  return [xs.slice(0, xs.length - lag), ys.slice(lag)];
}

function acwrBand(ratio: number): { label: string; severity: Severity; note: string } {
  if (ratio < 0.8) return { label: "below 0.8", severity: "info", note: "Recent load is well below your 4-week average, which fits a planned taper or a lighter week." };
  if (ratio <= 1.3) return { label: "0.8 to 1.3", severity: "info", note: "Recent load is in step with your 4-week average." };
  if (ratio <= 1.5) return { label: "1.3 to 1.5", severity: "low", note: "Recent load has risen faster than your 4-week average. Many coaches treat this band as a cue to hold rather than add." };
  return { label: "above 1.5", severity: "moderate", note: "Recent load is well above your 4-week average. A sharp ramp like this is often paired with lower recovery over the following days." };
}

export function activityEngine(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const on = (rule: string) => !ctx.settings.disabled.has(rule);
  const { zModerate } = ctx.settings;
  const strain = ctx.baselines.day_strain;
  const day = strain.lastDay ?? ctx.today;

  // 82 to 86: steps are not available from any connected source.
  if (on("activity.steps_unavailable")) {
    out.push(
      finding({
        rule: "activity.steps_unavailable",
        engine: ENGINE,
        kind: "status",
        metric: "steps",
        day: ctx.today,
        severity: "info",
        title: "Steps are not available",
        method: "Source capability check",
        completeness: 0,
        explanation: "No connected source provides step counts. The WHOOP export and developer API do not carry steps, so step and inactivity rules do not run and no zero is substituted.",
        nextStep: "Connect a source that records steps if you want movement-count rules. Day strain and workouts cover activity meanwhile.",
      }),
    );
  }

  // 87 daily activity consistency: coefficient of variation of day strain over 28 days.
  if (on("activity.strain_consistency")) {
    const s28 = series(ctx.days, "day_strain", 28);
    const v = valid(s28);
    const m = mean(v);
    const s = sd(v);
    if (v.length >= 14 && m != null && s != null && m > 0) {
      const cv = s / m;
      const band = cv < 0.25 ? "very even" : cv < 0.45 ? "fairly even" : cv < 0.65 ? "mixed" : "uneven";
      out.push(
        finding({
          rule: "activity.strain_consistency",
          engine: ENGINE,
          kind: "status",
          metric: "day_strain",
          day,
          severity: "info",
          title: `Daily activity is ${band} across the last 4 weeks`,
          value: cv,
          method: "Coefficient of variation of day strain over 28 days",
          completeness: v.length / 28,
          explanation: `Day strain averaged ${round(m, 1)} with a standard deviation of ${round(s, 1)} (CV ${round(cv, 2)}) over ${v.length} days. ${band === "uneven" ? "Hard and very light days alternate widely." : "Day-to-day load is spread reasonably evenly."}`,
          nextStep: "Even is not always better; planned hard and easy days produce a higher CV by design.",
          evidence: { cv: round(cv, 3), mean: round(m, 2), sd: round(s, 2), n: v.length },
        }),
      );
    }
  }

  // 88 to 90 workout frequency, duration and strain: last 4 weeks against the previous 8.
  const counts84 = series(ctx.days, "workout_count", 84);
  const recentCounts = tail(counts84, 28);
  const priorCounts = counts84.slice(0, Math.max(0, counts84.length - 28));
  const perWeek = (xs: (number | null)[]) => {
    const v = valid(xs);
    return v.length >= 7 ? (v.reduce((a, b) => a + b, 0) / v.length) * 7 : null;
  };
  const recentPerWeek = perWeek(recentCounts);
  const priorPerWeek = perWeek(priorCounts);
  if (on("activity.workout_frequency") && recentPerWeek != null) {
    const delta = priorPerWeek != null ? recentPerWeek - priorPerWeek : null;
    const material = delta != null && Math.abs(delta) >= 1;
    out.push(
      finding({
        rule: "activity.workout_frequency",
        engine: ENGINE,
        kind: material ? "trend" : "status",
        metric: "workout_count",
        day,
        severity: "info",
        title: material ? `Workout frequency ${delta! > 0 ? "up" : "down"} to ${round(recentPerWeek, 1)} a week` : `About ${round(recentPerWeek, 1)} workouts a week`,
        value: recentPerWeek,
        baseline: priorPerWeek,
        method: "Workouts per week, last 4 weeks against the previous 8",
        completeness: valid(recentCounts).length / 28,
        explanation:
          priorPerWeek != null
            ? `You logged ${round(recentPerWeek, 1)} workouts a week over the last 4 weeks, against ${round(priorPerWeek, 1)} a week over the 8 weeks before.`
            : `You logged ${round(recentPerWeek, 1)} workouts a week over the last 4 weeks. More history is needed for a comparison.`,
        nextStep: material && delta! > 0 ? "A step up in frequency is easier to absorb when the acute to chronic ratio stays under 1.3." : "No action needed; this is a reference point.",
        evidence: { recentPerWeek: round(recentPerWeek, 2), priorPerWeek: round(priorPerWeek, 2) },
      }),
    );
  }

  const workoutTrend = (rule: string, metric: MetricKey, label: string, threshold: number, unitFmt: (v: number | null) => string) => {
    if (!on(rule)) return;
    const s84 = series(ctx.days, metric, 84);
    const recent = valid(tail(s84, 28));
    const prior = valid(s84.slice(0, Math.max(0, s84.length - 28)));
    if (recent.length < 6 || prior.length < 12) return;
    const mr = mean(recent)!;
    const mp = mean(prior)!;
    const diff = mr - mp;
    if (Math.abs(diff) < threshold) return;
    out.push(
      finding({
        rule,
        engine: ENGINE,
        kind: "trend",
        metric,
        day,
        severity: "info",
        title: `${label} ${diff > 0 ? "up" : "down"} over the last 4 weeks`,
        value: mr,
        baseline: mp,
        method: "Mean per workout, last 4 weeks against the previous 8",
        completeness: recent.length / 12,
        explanation: `Workouts averaged ${unitFmt(mr)} over the last 4 weeks against ${unitFmt(mp)} over the 8 weeks before (${recent.length} and ${prior.length} sessions).`,
        nextStep: "Longer or harder sessions raise load; check the acute to chronic ratio before adding more.",
        evidence: { recentMean: round(mr, 2), priorMean: round(mp, 2), nRecent: recent.length, nPrior: prior.length },
      }),
    );
  };
  workoutTrend("activity.workout_duration_trend", "workout_min", "Workout duration", 10, (v) => fmtMetric("workout_min", v));
  workoutTrend("activity.workout_strain_trend", "workout_strain", "Workout strain", 1.5, (v) => fmtMetric("workout_strain", v));

  // 91 daily strain status and deviation.
  if (on("activity.strain_status") && strain.last != null && strain.lastDay != null) {
    out.push(
      finding({
        rule: "activity.strain_status",
        engine: ENGINE,
        kind: "status",
        metric: "day_strain",
        day: strain.lastDay,
        severity: "info",
        title: "Daily strain",
        value: strain.last,
        baseline: strain.median90,
        method: "Latest day strain against the 90-day median",
        completeness: completenessOf(ctx.days, "day_strain", 7),
        explanation:
          strain.median90 != null && strain.n > 1
            ? `Day strain was ${fmtMetric("day_strain", strain.last)} against your 90-day median of ${fmtMetric("day_strain", strain.median90)}${strain.percentile != null ? ` (percentile ${Math.round(strain.percentile)})` : ""}.`
            : `Day strain was ${fmtMetric("day_strain", strain.last)}. More days are needed before a personal comparison is possible.`,
        nextStep: "Strain is the strap's cardiovascular load estimate; it is most useful as a running comparison against your own days.",
      }),
    );
  }
  if (on("activity.strain_deviation") && strain.ready) {
    const dev = deviation(ctx.days, "day_strain", strain);
    if (dev && Math.abs(dev.z) >= zModerate) {
      const up = dev.z > 0;
      out.push(
        finding({
          rule: "activity.strain_deviation",
          engine: ENGINE,
          kind: "deviation",
          metric: "day_strain",
          day: dev.day,
          severity: severityFromZ(Math.abs(dev.z), zModerate),
          title: up ? "An unusually hard day" : "An unusually light day",
          value: dev.value,
          baseline: strain.median90,
          method: `Robust z of the latest day against the 90-day history (threshold ${zModerate})`,
          completeness: completenessOf(ctx.days, "day_strain", 7),
          explanation: `Day strain was ${fmtMetric("day_strain", dev.value)}, ${round(Math.abs(dev.z), 1)} MAD units ${up ? "above" : "below"} your median of ${fmtMetric("day_strain", strain.median90)}.`,
          nextStep: up ? "Expect recovery and HRV to reflect it tomorrow morning; an easier day after is the usual pattern." : "A light day is not a problem on its own; it is noted so the following recovery can be read in context.",
          evidence: { z: round(dev.z, 2) },
        }),
      );
    }
  }

  // 92 acute load change: last 7 days against the previous 7.
  if (on("activity.acute_load_change")) {
    const s14 = series(ctx.days, "day_strain", 14);
    const last7 = tail(s14, 7);
    const prev7 = s14.slice(0, Math.max(0, s14.length - 7));
    if (valid(last7).length >= 5 && valid(prev7).length >= 5) {
      const a = valid(last7).reduce((x, y) => x + y, 0);
      const b = valid(prev7).reduce((x, y) => x + y, 0);
      const change = b > 0 ? (a - b) / b : null;
      if (change != null && Math.abs(change) >= 0.3) {
        out.push(
          finding({
            rule: "activity.acute_load_change",
            engine: ENGINE,
            kind: "trend",
            metric: "day_strain",
            day,
            severity: change >= 0.5 ? "low" : "info",
            title: `Weekly strain ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% on the week before`,
            value: a,
            baseline: b,
            method: "Sum of day strain over the last 7 days against the previous 7",
            completeness: (valid(last7).length + valid(prev7).length) / 14,
            explanation: `The last 7 days totalled ${round(a, 1)} strain against ${round(b, 1)} the week before.`,
            nextStep: change > 0 ? "Large week-on-week jumps are the usual trigger for a dip in recovery; a steadier ramp spreads the load." : "A lighter week is often planned; no action unless it was not.",
            evidence: { sum7: round(a, 2), prevSum7: round(b, 2), changePct: round(change * 100, 1) },
          }),
        );
      }
    }
  }

  // 93 long-term load change: 28-day mean against the prior 56.
  if (on("activity.longterm_load_change")) {
    const s84 = series(ctx.days, "day_strain", 84);
    const recent = tail(s84, 28);
    const prior = s84.slice(0, Math.max(0, s84.length - 28));
    if (valid(recent).length >= 20 && valid(prior).length >= 40) {
      const mr = mean(recent)!;
      const mp = mean(prior)!;
      const change = mp > 0 ? (mr - mp) / mp : null;
      if (change != null && Math.abs(change) >= 0.2) {
        out.push(
          finding({
            rule: "activity.longterm_load_change",
            engine: ENGINE,
            kind: "trend",
            metric: "day_strain",
            day,
            severity: "info",
            title: `Four-week load ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% on the two months before`,
            value: mr,
            baseline: mp,
            method: "Mean day strain over the last 28 days against the previous 56",
            completeness: (valid(recent).length + valid(prior).length) / 84,
            explanation: `Day strain averaged ${round(mr, 1)} over the last 4 weeks against ${round(mp, 1)} over the 8 weeks before.`,
            nextStep: "Gradual change over months is how fitness is built or rested; this is a reference point.",
            evidence: { mean28: round(mr, 2), mean56prior: round(mp, 2), changePct: round(change * 100, 1) },
          }),
        );
      }
    }
  }

  // 94, 97 to 99 lagged associations: strain on day t against the next morning's values.
  if (strain.ready) {
    const lagged: [string, MetricKey, string, (r: number) => string][] = [
      ["activity.strain_vs_recovery", "recovery_score", "Strain and next-day recovery move together", (r) => (r < 0 ? "Harder days tend to be followed by a lower recovery score." : "Harder days tend to be followed by a higher recovery score.")],
      ["activity.strain_vs_sleep", "sleep_total_min", "Strain and the following night's sleep move together", (r) => (r > 0 ? "Harder days tend to be followed by longer sleep." : "Harder days tend to be followed by shorter sleep.")],
      ["activity.strain_vs_resting_hr", "resting_hr", "Strain and next-day resting heart rate move together", (r) => (r > 0 ? "Harder days tend to be followed by a higher resting heart rate." : "Harder days tend to be followed by a lower resting heart rate.")],
      ["activity.strain_vs_hrv", "hrv_rmssd", "Strain and next-day HRV move together", (r) => (r < 0 ? "Harder days tend to be followed by lower HRV." : "Harder days tend to be followed by higher HRV.")],
    ];
    for (const [rule, metric, title, describe] of lagged) {
      if (!on(rule)) continue;
      const [xs, ys] = lagPairs(ctx, "day_strain", metric, 1);
      const f = corrFinding(rule, "day_strain", title, xs, ys, day, describe, 1);
      if (f) out.push(f);
    }
  }

  // 95 workout intensity trend: avg HR as a share of max HR, last 30 against the previous 30.
  if (on("activity.intensity_trend")) {
    const avg = series(ctx.days, "workout_avg_hr", 60);
    const max = series(ctx.days, "workout_max_hr", 60);
    const share = avg.map((a, i) => (a != null && max[i] != null && max[i]! > 0 ? a / max[i]! : null));
    const recent = valid(tail(share, 30));
    const prior = valid(share.slice(0, Math.max(0, share.length - 30)));
    if (recent.length >= 6 && prior.length >= 6) {
      const mr = mean(recent)!;
      const mp = mean(prior)!;
      const diff = mr - mp;
      if (Math.abs(diff) >= 0.04) {
        out.push(
          finding({
            rule: "activity.intensity_trend",
            engine: ENGINE,
            kind: "trend",
            metric: "workout_avg_hr",
            day,
            severity: "info",
            title: `Workout intensity ${diff > 0 ? "up" : "down"} over the last 30 days`,
            value: mr * 100,
            baseline: mp * 100,
            method: "Workout average HR as a share of workout max HR, last 30 days against the previous 30",
            completeness: recent.length / 15,
            explanation: `Sessions averaged ${Math.round(mr * 100)}% of their peak heart rate over the last 30 days against ${Math.round(mp * 100)}% in the 30 days before (${recent.length} and ${prior.length} sessions).`,
            nextStep: diff > 0 ? "More time near peak heart rate raises recovery demand per session." : "Lower relative intensity is consistent with more easy volume or deliberate recovery sessions.",
            evidence: { recentShare: round(mr, 3), priorShare: round(mp, 3), nRecent: recent.length, nPrior: prior.length },
          }),
        );
      }
    }
  }

  // 96 energy expenditure trend: 30-day slope.
  if (on("activity.energy_trend")) {
    const e30 = series(ctx.days, "energy_kcal", 30);
    const sl = slope(e30);
    const m = mean(e30);
    if (sl != null && m != null && valid(e30).length >= 20 && m > 0) {
      const monthly = sl * 30;
      if (Math.abs(monthly) / m >= 0.1) {
        out.push(
          finding({
            rule: "activity.energy_trend",
            engine: ENGINE,
            kind: "trend",
            metric: "energy_kcal",
            day,
            severity: "info",
            title: `Daily energy expenditure trending ${monthly > 0 ? "up" : "down"}`,
            value: ctx.baselines.energy_kcal.mean7,
            baseline: m,
            method: "Ordinary least-squares slope of daily energy over 30 days",
            completeness: completenessOf(ctx.days, "energy_kcal", 30),
            explanation: `Estimated daily energy has moved about ${Math.round(Math.abs(monthly))} kcal ${monthly > 0 ? "higher" : "lower"} across the month against a 30-day mean of ${Math.round(m)} kcal.`,
            nextStep: "The strap's energy figure tracks heart-rate load, so this mostly mirrors training volume.",
            evidence: { slope30: round(sl, 2), monthlyChange: round(monthly, 0) },
          }),
        );
      }
    }
  }

  // 100 rest-day frequency and acute to chronic workload ratio.
  const load = trainingLoad(ctx);
  if (on("activity.rest_day_frequency")) {
    const blocks = weekBlocks(series(ctx.days, "workout_count", 21), 3);
    if (blocks.length === 3 && blocks.every((b) => valid(b).length >= 5)) {
      const restPerWeek = blocks.map((b) => valid(b).filter((c) => c === 0).length);
      if (restPerWeek.every((r) => r < 1)) {
        out.push(
          finding({
            rule: "activity.rest_day_frequency",
            engine: ENGINE,
            kind: "pattern",
            metric: "workout_count",
            day,
            severity: "info",
            title: "No full rest day in three weeks",
            value: 0,
            baseline: 1,
            method: "Days with no logged workout per 7-day block, last 3 blocks",
            completeness: blocks.reduce((a, b) => a + valid(b).length, 0) / 21,
            explanation: "Every scored day in the last three weeks had at least one logged workout. Light sessions count, so this is about pattern rather than effort.",
            nextStep: "One day a week without a logged session is a common planning default; your recovery trend is the better guide to whether you need it.",
            evidence: { restDaysPerWeek: restPerWeek.reverse() },
          }),
        );
      }
    }
  }
  if (on("activity.acwr_status") && load.ratio != null) {
    const band = acwrBand(load.ratio);
    out.push(
      finding({
        rule: "activity.acwr_status",
        engine: ENGINE,
        kind: "status",
        metric: "day_strain",
        day,
        severity: band.severity,
        title: `Acute to chronic workload ratio ${load.ratio} (${band.label})`,
        value: load.ratio,
        baseline: 1,
        method: "7-day mean day strain divided by 28-day mean day strain",
        completeness: completenessOf(ctx.days, "day_strain", 28),
        explanation: `The last 7 days averaged ${load.acute} strain a day against ${load.chronic} over the last 28, a ratio of ${load.ratio}. ${band.note}`,
        nextStep: band.severity === "info" ? "No action needed; the ratio is a planning aid, not a verdict." : "Consider holding volume steady this week and watching recovery before adding more.",
        evidence: { acute: load.acute, chronic: load.chronic, ratio: load.ratio, band: band.label, weeklyStrain: load.weeklyStrain, restDaysPerWeek: load.restDaysPerWeek },
      }),
    );
  }

  return out;
}
