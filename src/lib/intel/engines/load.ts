/**
 * Load engine: the FRADY Physiological Load Index (PLI) and the rules built on it.
 *
 * PLI is a daily 0..100 composite, higher meaning more physiologically loaded, computed from the
 * morning's HRV and resting HR against their 30-day history, last night's sleep against need, recent
 * strain against the 4-week mean and the recovery trend. It is FRADY's own number: never live, not
 * WHOOP's Stress Monitor, and it says nothing about cortisol, emotions or psychological stress.
 */

import type { DerivedScore, EngineContext, Finding, MetricKey } from "../types";
import { correlationCI, mean, median, pearson, quantile, round, sd, trailingRun, valid } from "../stats";
import { series } from "../baselines";
import { finding, fmtMetric } from "../findings";

const ENGINE = "load" as const;
export const PLI_VERSION = "pli.v1";

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "load.elevated", label: "Elevated physiological load", description: "Physiological Load Index at or above 70 on the latest day." },
  { rule: "load.accumulation", label: "Multi-day load accumulation", description: "Physiological Load Index at or above 60 for several consecutive days." },
  { rule: "load.prolonged_low_recovery", label: "Prolonged low recovery", description: "Recovery below your personal 25th percentile on at least 5 of the last 7 days." },
  { rule: "load.after_intense_training", label: "Load after intense training", description: "High load within two days of a workout above your 75th percentile of workout strain." },
  { rule: "load.vs_sleep", label: "Load and sleep", description: "Association between the Physiological Load Index and total sleep." },
  { rule: "load.vs_hrv", label: "Load and HRV", description: "Association between the Physiological Load Index and HRV." },
  { rule: "load.vs_resting_hr", label: "Load and resting heart rate", description: "Association between the Physiological Load Index and resting heart rate." },
  { rule: "load.improvement_after_rest", label: "Improvement after rest", description: "Physiological Load Index fell by 15 points or more across a rest day." },
];

const MIN_CORR_N = 14;
const PLI_NOTE =
  "FRADY Physiological Load Index: a daily composite of your own morning HRV, resting heart rate, sleep against need, recent strain and recovery trend. Higher means more loaded. It is computed once a day from the strap's summaries, is not live, is not WHOOP's Stress Monitor, and makes no claim about cortisol, emotions or psychological stress.";

const clamp01 = (x: number) => Math.min(100, Math.max(0, x));

/** Standard z of x against the valid values of xs. Null without at least `minN` samples or spread. */
function zAgainst(x: number, xs: (number | null)[], minN: number): number | null {
  const v = valid(xs);
  if (v.length < minN) return null;
  const m = mean(v)!;
  const s = sd(v);
  if (s == null || s <= 0) return null;
  return (x - m) / s;
}

/**
 * Physiological Load Index for one day. `day` defaults to the last day in the context; the index is
 * null when fewer than two factors are available.
 */
