/**
 * Sleep engine: rules 18 to 46 of the FRADY Health Intelligence brief, plus the Sleep Quality Index.
 *
 * Input is the strap's nightly summary. Stage minutes are the strap's estimates, never EEG, so every
 * finding is a deviation from the person's own history or an association, never a diagnosis. Nothing
 * here infers apnoea, snoring or any disorder.
 */

import { series } from "../baselines";
import { CLINICIAN_NOTE, clockFromNoon, completenessOf, deviation, finding, fmtMetric, severityFromZ, type FindingInput } from "../findings";
import { correlationCI, mean, median, pearson, robustZ, round, sd, slope, spearman, tail, trailingRun, valid, welch } from "../stats";
import type { DailySummary, DerivedScore, Engine, EngineContext, Finding, MetricKey, Severity } from "../types";

const ENGINE = "sleep" as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "sleep.total_status", label: "Total sleep", description: "Last night's total sleep against your need and your 90-day median." },
  { rule: "sleep.total_deviation", label: "Total sleep deviation", description: "Total sleep unusually far from your 90-day median." },
  { rule: "sleep.schedule_status", label: "Bedtime and wake time", description: "When you fell asleep and woke, next to your usual times." },
  { rule: "sleep.late_onset", label: "Late bedtime", description: "Sleep onset more than an hour later than your usual time." },
  { rule: "sleep.time_in_bed_deviation", label: "Time in bed deviation", description: "Time in bed unusually far from your 90-day median." },
  { rule: "sleep.efficiency_deviation", label: "Sleep efficiency deviation", description: "Sleep efficiency unusually far from your 90-day median." },
  { rule: "sleep.deep_deviation", label: "Deep sleep deviation", description: "Estimated deep sleep unusually far from your 90-day median." },
  { rule: "sleep.rem_deviation", label: "REM sleep deviation", description: "Estimated REM sleep unusually far from your 90-day median." },
  { rule: "sleep.light_deviation", label: "Light sleep deviation", description: "Estimated light sleep unusually far from your 90-day median." },
  { rule: "sleep.deep_share_deviation", label: "Deep share deviation", description: "Deep sleep as a share of total sleep, against your usual share." },
  { rule: "sleep.rem_share_deviation", label: "REM share deviation", description: "REM sleep as a share of total sleep, against your usual share." },
  { rule: "sleep.restorative_deviation", label: "Restorative sleep deviation", description: "Deep plus REM minutes against your 90-day median." },
  { rule: "sleep.restorative_share_deviation", label: "Restorative share deviation", description: "Deep plus REM as a share of total sleep, against your usual share." },
  { rule: "sleep.awake_deviation", label: "Awake time deviation", description: "Time awake during the night against your 90-day median." },
  { rule: "sleep.disturbances_deviation", label: "Disturbances deviation", description: "Disturbance count against your 90-day median. Only when the WHOOP API supplies it." },
  { rule: "sleep.consistency_status", label: "Sleep consistency", description: "The strap's sleep consistency score for the latest night." },
  { rule: "sleep.schedule_variability", label: "Schedule variability", description: "Bedtime or wake time varied more this week than over 90 days." },
  { rule: "sleep.debt_status", label: "Sleep debt", description: "The strap's latest sleep debt." },
  { rule: "sleep.debt_accumulated", label: "Accumulated sleep debt", description: "Shortfall against need summed over the last seven nights." },
  { rule: "sleep.need_vs_actual", label: "Need versus actual", description: "Last night's sleep as a share of the need the strap estimated." },
  { rule: "sleep.performance_status", label: "Sleep performance", description: "The strap's sleep performance score for the latest night." },
  { rule: "sleep.recovery_by_need", label: "Recovery after meeting need", description: "Mean recovery after nights at or above need against nights below it." },
  { rule: "sleep.nap_frequency", label: "Nap frequency", description: "Naps this week against your 90-day weekly rate." },
  { rule: "sleep.nap_duration", label: "Nap duration", description: "Latest nap length against your usual naps." },
  { rule: "sleep.night_variability", label: "Night-to-night variability", description: "Total sleep varied more this week than over 90 days." },
  { rule: "sleep.multi_night_restriction", label: "Multi-night restriction", description: "Three or more consecutive nights well below need, or below your lower quartile." },
  { rule: "sleep.stage_shift", label: "Stage distribution change", description: "Deep or REM share this week differs from your 90-day median by more than five points." },
  { rule: "sleep.recovery_after_short_sleep", label: "Recovery after a short night", description: "The morning's recovery in the context of the insufficient night that preceded it." },
  { rule: "sleep.strain_next_day", label: "Sleep and next-day strain", description: "Association between each night's total sleep and the strain of the day it preceded." },
  { rule: "sleep.disruption_trend", label: "Disruption trend", description: "30-day trend in awake time, or in disturbances when supplied." },
  { rule: "sleep.weekend_pattern", label: "Weekend versus weekday", description: "Sleep length and bedtime on Saturday and Sunday against Monday to Friday." },
  { rule: "sleep.respiratory_trend", label: "Overnight respiratory trend", description: "Three-night mean respiratory rate against your 90-day median." },
];

/* ------------------------------------------------------------------------------------------------ */
/* helpers                                                                                           */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Linear score: x0 maps to 0 and x1 to 100, clamped. Works in either direction. */
function lin(x: number, x0: number, x1: number): number {
  return clamp(((x - x0) / (x1 - x0)) * 100, 0, 100);
}

const dayOfWeek = (day: string): number => new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const pctOf = (a: number, b: number): number | null => (b ? (a / b) * 100 : null);
const fmtPct = (v: number | null | undefined, d = 0): string => (v == null ? "no reading" : `${round(v, d)}%`);
const fmtMin = (v: number | null | undefined): string => fmtMetric("sleep_total_min", v);
const dir = (delta: number, up: string, down: string) => (delta >= 0 ? up : down);

/** Share of `part` in `total`, in percent, when both are present and the total is positive. */
function share(part: number | null, total: number | null): number | null {
  return part == null || total == null || total <= 0 ? null : (part / total) * 100;
}

/** A per-day derived value in day order, null when inputs are missing or the day is unscored. */
function derived(days: DailySummary[], f: (d: DailySummary) => number | null, n?: number): (number | null)[] {
  const rows = n == null ? days : tail(days, n);
  return rows.map((d) => (d.scored ? f(d) : null));
}