export function physiologicalLoad(ctx: EngineContext, day?: string): DerivedScore {
  const idx = day == null ? ctx.days.length - 1 : ctx.days.findIndex((d) => d.day === day);
  const target = idx >= 0 ? ctx.days[idx] : null;
  const dayKey = target?.day ?? day ?? ctx.today;
  const factors: DerivedScore["factors"] = [];
  const priorWindow = (metric: MetricKey, n: number, endExclusive: number) => series(ctx.days.slice(0, Math.max(0, endExclusive)), metric, n);
  const row = target && target.scored ? target : null;

  // HRV deviation (30): z of the day against the previous 30 days; z -2 -> 100, z +1 -> 0.
  {
    const x = row?.hrv_rmssd ?? null;
    const z = x != null && idx >= 0 ? zAgainst(x, priorWindow("hrv_rmssd", 30, idx), 7) : null;
    const score = z == null ? null : clamp01(((1 - z) / 3) * 100);
    factors.push({ key: "hrv_deviation", label: "HRV versus 30-day baseline", weight: 30, score: round(score, 1), detail: z == null ? "Not enough HRV history." : `HRV ${fmtMetric("hrv_rmssd", x)} is ${round(z, 2)} SD from the 30-day mean.` });
  }
  // RHR deviation (25), inverse: z +2 -> 100, z -1 -> 0.
  {
    const x = row?.resting_hr ?? null;
    const z = x != null && idx >= 0 ? zAgainst(x, priorWindow("resting_hr", 30, idx), 7) : null;
    const score = z == null ? null : clamp01(((z + 1) / 3) * 100);
    factors.push({ key: "rhr_deviation", label: "Resting HR versus 30-day baseline", weight: 25, score: round(score, 1), detail: z == null ? "Not enough resting HR history." : `Resting HR ${fmtMetric("resting_hr", x)} is ${round(z, 2)} SD from the 30-day mean.` });
  }
  // Sleep deficiency (20): total against need (or the 30-day median); 100% -> 0, 70% -> 100.
  {
    const total = row?.sleep_total_min ?? null;
    const need = row?.sleep_need_min ?? (idx >= 0 ? median(priorWindow("sleep_total_min", 30, idx)) : null);
    const ratio = total != null && need != null && need > 0 ? total / need : null;
    const score = ratio == null ? null : clamp01(((1 - ratio) / 0.3) * 100);
    factors.push({
      key: "sleep_deficiency",
      label: "Sleep against need",
      weight: 20,
      score: round(score, 1),
      detail: ratio == null ? "No sleep total for the night." : `Slept ${fmtMetric("sleep_total_min", total)} against ${row?.sleep_need_min != null ? "a need of" : "a 30-day median of"} ${fmtMetric("sleep_total_min", need)} (${Math.round(ratio * 100)}%).`,
    });
  }
  // Recent strain (15): 3-day mean against the 28-day mean; ratio 0.7 -> 0, 1.5 -> 100.
  {
    const last3 = idx >= 0 ? series(ctx.days.slice(0, idx + 1), "day_strain", 3) : [];
    const last28 = idx >= 0 ? series(ctx.days.slice(0, idx + 1), "day_strain", 28) : [];
    const m3 = valid(last3).length >= 2 ? mean(last3) : null;
    const m28 = valid(last28).length >= 14 ? mean(last28) : null;
    const ratio = m3 != null && m28 != null && m28 > 0 ? m3 / m28 : null;
    const score = ratio == null ? null : clamp01(((ratio - 0.7) / 0.8) * 100);
    factors.push({ key: "recent_strain", label: "Recent strain against 4-week mean", weight: 15, score: round(score, 1), detail: ratio == null ? "Not enough strain history." : `Last 3 days averaged ${round(m3, 1)} strain against ${round(m28, 1)} over 28 days (ratio ${round(ratio, 2)}).` });
  }
  // Recovery trend (10): 7-day mean against 30-day mean; +10 -> 0, -15 -> 100.
  {
    const last7 = idx >= 0 ? series(ctx.days.slice(0, idx + 1), "recovery_score", 7) : [];
    const last30 = idx >= 0 ? series(ctx.days.slice(0, idx + 1), "recovery_score", 30) : [];
    const m7 = valid(last7).length >= 4 ? mean(last7) : null;
    const m30 = valid(last30).length >= 14 ? mean(last30) : null;
    const diff = m7 != null && m30 != null ? m7 - m30 : null;
    const score = diff == null ? null : clamp01(((10 - diff) / 25) * 100);
    factors.push({ key: "recovery_trend", label: "Recovery trend", weight: 10, score: round(score, 1), detail: diff == null ? "Not enough recovery history." : `7-day mean recovery ${round(m7, 0)}% against 30-day mean ${round(m30, 0)}% (${diff >= 0 ? "+" : ""}${round(diff, 1)}).` });
  }

  const present = factors.filter((f) => f.score != null);
  const totalWeight = present.reduce((a, f) => a + f.weight, 0);
  const value = present.length >= 2 ? present.reduce((a, f) => a + f.weight * f.score!, 0) / totalWeight : null;
  return {
    key: "physiological_load",
    day: dayKey,
    value: round(value, 1),
    version: PLI_VERSION,
    factors,
    completeness: round(totalWeight / 100, 2) ?? 0,
    note: PLI_NOTE,
  };
}

/** Index per day over the trailing `n` days, aligned with `tail(ctx.days, n)`. */
export function loadSeries(ctx: EngineContext, n = 90): { day: string; value: number | null }[] {
  const start = Math.max(0, ctx.days.length - n);
  const out: { day: string; value: number | null }[] = [];
  for (let i = start; i < ctx.days.length; i++) out.push({ day: ctx.days[i].day, value: physiologicalLoad(ctx, ctx.days[i].day).value });
  return out;
}