/** Latest valid value of a derived series against its own 90-day history (robust z). */
function derivedDeviation(days: DailySummary[], f: (d: DailySummary) => number | null, minN: number): { value: number; z: number; baseline: number; day: string; n: number } | null {
  const rows = tail(days, 90);
  const vals = derived(rows, f);
  let li = -1;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] != null) {
      li = i;
      break;
    }
  }
  if (li < 0) return null;
  const hist = vals.slice(0, li);
  const v = valid(hist);
  if (v.length < minN) return null;
  const value = vals[li]!;
  const z = robustZ(value, hist);
  const base = median(hist);
  if (z == null || base == null) return null;
  return { value, z, baseline: base, day: rows[li].day, n: v.length };
}

function patternSeverity(ratio: number): Severity {
  if (ratio >= 2.25) return "moderate";
  if (ratio >= 1.5) return "low";
  return "info";
}

class Emitter {
  readonly out: Finding[] = [];
  constructor(private readonly ctx: EngineContext) {}
  add(i: Omit<FindingInput, "engine">) {
    if (this.ctx.settings.disabled.has(i.rule)) return;
    this.out.push(finding({ ...i, engine: ENGINE }));
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* rules                                                                                             */

interface DevSpec {
  rule: string;
  metric: MetricKey;
  title: string;
  /** Wording for the direction of the deviation: [higher, lower]. */
  words: [string, string];
  nextStep: string;
}

const DEVIATIONS: DevSpec[] = [
  { rule: "sleep.total_deviation", metric: "sleep_total_min", title: "Total sleep", words: ["longer", "shorter"], nextStep: "One night is a data point, not a pattern. Watch whether the next few nights return to your usual length." },
  { rule: "sleep.time_in_bed_deviation", metric: "in_bed_min", title: "Time in bed", words: ["longer", "shorter"], nextStep: "Compare with your total sleep: more time in bed with the same sleep usually means more time awake." },
  { rule: "sleep.efficiency_deviation", metric: "sleep_efficiency", title: "Sleep efficiency", words: ["higher", "lower"], nextStep: "Efficiency is sleep divided by time in bed. A late evening, alcohol or an unfamiliar bed are common reasons for a dip." },
  { rule: "sleep.deep_deviation", metric: "deep_min", title: "Deep sleep", words: ["more", "less"], nextStep: "Stage minutes are the strap's estimate from movement and heart rate, so treat single-night changes loosely." },
  { rule: "sleep.rem_deviation", metric: "rem_min", title: "REM sleep", words: ["more", "less"], nextStep: "REM tends to track total sleep length and a late or interrupted morning. Stage minutes are estimates." },
  { rule: "sleep.light_deviation", metric: "light_min", title: "Light sleep", words: ["more", "less"], nextStep: "Light sleep is the strap's residual stage, so it moves when deep or REM estimates move." },
  { rule: "sleep.awake_deviation", metric: "awake_min", title: "Awake time", words: ["more", "less"], nextStep: "Note anything that could have woken you: noise, heat, late fluids, alcohol or a late meal." },
  { rule: "sleep.disturbances_deviation", metric: "disturbances", title: "Disturbances", words: ["more", "fewer"], nextStep: "Disturbances are brief wakes the strap detected. Note the environment and evening habits before reading more into it." },
];

function metricDeviations(ctx: EngineContext, em: Emitter) {
  for (const spec of DEVIATIONS) {
    if (spec.metric === "disturbances" && ctx.baselines.disturbances.last == null) continue;
    const b = ctx.baselines[spec.metric];
    const d = deviation(ctx.days, spec.metric, b);
    if (!d) continue;
    const sev = severityFromZ(Math.abs(d.z), ctx.settings.zModerate);
    if (sev === "info") continue;
    const word = dir(d.delta, spec.words[0], spec.words[1]);
    em.add({
      rule: spec.rule,
      kind: "deviation",
      metric: spec.metric,
      day: d.day,
      severity: sev,
      title: `${spec.title} ${word} than usual`,
      value: d.value,
      baseline: b.median90,
      method: "robust z of the latest night against the 90-day median (MAD units)",
      completeness: completenessOf(ctx.days, spec.metric, 90),
      explanation: `${spec.title} was ${fmtMetric(spec.metric, d.value)}, ${word} than your 90-day median of ${fmtMetric(spec.metric, b.median90)} (${round(Math.abs(d.z), 1)} MAD units).`,
      nextStep: spec.nextStep,
      evidence: { z: round(d.z, 2), n: b.n },
    });
  }
}

interface ShareSpec {
  rule: string;
  title: string;
  f: (d: DailySummary) => number | null;
  metric: MetricKey | null;
}

const SHARES: ShareSpec[] = [
  { rule: "sleep.deep_share_deviation", title: "Deep sleep share", f: (d) => share(d.deep_min, d.sleep_total_min), metric: "deep_min" },
  { rule: "sleep.rem_share_deviation", title: "REM sleep share", f: (d) => share(d.rem_min, d.sleep_total_min), metric: "rem_min" },
  { rule: "sleep.restorative_share_deviation", title: "Restorative sleep share", f: (d) => (d.deep_min == null || d.rem_min == null ? null : share(d.deep_min + d.rem_min, d.sleep_total_min)), metric: null },
];

const restorativeMin = (d: DailySummary): number | null => (d.deep_min == null || d.rem_min == null ? null : d.deep_min + d.rem_min);

function shareDeviations(ctx: EngineContext, em: Emitter) {
  const minN = 7;
  const rest = derivedDeviation(ctx.days, restorativeMin, minN);
  if (rest) {
    const sev = severityFromZ(Math.abs(rest.z), ctx.settings.zModerate);
    if (sev !== "info") {
      const word = dir(rest.value - rest.baseline, "more", "less");
      em.add({
        rule: "sleep.restorative_deviation",
        kind: "deviation",
        metric: null,
        day: rest.day,
        severity: sev,
        title: `Restorative sleep ${word} than usual`,
        value: rest.value,
        baseline: rest.baseline,
        method: "robust z of deep plus REM minutes against the 90-day median",
        completeness: rest.n / 90,
        explanation: `Deep plus REM was ${fmtMin(rest.value)}, ${word} than your 90-day median of ${fmtMin(rest.baseline)} (${round(Math.abs(rest.z), 1)} MAD units). Stages are the strap's estimates.`,
        nextStep: "Restorative minutes follow total sleep closely. Check whether the night was simply shorter or longer than usual.",
        evidence: { z: round(rest.z, 2), n: rest.n },
      });
    }
  }
  for (const spec of SHARES) {
    const d = derivedDeviation(ctx.days, spec.f, minN);
    if (!d) continue;
    const sev = severityFromZ(Math.abs(d.z), ctx.settings.zModerate);
    if (sev === "info") continue;
    const word = dir(d.value - d.baseline, "higher", "lower");
    em.add({
      rule: spec.rule,
      kind: "deviation",
      metric: spec.metric,
      day: d.day,
      severity: sev,
      title: `${spec.title} ${word} than usual`,
      value: d.value,
      baseline: d.baseline,
      method: "robust z of the stage share of total sleep against the personal 90-day median",
      completeness: d.n / 90,
      explanation: `${spec.title} was ${fmtPct(d.value)} of total sleep, ${word} than your usual ${fmtPct(d.baseline)} (${round(Math.abs(d.z), 1)} MAD units). Stage shares are the strap's estimates, not a sleep study.`,
      nextStep: "A single night's stage mix moves with timing, alcohol and illness. Look for the same shift across several nights before changing anything.",
      evidence: { z: round(d.z, 2), n: d.n },
    });
  }
}

function statusRules(ctx: EngineContext, em: Emitter) {
  const b = ctx.baselines;
  const fresh = (metric: MetricKey) => {
    const bl = b[metric];
    return bl.last != null && bl.lastDay != null && daysBetween(bl.lastDay, ctx.today) <= 7 ? bl : null;
  };

  // 18 total sleep status
  const total = fresh("sleep_total_min");
  if (total) {
    const last = ctx.days.find((d) => d.day === total.lastDay);
    const need = last?.sleep_need_min ?? null;
    const needPct = need != null ? pctOf(total.last!, need) : null;
    em.add({
      rule: "sleep.total_status",
      kind: "status",
      metric: "sleep_total_min",
      day: total.lastDay!,
      severity: "info",
      title: `Slept ${fmtMin(total.last)}`,
      value: total.last,
      baseline: total.median90,
      method: "latest night against need and the 90-day median",
      completeness: completenessOf(ctx.days, "sleep_total_min", 30),
      explanation: `You slept ${fmtMin(total.last)}${need != null ? ` against an estimated need of ${fmtMin(need)} (${fmtPct(needPct)})` : ""}${total.median90 != null ? `. Your 90-day median is ${fmtMin(total.median90)}` : ""}.`,
      nextStep: "Status only. Deviation and debt rules say when this matters.",
      evidence: { need, needPct: round(needPct, 0), mean7: round(total.mean7, 0) },
    });
  }

  // 19 onset and wake status
  const onset = fresh("sleep_onset_min");
  const wake = fresh("wake_min");
  if (onset || wake) {
    const ref = onset ?? wake!;
    em.add({
      rule: "sleep.schedule_status",
      kind: "status",
      metric: onset ? "sleep_onset_min" : "wake_min",
      day: ref.lastDay!,
      severity: "info",
      title: `${onset ? `Asleep ${clockFromNoon(onset.last!)}` : ""}${onset && wake ? ", " : ""}${wake ? `awake ${clockFromNoon(wake.last!)}` : ""}`,
      value: ref.last,
      baseline: ref.median90,
      method: "latest night against the 90-day median clock times",
      completeness: completenessOf(ctx.days, onset ? "sleep_onset_min" : "wake_min", 30),
      explanation: [
        onset ? `Sleep onset ${clockFromNoon(onset.last!)}${onset.median90 != null ? ` (usual ${clockFromNoon(onset.median90)})` : ""}` : null,
        wake ? `wake ${clockFromNoon(wake.last!)}${wake.median90 != null ? ` (usual ${clockFromNoon(wake.median90)})` : ""}` : null,
      ]
        .filter(Boolean)
        .join(", ")
        .concat("."),
      nextStep: "Status only. The late bedtime and schedule variability rules say when timing drifts.",
      evidence: { onset: onset?.last ?? null, wake: wake?.last ?? null, onsetMedian: round(onset?.median90, 0), wakeMedian: round(wake?.median90, 0) },
    });
  }

  // 19 late onset deviation: later than the personal median by more than 60 minutes
  if (onset && onset.ready && onset.median90 != null) {
    const late = onset.last! - onset.median90;
    if (late > 60) {
      const z = robustZ(onset.last!, series(ctx.days, "sleep_onset_min", 90).slice(0, -1));
      const sev: Severity = late > 120 ? "moderate" : "low";
      em.add({
        rule: "sleep.late_onset",
        kind: "deviation",
        metric: "sleep_onset_min",
        day: onset.lastDay!,
        severity: sev,
        title: "Later bedtime than usual",
        value: onset.last,
        baseline: onset.median90,
        method: "sleep onset against the personal 90-day median, more than 60 minutes later",
        completeness: completenessOf(ctx.days, "sleep_onset_min", 90),
        explanation: `You fell asleep at ${clockFromNoon(onset.last!)}, ${fmtMin(late)} later than your usual ${clockFromNoon(onset.median90)}.`,
        nextStep: "A later bedtime with the same wake time shortens the night. If this repeats, your schedule variability and debt rules will pick it up.",
        evidence: { lateMin: round(late, 0), z: round(z, 2) },
      });
    }
  }

  // 31 consistency status
  const cons = fresh("sleep_consistency");
  if (cons) {
    em.add({
      rule: "sleep.consistency_status",
      kind: "status",
      metric: "sleep_consistency",
      day: cons.lastDay!,
      severity: "info",
      title: `Sleep consistency ${fmtPct(cons.last)}`,
      value: cons.last,
      baseline: cons.median90,
      method: "latest strap consistency score against the 90-day median",
      completeness: completenessOf(ctx.days, "sleep_consistency", 30),
      explanation: `The strap scored your sleep consistency at ${fmtPct(cons.last)}${cons.median90 != null ? `, against your 90-day median of ${fmtPct(cons.median90)}` : ""}. Consistency measures how similar your bedtimes and wake times are across recent nights.`,
      nextStep: "Status only.",
    });
  }

  // 33 sleep debt status (latest)
  const debt = fresh("sleep_debt_min");
  if (debt) {
    em.add({
      rule: "sleep.debt_status",
      kind: "status",
      metric: "sleep_debt_min",
      day: debt.lastDay!,
      severity: "info",
      title: `Sleep debt ${fmtMin(debt.last)}`,
      value: debt.last,
      baseline: debt.median90,
      method: "latest strap sleep debt against the 90-day median",
      completeness: completenessOf(ctx.days, "sleep_debt_min", 30),
      explanation: `The strap reports a sleep debt of ${fmtMin(debt.last)}${debt.median90 != null ? `; your 90-day median is ${fmtMin(debt.median90)}` : ""}.`,
      nextStep: "Status only. The accumulated debt rule sums the week.",
    });
  }

  // 34 need vs actual
  if (total) {
    const last = ctx.days.find((d) => d.day === total.lastDay);
    const need = last?.sleep_need_min ?? null;
    if (need != null && need > 0) {
      const p = pctOf(total.last!, need)!;
      em.add({
        rule: "sleep.need_vs_actual",
        kind: "status",
        metric: "sleep_need_min",
        day: total.lastDay!,
        severity: p < 85 ? "low" : "info",
        title: `${fmtPct(p)} of sleep need`,
        value: total.last,
        baseline: need,
        method: "total sleep as a share of the strap's estimated need",
        completeness: completenessOf(ctx.days, "sleep_need_min", 30),
        explanation: `You slept ${fmtMin(total.last)} of an estimated need of ${fmtMin(need)}, ${fmtPct(p)}.${p < 85 ? " That is a shortfall of " + fmtMin(need - total.last!) + "." : ""}`,
        nextStep: p < 85 ? "Need is the strap's estimate and includes any debt it carries. A shortfall of a few nights is normal; a run of them shows up as multi-night restriction." : "Status only.",
        evidence: { needPct: round(p, 0) },
      });
    }
  }

  // 35 performance status
  const perf = fresh("sleep_performance");
  if (perf) {
    em.add({
      rule: "sleep.performance_status",
      kind: "status",
      metric: "sleep_performance",
      day: perf.lastDay!,
      severity: "info",
      title: `Sleep performance ${fmtPct(perf.last)}`,
      value: perf.last,
      baseline: perf.median90,
      method: "latest strap performance score against the 90-day median",
      completeness: completenessOf(ctx.days, "sleep_performance", 30),
      explanation: `The strap scored last night's sleep performance at ${fmtPct(perf.last)}${perf.median90 != null ? `, against your 90-day median of ${fmtPct(perf.median90)}` : ""}. Performance is sleep obtained divided by sleep needed.`,
      nextStep: "Status only.",
    });
  }
}

/** 32 and 39: 7-day SD against 90-day SD for timing and total sleep. */
function variabilityRules(ctx: EngineContext, em: Emitter) {
  const sdPair = (metric: MetricKey) => {
    const s90 = series(ctx.days, metric, 90);
    const s7 = tail(s90, 7);
    if (valid(s90).length < 14 || valid(s7).length < 5) return null;
    const a = sd(s7);
    const b = sd(s90);
    if (a == null || b == null || b <= 0) return null;
    return { sd7: a, sd90: b, ratio: a / b, n7: valid(s7).length };
  };

  const onset = sdPair("sleep_onset_min");
  const wake = sdPair("wake_min");
  const worst = [onset && { ...onset, metric: "sleep_onset_min" as MetricKey, label: "bedtime" }, wake && { ...wake, metric: "wake_min" as MetricKey, label: "wake time" }]
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (worst && worst.sd7 >= 30) {
    const sev = patternSeverity(worst.ratio);
    if (sev !== "info") {
      const lastDay = ctx.baselines[worst.metric].lastDay ?? ctx.today;
      em.add({
        rule: "sleep.schedule_variability",
        kind: "pattern",
        metric: worst.metric,
        day: lastDay,
        severity: sev,
        title: `Irregular ${worst.label} this week`,
        value: worst.sd7,
        baseline: worst.sd90,
        method: "7-day SD of clock time against the 90-day SD",
        completeness: worst.n7 / 7,
        explanation: `Your ${worst.label} varied by ${fmtMin(worst.sd7)} (SD) over the last seven nights, against ${fmtMin(worst.sd90)} over 90 days.${onset && wake ? ` Bedtime SD ${fmtMin(onset.sd7)}, wake SD ${fmtMin(wake.sd7)}.` : ""}`,
        nextStep: "A regular schedule is the strongest lever on sleep quality. Anchoring the wake time is usually easier than anchoring bedtime.",
        evidence: { onsetSd7: round(onset?.sd7, 0), onsetSd90: round(onset?.sd90, 0), wakeSd7: round(wake?.sd7, 0), wakeSd90: round(wake?.sd90, 0), ratio: round(worst.ratio, 2) },
      });
    }
  }

  const total = sdPair("sleep_total_min");
  if (total && total.sd7 >= 45) {
    const sev = patternSeverity(total.ratio);
    if (sev !== "info") {
      em.add({
        rule: "sleep.night_variability",
        kind: "pattern",
        metric: "sleep_total_min",
        day: ctx.baselines.sleep_total_min.lastDay ?? ctx.today,
        severity: sev,
        title: "Sleep length varied more than usual this week",
        value: total.sd7,
        baseline: total.sd90,
        method: "7-day SD of total sleep against the 90-day SD",
        completeness: total.n7 / 7,
        explanation: `Total sleep varied by ${fmtMin(total.sd7)} (SD) over the last seven nights, against ${fmtMin(total.sd90)} over 90 days (${round(total.ratio, 1)}x).`,
        nextStep: "Swinging between short and long nights is harder on recovery than a steady length. Check the schedule and any catch-up sleep.",
        evidence: { ratio: round(total.ratio, 2) },
      });
    }
  }
}

/** Insufficient-night test for rules 33, 40 and 42: below 85% of need, else below the personal p25. */
function shortNight(d: DailySummary, p25: number | null): boolean | null {
  if (d.sleep_total_min == null) return null;
  if (d.sleep_need_min != null && d.sleep_need_min > 0) return d.sleep_total_min < d.sleep_need_min * 0.85;
  if (p25 != null) return d.sleep_total_min < p25;
  return null;
}

function debtAndRestriction(ctx: EngineContext, em: Emitter) {
  const bl = ctx.baselines.sleep_total_min;
  if (!bl.ready || bl.lastDay == null) return;
  const week = tail(ctx.days, 7).filter((d) => d.scored);
  const withTotal = week.filter((d) => d.sleep_total_min != null);
  const median30 = median(series(ctx.days, "sleep_total_min", 30));

  // 33 accumulated debt over 7 nights
  if (withTotal.length >= 5) {
    const needKnown = withTotal.some((d) => d.sleep_need_min != null);
    const ref = (d: DailySummary) => d.sleep_need_min ?? median30;
    let debt = 0;
    let nights = 0;
    for (const d of withTotal) {
      const r = ref(d);
      if (r == null) continue;
      nights++;
      debt += Math.max(0, r - d.sleep_total_min!);
    }
    if (nights >= 5) {
      const perNight = debt / nights;
      const sev: Severity = perNight >= 90 ? "high" : perNight >= 60 ? "moderate" : perNight >= 30 ? "low" : "info";
      em.add({
        rule: "sleep.debt_accumulated",
        kind: sev === "info" ? "status" : "pattern",
        metric: "sleep_debt_min",
        day: bl.lastDay,
        severity: sev,
        title: `${fmtMin(debt)} of sleep debt over the week`,
        value: debt,
        baseline: 0,
        method: needKnown ? "sum over 7 nights of max(0, need minus total); severity by the per-night shortfall" : "sum over 7 nights of max(0, 30-day median minus total); severity by the per-night shortfall",
        completeness: nights / 7,
        explanation: `Across the last ${nights} nights you fell ${fmtMin(debt)} short of ${needKnown ? "the strap's estimated need" : `your 30-day median of ${fmtMin(median30)}`} in total, about ${fmtMin(perNight)} a night.${sev === "info" ? " That is within a normal week." : ""}`,
        nextStep: sev === "info" ? "Nothing to do." : "Debt is repaid gradually. An earlier bedtime for several nights works better than one long lie-in.",
        evidence: { nights, needKnown, perNight: round(perNight, 0) },
      });
    }
  }

  // 40 multi-night restriction
  const p25 = bl.p25;
  const flags = ctx.days.map((d) => (d.scored ? shortNight(d, p25) : null));
  const run = trailingRun(
    flags.map((f) => (f == null ? null : f ? 1 : 0)),
    (x) => x === 1,
  );
  const minRun = Math.max(3, ctx.settings.persistDays);
  if (run >= minRun) {
    const nights = tail(ctx.days, run);
    const totals = nights.map((d) => d.sleep_total_min);
    const needKnown = nights.some((d) => d.sleep_need_min != null);
    const sev: Severity = run >= 7 ? "high" : run >= 5 ? "moderate" : "low";
    em.add({
      rule: "sleep.multi_night_restriction",
      kind: "pattern",
      metric: "sleep_total_min",
      day: nights[nights.length - 1].day,
      severity: sev,
      title: `${run} consecutive short nights`,
      value: mean(totals),
      baseline: needKnown ? mean(nights.map((d) => d.sleep_need_min)) : p25,
      method: needKnown ? "consecutive nights below 85% of the strap's estimated need" : "consecutive nights below your personal 25th percentile",
      completeness: completenessOf(ctx.days, "sleep_total_min", run),
      explanation: `The last ${run} nights averaged ${fmtMin(mean(totals))}, each ${needKnown ? "below 85% of your estimated need" : `below your lower quartile of ${fmtMin(p25)}`}.`,
      nextStep: "Several short nights in a row usually show in recovery and in next-day strain tolerance. Protect the next two or three nights if you can.",
      evidence: { nights: run, totals, needKnown },
    });
  }

  // 42 recovery after an insufficient night
  const lastIdx = ctx.days.length - 1;
  const last = ctx.days[lastIdx];
  const lastShort = last && last.scored ? shortNight(last, p25) : null;
  const recB = ctx.baselines.recovery_score;
  if (lastShort && last.recovery_score != null && recB.ready && recB.median90 != null) {
    const z = robustZ(last.recovery_score, series(ctx.days, "recovery_score", 90).slice(0, -1));
    const below = last.recovery_score < recB.median90;
    const sev = below && z != null ? severityFromZ(Math.abs(z), ctx.settings.zModerate) : "info";
    em.add({
      rule: "sleep.recovery_after_short_sleep",
      kind: "status",
      metric: "recovery_score",
      day: last.day,
      severity: sev,
      title: below ? "Lower recovery after a short night" : "Recovery held after a short night",
      value: last.recovery_score,
      baseline: recB.median90,
      method: "recovery on the morning after an insufficient night against the 90-day recovery median",
      completeness: completenessOf(ctx.days, "recovery_score", 90),
      explanation: `After ${fmtMin(last.sleep_total_min)} of sleep${last.sleep_need_min != null ? ` against a need of ${fmtMin(last.sleep_need_min)}` : ""}, recovery came in at ${fmtPct(last.recovery_score)} against your median of ${fmtPct(recB.median90)}.`,
      nextStep: below ? "A short night followed by lower recovery is the expected pairing. Ease the day's load if you can." : "Recovery can hold for a night or two; repeated short nights usually catch up.",
      evidence: { z: round(z, 2), sleep: last.sleep_total_min, need: last.sleep_need_min },
    });
  }
}

/** 36: mean recovery after nights at or above need versus nights below (Welch). */
function recoveryByNeed(ctx: EngineContext, em: Emitter) {
  const rows = tail(ctx.days, 90).filter((d) => d.scored && d.sleep_total_min != null && d.sleep_need_min != null && d.recovery_score != null);
  const met = rows.filter((d) => d.sleep_total_min! >= d.sleep_need_min!).map((d) => d.recovery_score);
  const under = rows.filter((d) => d.sleep_total_min! < d.sleep_need_min!).map((d) => d.recovery_score);
  if (met.length < 5 || under.length < 5) return;
  const w = welch(met, under);
  if (!w) return;
  const significant = w.ci[0] > 0 || w.ci[1] < 0;
  if (!significant || Math.abs(w.diff) < 3) return;
  em.add({
    rule: "sleep.recovery_by_need",
    kind: "pattern",
    metric: "recovery_score",
    day: ctx.baselines.recovery_score.lastDay ?? ctx.today,
    severity: "info",
    title: w.diff > 0 ? "Recovery is higher after you meet your sleep need" : "Recovery is not higher after you meet your sleep need",
    value: mean(met),
    baseline: mean(under),
    method: "Welch comparison of mean recovery, nights at or above need versus below, 95% CI",
    completeness: rows.length / 90,
    explanation: `Over ${rows.length} nights, recovery averaged ${fmtPct(mean(met))} after the ${met.length} nights at or above your estimated need and ${fmtPct(mean(under))} after the ${under.length} nights below it (difference ${round(w.diff, 0)} points, 95% CI ${round(w.ci[0], 0)} to ${round(w.ci[1], 0)}).`,
    nextStep: "An association in your own data, not a cause. It is a reasonable argument for aiming at the need figure more often.",
    evidence: { nA: w.nA, nB: w.nB, diff: round(w.diff, 1), ci: [round(w.ci[0], 1), round(w.ci[1], 1)], t: round(w.t, 2) },
  });
}

/** 37 and 38: naps. */
function napRules(ctx: EngineContext, em: Emitter) {
  const counts90 = series(ctx.days, "nap_count", 90);
  const v90 = valid(counts90);
  if (v90.length >= 14) {
    const weeks = v90.length / 7;
    const rate = v90.reduce((a, b) => a + b, 0) / weeks;
    const week = valid(tail(counts90, 7));
    const thisWeek = week.reduce((a, b) => a + b, 0);
    if (week.length >= 5 && thisWeek >= 2 && thisWeek >= Math.max(2 * rate, rate + 1.5)) {
      em.add({
        rule: "sleep.nap_frequency",
        kind: "pattern",
        metric: "nap_count",
        day: ctx.baselines.nap_count.lastDay ?? ctx.today,
        severity: thisWeek >= 4 ? "moderate" : "low",
        title: `${thisWeek} naps this week`,
        value: thisWeek,
        baseline: rate,
        method: "naps in the last 7 days against the 90-day weekly nap rate",
        completeness: week.length / 7,
        explanation: `You napped ${thisWeek} times in the last seven days, against a usual ${round(rate, 1)} per week over 90 days.`,
        nextStep: "More naps than usual often follow short or broken nights. Check the week's totals and debt before reading more into it.",
        evidence: { thisWeek, weeklyRate: round(rate, 2), napMin: valid(series(ctx.days, "nap_min", 7)).reduce((a, b) => a + b, 0) },
      });
    }
  }

  const b = ctx.baselines.nap_min;
  const d = deviation(ctx.days, "nap_min", b);
  if (d && d.value > 0) {
    const sev = severityFromZ(Math.abs(d.z), ctx.settings.zModerate);
    if (sev !== "info") {
      const word = dir(d.delta, "longer", "shorter");
      em.add({
        rule: "sleep.nap_duration",
        kind: "deviation",
        metric: "nap_min",
        day: d.day,
        severity: sev,
        title: `Nap ${word} than usual`,
        value: d.value,
        baseline: b.median90,
        method: "robust z of the latest nap against your 90-day nap median",
        completeness: completenessOf(ctx.days, "nap_min", 90),
        explanation: `Your nap was ${fmtMin(d.value)}, ${word} than your usual ${fmtMin(b.median90)} (${round(Math.abs(d.z), 1)} MAD units).`,
        nextStep: "Long or late naps can push bedtime back. If tonight's onset slips, that is the likely reason.",
        evidence: { z: round(d.z, 2), n: b.n },
      });
    }
  }
}

/** 41: deep or REM share, 7-day mean against 90-day median, more than 5 percentage points. */
function stageShift(ctx: EngineContext, em: Emitter) {
  const specs: { label: string; metric: MetricKey; f: (d: DailySummary) => number | null }[] = [
    { label: "Deep", metric: "deep_min", f: (d) => share(d.deep_min, d.sleep_total_min) },
    { label: "REM", metric: "rem_min", f: (d) => share(d.rem_min, d.sleep_total_min) },
  ];
  let best: { label: string; metric: MetricKey; m7: number; med90: number; diff: number; n7: number } | null = null;
  for (const s of specs) {
    const s90 = derived(ctx.days, s.f, 90);
    const s7 = tail(s90, 7);
    if (valid(s90).length < 14 || valid(s7).length < 5) continue;
    const m7 = mean(s7)!;
    const med90 = median(s90)!;
    const diff = m7 - med90;
    if (Math.abs(diff) > 5 && (!best || Math.abs(diff) > Math.abs(best.diff))) best = { label: s.label, metric: s.metric, m7, med90, diff, n7: valid(s7).length };
  }
  if (!best) return;
  const word = dir(best.diff, "higher", "lower");
  em.add({
    rule: "sleep.stage_shift",
    kind: "trend",
    metric: best.metric,
    day: ctx.baselines[best.metric].lastDay ?? ctx.today,
    severity: Math.abs(best.diff) > 10 ? "moderate" : "low",
    title: `${best.label} sleep share ${word} this week`,
    value: best.m7,
    baseline: best.med90,
    method: "7-day mean stage share of total sleep against the 90-day median, more than 5 percentage points",
    completeness: best.n7 / 7,
    explanation: `${best.label} sleep made up ${fmtPct(best.m7)} of total sleep this week, against your usual ${fmtPct(best.med90)}. Stage shares are the strap's estimates from movement and heart rate, not a sleep study.`,
    nextStep: "A week-long shift is more informative than one night. Alcohol, illness, late training and schedule changes all move stage estimates.",
    evidence: { diffPoints: round(best.diff, 1) },
  });
}

/**
 * 43: Pearson between total sleep and the strain of the day it preceded. A row's day is the wake day, so
 * the night on row t ended the morning of day t and day_strain on row t followed it: same-row pairing.
 */
function strainNextDay(ctx: EngineContext, em: Emitter) {
  const rows = tail(ctx.days, 90);
  const sleep = series(rows, "sleep_total_min");
  const strain = series(rows, "day_strain");
  const p = pearson(sleep, strain);
  if (!p || p.n < 14 || Math.abs(p.r) < 0.3) return;
  const ci = correlationCI(p.r, p.n);
  em.add({
    rule: "sleep.strain_next_day",
    kind: "correlation",
    metric: "sleep_total_min",
    day: ctx.baselines.day_strain.lastDay ?? ctx.today,
    severity: "info",
    title: p.r > 0 ? "Longer sleep goes with higher next-day strain" : "Longer sleep goes with lower next-day strain",
    value: p.r,
    baseline: 0,
    method: "Pearson correlation, each night's total sleep against the strain of the day it preceded, Fisher 95% CI",
    completeness: p.n / Math.max(1, rows.length),
    explanation: `Across ${p.n} day pairs, total sleep and the next day's strain correlate at r = ${round(p.r, 2)}${ci ? ` (95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)})` : ""}. ${p.r > 0 ? "You tend to do more the day after a longer night." : "You tend to do less the day after a longer night, which can reflect rest days following long sleeps."}`,
    nextStep: "An association, not a cause. Strain also depends on what you planned, so read this alongside your training week.",
    evidence: { n: p.n, r: round(p.r, 3), ci: ci ? [round(ci[0], 3), round(ci[1], 3)] : null, pairing: "night ending on day t with day_strain of day t" },
  });
}

/** 44: 30-day slope of awake minutes, or of disturbances when the API supplies them. */
function disruptionTrend(ctx: EngineContext, em: Emitter) {
  const useDist = valid(series(ctx.days, "disturbances", 30)).length >= 14;
  const metric: MetricKey = useDist ? "disturbances" : "awake_min";
  const s30 = series(ctx.days, metric, 30);
  const n = valid(s30).length;
  if (n < 14) return;
  const k = slope(s30);
  const med = median(s30);
  if (k == null || med == null) return;
  const change = k * 29;
  const floor = useDist ? 2 : 10;
  if (Math.abs(change) < Math.max(floor, 0.25 * Math.abs(med))) return;
  const worsening = change > 0;
  const sev: Severity = !worsening ? "info" : Math.abs(change) >= 0.5 * Math.abs(med) ? "moderate" : "low";
  const label = useDist ? "disturbances" : "awake time";
  em.add({
    rule: "sleep.disruption_trend",
    kind: "trend",
    metric,
    day: ctx.baselines[metric].lastDay ?? ctx.today,
    severity: sev,
    title: `Night-time ${label} ${worsening ? "rising" : "falling"} over 30 days`,
    value: change,
    baseline: med,
    method: "least-squares slope over 30 days, expressed as the change across the window",
    completeness: n / 30,
    explanation: `${useDist ? "Disturbances" : "Awake time"} ${worsening ? "rose" : "fell"} by about ${useDist ? `${round(Math.abs(change), 1)} per night` : fmtMin(Math.abs(change))} across the last 30 nights, against a 30-day median of ${useDist ? round(med, 1) : fmtMin(med)}.`,
    nextStep: worsening ? "A slow rise in disruption often tracks evening habits, room temperature or stress. Note what changed this month." : "A falling trend is good news. Nothing to do.",
    evidence: { slopePerDay: round(k, 3), n, source: metric },
  });
}