function corrFinding(rule: string, metric: MetricKey, title: string, xs: (number | null)[], ys: (number | null)[], day: string, describe: (r: number) => string): Finding | null {
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
    method: "Pearson correlation between the daily Physiological Load Index and the metric over the last 90 days",
    completeness: p.n / 90,
    explanation: `${describe(p.r)} Across ${p.n} days r = ${round(p.r, 2)} (95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)}). The index is built partly from these inputs, so some association is expected by construction; the strength is what is informative.`,
    nextStep: "Use it to see which input moves your load most; it is an association, not a cause.",
    evidence: { n: p.n, r: round(p.r, 3), ci: [round(ci[0], 3), round(ci[1], 3)], period: 90, lag: 0 },
  });
}

export function loadEngine(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const on = (rule: string) => !ctx.settings.disabled.has(rule);
  const { persistDays } = ctx.settings;
  const pli = loadSeries(ctx, 90);
  const values = pli.map((p) => p.value);
  const rows = ctx.days.slice(Math.max(0, ctx.days.length - 90));
  // Latest day with an index value.
  let lastIdx = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return out;
  const latest = values[lastIdx]!;
  const latestDay = pli[lastIdx].day;
  const scoreToday = physiologicalLoad(ctx, latestDay);
  const factorText = scoreToday.factors
    .filter((f) => f.score != null)
    .sort((a, b) => b.score! * b.weight - a.score! * a.weight)
    .slice(0, 2)
    .map((f) => `${f.label.toLowerCase()} (${f.score})`)
    .join(" and ");

  // 101 elevated load.
  if (on("load.elevated") && latest >= 70) {
    out.push(
      finding({
        rule: "load.elevated",
        engine: ENGINE,
        kind: "deviation",
        metric: null,
        day: latestDay,
        severity: latest >= 85 ? "high" : "moderate",
        title: `Physiological load elevated at ${Math.round(latest)}`,
        value: latest,
        baseline: mean(values.slice(0, lastIdx)),
        method: "FRADY Physiological Load Index at or above 70",
        completeness: scoreToday.completeness,
        explanation: `The index is ${Math.round(latest)} out of 100, driven mostly by ${factorText}. It summarises how far this morning's measures sit from your own recent history.`,
        nextStep: "An easier day and an earlier night are the usual levers. The index is a load summary, not a stress or mood measure.",
        evidence: { factors: scoreToday.factors, version: PLI_VERSION },
      }),
    );
  }

  // 102 multi-day accumulation.
  if (on("load.accumulation")) {
    const run = trailingRun(values.slice(0, lastIdx + 1), (x) => x >= 60);
    if (run >= persistDays) {
      out.push(
        finding({
          rule: "load.accumulation",
          engine: ENGINE,
          kind: "pattern",
          metric: null,
          day: latestDay,
          severity: run >= persistDays * 2 ? "high" : "moderate",
          title: `Physiological load at or above 60 for ${run} days`,
          value: mean(values.slice(lastIdx + 1 - run, lastIdx + 1)),
          baseline: 60,
          method: `Consecutive days with the Physiological Load Index at or above 60 (${persistDays}+ days)`,
          completeness: run / Math.max(run, persistDays),
          explanation: `The index has stayed at or above 60 for ${run} consecutive days, the latest at ${Math.round(latest)}. Load that does not clear overnight tends to accumulate.`,
          nextStep: "Several easier days in a row usually bring the index down faster than one. Watch recovery and HRV for the turn.",
          evidence: { run, values: values.slice(lastIdx + 1 - run, lastIdx + 1) },
        }),
      );
    }
  }

  // 103 prolonged low recovery: below personal p25 on 5+ of the last 7 days.
  const rec = ctx.baselines.recovery_score;
  if (on("load.prolonged_low_recovery") && rec.ready && rec.p25 != null) {
    const last7 = series(ctx.days, "recovery_score", 7);
    const low = valid(last7).filter((v) => v < rec.p25!).length;
    if (valid(last7).length >= 5 && low >= 5) {
      out.push(
        finding({
          rule: "load.prolonged_low_recovery",
          engine: ENGINE,
          kind: "pattern",
          metric: "recovery_score",
          day: rec.lastDay ?? ctx.today,
          severity: low === 7 ? "high" : "moderate",
          title: `Recovery below your usual on ${low} of the last 7 days`,
          value: mean(last7),
          baseline: rec.p25,
          method: "Days in the last 7 with recovery below the personal 90-day 25th percentile (5+ days)",
          completeness: valid(last7).length / 7,
          explanation: `Recovery sat below ${fmtMetric("recovery_score", rec.p25)}, your lower quartile, on ${low} of the last 7 mornings, averaging ${fmtMetric("recovery_score", mean(last7))}.`,
          nextStep: "A week of low readings points to accumulated load, short sleep or something brewing. If it continues with other changes, see the clinician note on related findings.",
          evidence: { lowDays: low, p25: round(rec.p25, 1) },
        }),
      );
    }
  }

  // 104 load after intense training: high index within two days of a workout above the p75 of workout strain.
  if (on("load.after_intense_training") && latest >= 60) {
    const ws90 = series(ctx.days, "workout_strain", 90);
    const p75 = valid(ws90).length >= 7 ? quantile(ws90, 0.75) : null;
    if (p75 != null) {
      const rowIdx = ctx.days.findIndex((d) => d.day === latestDay);
      const hard = [1, 2]
        .map((back) => ctx.days[rowIdx - back])
        .filter((d) => d && d.scored && d.workout_strain != null && d.workout_strain > p75);
      if (hard.length) {
        const h = hard[0];
        out.push(
          finding({
            rule: "load.after_intense_training",
            engine: ENGINE,
            kind: "pattern",
            metric: "workout_strain",
            day: latestDay,
            severity: "low",
            title: "Load is high in the days after a hard session",
            value: latest,
            baseline: 60,
            method: "Physiological Load Index at or above 60 within 2 days of a workout above the personal 75th percentile of workout strain",
            completeness: scoreToday.completeness,
            explanation: `Workout strain of ${fmtMetric("workout_strain", h.workout_strain)} on ${h.day} is above your usual upper quarter (${fmtMetric("workout_strain", p75)}), and the index now reads ${Math.round(latest)}. This is the expected shape of recovery from a hard session.`,
            nextStep: "Give it a day or two of easier work; the index should fall back as the session is absorbed.",
            evidence: { hardDay: h.day, workoutStrain: h.workout_strain, p75: round(p75, 2), index: latest },
          }),
        );
      }
    }
  }

  // 105 to 107 associations between the daily index and its inputs.
  const alignedSeries = (metric: MetricKey) => rows.map((d) => (d.scored ? d[metric] : null));
  if (on("load.vs_sleep")) {
    const f = corrFinding("load.vs_sleep", "sleep_total_min", "Load and sleep move together", values, alignedSeries("sleep_total_min"), latestDay, (r) => (r < 0 ? "Shorter nights tend to come with a higher load index." : "Longer nights tend to come with a higher load index."));
    if (f) out.push(f);
  }
  if (on("load.vs_hrv")) {
    const f = corrFinding("load.vs_hrv", "hrv_rmssd", "Load and HRV move together", values, alignedSeries("hrv_rmssd"), latestDay, (r) => (r < 0 ? "Lower HRV mornings tend to come with a higher load index." : "Higher HRV mornings tend to come with a higher load index."));
    if (f) out.push(f);
  }
  if (on("load.vs_resting_hr")) {
    const f = corrFinding("load.vs_resting_hr", "resting_hr", "Load and resting heart rate move together", values, alignedSeries("resting_hr"), latestDay, (r) => (r > 0 ? "Higher resting heart rate mornings tend to come with a higher load index." : "Lower resting heart rate mornings tend to come with a higher load index."));
    if (f) out.push(f);
  }

  // 108 improvement after rest: index drops 15+ points from the day before a rest day to the day after it.
  if (on("load.improvement_after_rest")) {
    for (let i = rows.length - 2; i >= Math.max(1, rows.length - 8); i--) {
      const d = rows[i];
      if (!d.scored || d.workout_count !== 0) continue;
      const before = values[i - 1];
      const after = values[i + 1];
      if (before == null || after == null) continue;
      const drop = before - after;
      if (drop >= 15) {
        out.push(
          finding({
            rule: "load.improvement_after_rest",
            engine: ENGINE,
            kind: "pattern",
            metric: null,
            day: rows[i + 1].day,
            severity: "info",
            title: `Load fell ${Math.round(drop)} points across a rest day`,
            value: after,
            baseline: before,
            method: "Physiological Load Index the day before a rest day against the day after it (15 point drop)",
            completeness: 1,
            explanation: `The index read ${Math.round(before)} on ${rows[i - 1].day}, you logged no workout on ${d.day}, and it read ${Math.round(after)} on ${rows[i + 1].day}. Rest cleared load quickly.`,
            nextStep: "Worth remembering when the index climbs again: a single rest day moved it materially.",
            evidence: { restDay: d.day, before, after, drop: round(drop, 1) },
          }),
        );
        break;
      }
    }
  }

  return out;
}