/** 45: Saturday and Sunday against Monday to Friday (Welch), total sleep and onset. */
function weekendPattern(ctx: EngineContext, em: Emitter) {
  const rows = tail(ctx.days, 90).filter((d) => d.scored);
  const isWeekend = (d: DailySummary) => {
    const w = dayOfWeek(d.day);
    return w === 0 || w === 6;
  };
  const we = rows.filter(isWeekend);
  const wd = rows.filter((d) => !isWeekend(d));
  const weTotal = we.map((d) => d.sleep_total_min);
  const wdTotal = wd.map((d) => d.sleep_total_min);
  if (valid(weTotal).length < 8 || valid(wdTotal).length < 5) return;
  const t = welch(weTotal, wdTotal);
  const o = welch(we.map((d) => d.sleep_onset_min), wd.map((d) => d.sleep_onset_min));
  const sig = (w: ReturnType<typeof welch>) => w != null && (w.ci[0] > 0 || w.ci[1] < 0) && Math.abs(w.diff) >= 30;
  const totalSig = sig(t);
  const onsetSig = sig(o);
  if (!totalSig && !onsetSig) return;
  const parts: string[] = [];
  if (t) parts.push(`you sleep ${fmtMin(Math.abs(t.diff))} ${dir(t.diff, "longer", "less")} on Saturday and Sunday (95% CI ${round(t.ci[0], 0)} to ${round(t.ci[1], 0)} min)`);
  if (o) parts.push(`fall asleep ${fmtMin(Math.abs(o.diff))} ${dir(o.diff, "later", "earlier")} (95% CI ${round(o.ci[0], 0)} to ${round(o.ci[1], 0)} min)`);
  em.add({
    rule: "sleep.weekend_pattern",
    kind: "pattern",
    metric: totalSig ? "sleep_total_min" : "sleep_onset_min",
    day: ctx.baselines.sleep_total_min.lastDay ?? ctx.today,
    severity: "info",
    title: totalSig ? `Weekend sleep ${dir(t!.diff, "longer", "shorter")} than weekdays` : `Weekend bedtime ${dir(o!.diff, "later", "earlier")} than weekdays`,
    value: totalSig ? mean(weTotal) : mean(we.map((d) => d.sleep_onset_min)),
    baseline: totalSig ? mean(wdTotal) : mean(wd.map((d) => d.sleep_onset_min)),
    method: "Welch comparison of Saturday and Sunday against Monday to Friday over 90 days, at least 4 weekends",
    completeness: valid(weTotal).length / Math.max(1, we.length),
    explanation: `Over ${valid(weTotal).length} weekend nights and ${valid(wdTotal).length} weekday nights, ${parts.join(" and ")}.`,
    nextStep: "A weekend shift of an hour or more acts like a small time-zone change each week. Keeping the wake time within an hour of weekdays softens it.",
    evidence: {
      weekendNights: valid(weTotal).length,
      weekdayNights: valid(wdTotal).length,
      totalDiff: round(t?.diff, 0),
      totalCi: t ? [round(t.ci[0], 0), round(t.ci[1], 0)] : null,
      onsetDiff: round(o?.diff, 0),
      onsetCi: o ? [round(o.ci[0], 0), round(o.ci[1], 0)] : null,
    },
  });
}

/** 46: three-night mean respiratory rate against the 90-day median. */
function respiratoryTrend(ctx: EngineContext, em: Emitter) {
  const b = ctx.baselines.resp_rate;
  if (!b.ready || b.median90 == null || b.lastDay == null) return;
  const last3 = valid(series(ctx.days, "resp_rate", 3));
  if (last3.length < 2) return;
  const m3 = mean(last3)!;
  const scale = (b.mad90 && b.mad90 > 0 ? b.mad90 : b.sd90) ?? null;
  if (scale == null || scale <= 0) return;
  const z = (m3 - b.median90) / scale;
  const sev = severityFromZ(Math.abs(z), ctx.settings.zModerate);
  if (sev === "info" || Math.abs(m3 - b.median90) < 0.5) return;
  em.add({
    rule: "sleep.respiratory_trend",
    kind: "trend",
    metric: "resp_rate",
    day: b.lastDay,
    severity: sev,
    title: "Unusual overnight respiratory trend",
    value: m3,
    baseline: b.median90,
    method: "3-night mean respiratory rate against the 90-day median, in MAD units",
    completeness: last3.length / 3,
    explanation: `Your overnight respiratory rate averaged ${fmtMetric("resp_rate", m3)} over the last ${last3.length} nights, ${dir(m3 - b.median90, "above", "below")} your 90-day median of ${fmtMetric("resp_rate", b.median90)} (${round(Math.abs(z), 1)} MAD units). This is an unusual overnight respiratory trend in your own data.`,
    nextStep: CLINICIAN_NOTE,
    evidence: { z: round(z, 2), nights: last3.length, mad90: round(b.mad90, 3) },
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* engine                                                                                            */

export const sleepEngine: Engine = (ctx) => {
  const em = new Emitter(ctx);
  if (!ctx.days.length) return em.out;
  statusRules(ctx, em);
  metricDeviations(ctx, em);
  shareDeviations(ctx, em);
  variabilityRules(ctx, em);
  debtAndRestriction(ctx, em);
  recoveryByNeed(ctx, em);
  napRules(ctx, em);
  stageShift(ctx, em);
  strainNextDay(ctx, em);
  disruptionTrend(ctx, em);
  weekendPattern(ctx, em);
  respiratoryTrend(ctx, em);
  return em.out;
};

/* ------------------------------------------------------------------------------------------------ */
/* Sleep Quality Index                                                                               */

export const SQI_VERSION = "sqi.v1";
const SQI_NOTE = "FRADY's own Sleep Quality Index, built from the strap's nightly summary and stage estimates (not EEG). Sufficiency 35, efficiency 20, consistency 15, restorative share 20, disturbances 10; missing factors are dropped and the rest reweighted.";

type Factor = DerivedScore["factors"][number];

function emptySqi(day: string): DerivedScore {
  return { key: "sleep_quality_index", day, value: null, version: SQI_VERSION, factors: [], completeness: 0, note: SQI_NOTE };
}

/** Score the night at `idx` using only that day and the history before it. */
function sqiAt(days: DailySummary[], idx: number): DerivedScore {
  const d = days[idx];
  if (!d || !d.scored) return emptySqi(d?.day ?? "");
  const factors: Factor[] = [];
  const push = (key: string, label: string, weight: number, score: number | null, detail: string) => factors.push({ key, label, weight, score: score == null ? null : Math.round(score), detail });

  // sufficiency 35
  {
    const total = d.sleep_total_min;
    let ref: number | null = d.sleep_need_min != null && d.sleep_need_min > 0 ? d.sleep_need_min : null;
    let refLabel = "need";
    if (ref == null) {
      const prior = days.slice(Math.max(0, idx - 30), idx).filter((x) => x.scored).map((x) => x.sleep_total_min);
      if (valid(prior).length >= 7) {
        ref = median(prior);
        refLabel = "30-day median";
      }
    }
    if (total == null || ref == null) push("sufficiency", "Sufficiency", 35, null, total == null ? "No total sleep." : "No need estimate and under 7 nights of history.");
    else push("sufficiency", "Sufficiency", 35, total >= ref ? 100 : lin(total / ref, 0.6, 1), `${fmtMin(total)} against ${refLabel} ${fmtMin(ref)} (${fmtPct(pctOf(total, ref))}).`);
  }

  // efficiency 20
  if (d.sleep_efficiency == null) push("efficiency", "Efficiency", 20, null, "No efficiency reading.");
  else push("efficiency", "Efficiency", 20, lin(d.sleep_efficiency, 75, 92), `${fmtPct(d.sleep_efficiency)} efficiency (75% scores 0, 92% scores 100).`);

  // consistency 15
  if (d.sleep_consistency != null) push("consistency", "Consistency", 15, clamp(d.sleep_consistency, 0, 100), `Strap consistency ${fmtPct(d.sleep_consistency)}.`);
  else {
    const onsets = days.slice(Math.max(0, idx - 6), idx + 1).filter((x) => x.scored).map((x) => x.sleep_onset_min);
    const s = valid(onsets).length >= 3 ? sd(onsets) : null;
    if (s == null) push("consistency", "Consistency", 15, null, "No consistency score and under 3 bedtimes this week.");
    else push("consistency", "Consistency", 15, lin(s, 90, 15), `Bedtime SD ${fmtMin(s)} over 7 nights (15m scores 100, 90m scores 0).`);
  }

  // restorative share 20
  {
    const rest = restorativeMin(d);
    const sh = share(rest, d.sleep_total_min);
    if (sh == null) push("restorative", "Restorative share", 20, null, "Deep or REM estimate missing.");
    else push("restorative", "Restorative share", 20, lin(sh, 35, 50), `Deep plus REM ${fmtPct(sh)} of total (35% scores 0, 50% scores 100).`);
  }

  // disturbances 10
  if (d.disturbances != null) push("disturbances", "Disturbances", 10, lin(d.disturbances, 10, 2), `${d.disturbances} disturbances (2 score 100, 10 score 0).`);
  else if (d.awake_min != null) push("disturbances", "Disturbances", 10, lin(d.awake_min, 75, 20), `${fmtMin(d.awake_min)} awake (20m scores 100, 75m scores 0).`);
  else push("disturbances", "Disturbances", 10, null, "No disturbance count or awake time.");

  const present = factors.filter((f) => f.score != null);
  const weight = present.reduce((a, f) => a + f.weight, 0);
  const value = present.length >= 2 && weight > 0 ? Math.round(present.reduce((a, f) => a + f.weight * f.score!, 0) / weight) : null;
  return { key: "sleep_quality_index", day: d.day, value, version: SQI_VERSION, factors, completeness: round(weight / 100, 2) ?? 0, note: SQI_NOTE };
}

/** Sleep Quality Index for `day` (default: the last day in the context). */
export function sleepQualityIndex(ctx: EngineContext, day?: string): DerivedScore {
  const idx = day == null ? ctx.days.length - 1 : ctx.days.findIndex((d) => d.day === day);
  if (idx < 0) return emptySqi(day ?? ctx.today);
  return sqiAt(ctx.days, idx);
}

/** Scores every night and compares with the strap's sleep performance, to validate the index's sensitivity. */
export function sensitivityReport(days: DailySummary[]): { nights: number; mean: number | null; sd: number | null; spearmanWithPerformance: number | null } {
  const scores: (number | null)[] = [];
  const perf: (number | null)[] = [];
  days.forEach((d, i) => {
    const s = sqiAt(days, i).value;
    if (s == null) return;
    scores.push(s);
    perf.push(d.scored ? d.sleep_performance : null);
  });
  const rho = spearman(scores, perf);
  return { nights: scores.length, mean: round(mean(scores), 1), sd: round(sd(scores), 1), spearmanWithPerformance: rho ? round(rho.r, 3) : null };
}
