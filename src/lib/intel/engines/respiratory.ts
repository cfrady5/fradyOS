/**
 * Respiratory engine: overnight respiratory rate and blood oxygen from the strap's nightly summaries.
 *
 * Every rule reads a nightly reading or its personal history. Nothing here counts breathing events or
 * estimates an apnoea index; the strap does not report them and this layer never invents them.
 */

import type { EngineContext, Finding, MetricKey, Severity } from "../types";
import { changePoint, correlationCI, mean, pearson, round, sd, tail, trailingRun, valid } from "../stats";
import { series } from "../baselines";
import { CLINICIAN_NOTE, completenessOf, deviation, finding, fmtMetric, severityFromZ } from "../findings";

const ENGINE = "respiratory" as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "respiratory.resp_rate_status", label: "Overnight respiratory rate", description: "The latest overnight respiratory rate against your 90-day median." },
  { rule: "respiratory.resp_rate_baseline", label: "Respiratory baseline", description: "Your personal respiratory rate baseline and whether it is ready for alerts." },
  { rule: "respiratory.resp_rate_elevated", label: "Respiratory rate elevated", description: "Overnight respiratory rate well above your own baseline, or above your upper quartile for several nights." },
  { rule: "respiratory.resp_rate_variability", label: "Respiratory rate variation", description: "Night-to-night variation this week compared with your 90-day spread." },
  { rule: "respiratory.resp_rate_trend_change", label: "Respiratory rate trend change", description: "A sustained shift in overnight respiratory rate over recent weeks." },
  { rule: "respiratory.spo2_status", label: "Overnight blood oxygen", description: "The latest overnight SpO2 against your 90-day median." },
  { rule: "respiratory.spo2_low", label: "Blood oxygen below baseline", description: "Overnight SpO2 well below your own baseline." },
  { rule: "respiratory.spo2_trend", label: "Unusual oxygen trend", description: "Several nights of SpO2 below your median, or a downward slope." },
  { rule: "respiratory.resp_rate_vs_recovery", label: "Respiratory rate and recovery", description: "Association between overnight respiratory rate and recovery score." },
  { rule: "respiratory.resp_rate_vs_sleep", label: "Respiratory rate and sleep", description: "Association between overnight respiratory rate and total sleep." },
  { rule: "respiratory.resp_rate_vs_prior_strain", label: "Respiratory rate and previous-day strain", description: "Association between overnight respiratory rate and the previous day's strain." },
  { rule: "respiratory.spo2_safety", label: "Low SpO2 reading", description: "Fixed threshold: overnight SpO2 below 90% on the latest night." },
  { rule: "respiratory.resp_rate_safety", label: "Respiratory rate outside the usual range", description: "Fixed threshold: overnight respiratory rate above 24 or below 8 breaths per minute." },
];

const SPO2_SAFETY_FLOOR = 90;
const RESP_SAFETY_HIGH = 24;
const RESP_SAFETY_LOW = 8;
const MIN_CORR_N = 14;

function corrFinding(
  ctx: EngineContext,
  rule: string,
  metric: MetricKey,
  title: string,
  xs: (number | null)[],
  ys: (number | null)[],
  day: string,
  describe: (r: number) => string,
  lag = 0,
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
    nextStep: "Treat it as a pattern worth watching. If it matters to you, log the behaviours around it so the association can be checked over time.",
    evidence: { n: p.n, r: round(p.r, 3), ci: [round(ci[0], 3), round(ci[1], 3)], period: 90, lag },
  });
}

export function respiratoryEngine(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const on = (rule: string) => !ctx.settings.disabled.has(rule);
  const { zModerate, persistDays } = ctx.settings;
  const resp = ctx.baselines.resp_rate;
  const spo2 = ctx.baselines.spo2;
  const resp90 = series(ctx.days, "resp_rate", 90);

  // Fixed safety thresholds: independent of baseline readiness, a reading rather than a diagnosis.
  if (on("respiratory.spo2_safety") && spo2.last != null && spo2.lastDay != null && spo2.last < SPO2_SAFETY_FLOOR) {
    out.push(
      finding({
        rule: "respiratory.spo2_safety",
        engine: ENGINE,
        kind: "deviation",
        metric: "spo2",
        day: spo2.lastDay,
        severity: "moderate",
        title: "Overnight blood oxygen reading below 90%",
        value: spo2.last,
        baseline: spo2.median90,
        method: `Fixed threshold: latest overnight SpO2 below ${SPO2_SAFETY_FLOOR}%`,
        completeness: 1,
        explanation: `The strap reported an average overnight SpO2 of ${fmtMetric("spo2", spo2.last)} on ${spo2.lastDay}. Wrist sensors can read low with poor fit or cold hands, so this is a reading to note, not a diagnosis.`,
        nextStep: `Check strap fit tonight and compare the next reading. ${CLINICIAN_NOTE}`,
      }),
    );
  }
  if (on("respiratory.resp_rate_safety") && resp.last != null && resp.lastDay != null && (resp.last > RESP_SAFETY_HIGH || resp.last < RESP_SAFETY_LOW)) {
    const high = resp.last > RESP_SAFETY_HIGH;
    out.push(
      finding({
        rule: "respiratory.resp_rate_safety",
        engine: ENGINE,
        kind: "deviation",
        metric: "resp_rate",
        day: resp.lastDay,
        severity: "moderate",
        title: high ? "Overnight respiratory rate above 24" : "Overnight respiratory rate below 8",
        value: resp.last,
        baseline: resp.median90,
        method: `Fixed threshold: overnight respiratory rate ${high ? `above ${RESP_SAFETY_HIGH}` : `below ${RESP_SAFETY_LOW}`} br/min`,
        completeness: 1,
        explanation: `The strap reported an average overnight respiratory rate of ${fmtMetric("resp_rate", resp.last)} on ${resp.lastDay}, outside the range most adults sleep in. This is a single overnight average, not a diagnosis.`,
        nextStep: `Note how you feel and compare the next night. ${CLINICIAN_NOTE}`,
      }),
    );
  }

  // 61 overnight respiratory rate status.
  if (on("respiratory.resp_rate_status") && resp.last != null && resp.lastDay != null) {
    out.push(
      finding({
        rule: "respiratory.resp_rate_status",
        engine: ENGINE,
        kind: "status",
        metric: "resp_rate",
        day: resp.lastDay,
        severity: "info",
        title: "Overnight respiratory rate",
        value: resp.last,
        baseline: resp.median90,
        method: "Latest overnight average against the 90-day median",
        completeness: completenessOf(ctx.days, "resp_rate", 7),
        explanation:
          resp.median90 != null && resp.n > 1
            ? `Last night averaged ${fmtMetric("resp_rate", resp.last)} against your 90-day median of ${fmtMetric("resp_rate", resp.median90)}${resp.percentile != null ? ` (percentile ${Math.round(resp.percentile)})` : ""}.`
            : `Last night averaged ${fmtMetric("resp_rate", resp.last)}. More nights are needed before a personal comparison is possible.`,
        nextStep: "Respiratory rate during sleep is usually steady for one person. Watch for sustained change rather than one night.",
      }),
    );
  }

  // 62 personal baseline status.
  if (on("respiratory.resp_rate_baseline") && resp.n > 0) {
    const remaining = Math.max(0, 14 - resp.n);
    out.push(
      finding({
        rule: "respiratory.resp_rate_baseline",
        engine: ENGINE,
        kind: "status",
        metric: "resp_rate",
        day: resp.asOf,
        severity: "info",
        title: resp.ready ? "Respiratory baseline ready" : "Respiratory baseline building",
        value: resp.median90,
        method: "90-day median with interquartile range from scored nights",
        completeness: resp.n / 90,
        explanation: resp.ready
          ? `Your overnight respiratory rate centres on ${fmtMetric("resp_rate", resp.median90)} (middle half ${fmtMetric("resp_rate", resp.p25)} to ${fmtMetric("resp_rate", resp.p75)}) across ${resp.n} nights.`
          : `${resp.n} night${resp.n === 1 ? "" : "s"} recorded so far; ${remaining} more ${remaining === 1 ? "is" : "are"} needed before personal alerts switch on.`,
        nextStep: resp.ready ? "Personal deviation alerts are active for this metric." : "Keep wearing the strap overnight; fixed safety thresholds still apply meanwhile.",
        evidence: { n: resp.n, median90: round(resp.median90, 2), p25: round(resp.p25, 2), p75: round(resp.p75, 2), ready: resp.ready },
      }),
    );
  }

  // 63 elevation: robust z above threshold, or above p75 for persistDays nights.
  if (on("respiratory.resp_rate_elevated") && resp.ready) {
    const dev = deviation(ctx.days, "resp_rate", resp);
    const run = resp.p75 != null ? trailingRun(resp90, (x) => x > resp.p75!) : 0;
    const byZ = dev != null && dev.z >= zModerate;
    const byRun = run >= persistDays;
    if (byZ || byRun) {
      const sev: Severity = byZ ? severityFromZ(dev!.z, zModerate) : "low";
      out.push(
        finding({
          rule: "respiratory.resp_rate_elevated",
          engine: ENGINE,
          kind: "deviation",
          metric: "resp_rate",
          day: resp.lastDay ?? ctx.today,
          severity: sev,
          title: byZ ? "Overnight respiratory rate above your baseline" : `Respiratory rate above your upper quartile for ${run} nights`,
          value: resp.last,
          baseline: resp.median90,
          method: byZ ? `Robust z of the latest night against the 90-day history (threshold ${zModerate})` : `Trailing run above the personal 75th percentile (${persistDays}+ nights)`,
          completeness: completenessOf(ctx.days, "resp_rate", persistDays),
          explanation: byZ
            ? `Last night averaged ${fmtMetric("resp_rate", resp.last)}, ${round(dev!.z, 1)} MAD units above your median of ${fmtMetric("resp_rate", resp.median90)}.`
            : `The last ${run} nights all sat above your usual upper quarter (${fmtMetric("resp_rate", resp.p75)}), with the latest at ${fmtMetric("resp_rate", resp.last)}.`,
          nextStep: `A raised overnight breathing rate often accompanies a hard day, alcohol, heat or the start of a cold. ${CLINICIAN_NOTE}`,
          evidence: { z: dev ? round(dev.z, 2) : null, run, p75: round(resp.p75, 2) },
        }),
      );
    }
  }

  // 64 variation: 7-day SD against 90-day SD.
  if (on("respiratory.resp_rate_variability") && resp.ready && resp.sd90 != null && resp.sd90 > 0) {
    const last7 = series(ctx.days, "resp_rate", 7);
    const sd7 = sd(last7);
    if (sd7 != null && valid(last7).length >= 5) {
      const ratio = sd7 / resp.sd90;
      if (ratio >= 1.5) {
        out.push(
          finding({
            rule: "respiratory.resp_rate_variability",
            engine: ENGINE,
            kind: "pattern",
            metric: "resp_rate",
            day: resp.lastDay ?? ctx.today,
            severity: ratio >= 2 ? "moderate" : "low",
            title: "Respiratory rate varying more than usual",
            value: sd7,
            baseline: resp.sd90,
            method: "7-day standard deviation against the 90-day standard deviation",
            completeness: valid(last7).length / 7,
            explanation: `Night-to-night spread this week is ${round(sd7, 2)} br/min against your usual ${round(resp.sd90, 2)} (${round(ratio, 1)}x). Values are still within a plausible range; the change is in how much they move.`,
            nextStep: "Irregular bedtimes, alcohol and travel widen this spread. If it continues alongside other changes, see the clinician note on related findings.",
            evidence: { sd7: round(sd7, 3), sd90: round(resp.sd90, 3), ratio: round(ratio, 2) },
          }),
        );
      }
    }
  }

  // 65 multi-day trend change: CUSUM change point in the last 30 days, or a 30-day slope.
  if (on("respiratory.resp_rate_trend_change") && resp.ready) {
    const cp = changePoint(resp90);
    const recentCp = cp != null && cp.index >= resp90.length - 30;
    const slopeShift = resp.slope30 != null ? resp.slope30 * 30 : null;
    const bySlope = slopeShift != null && Math.abs(slopeShift) >= 1 && valid(series(ctx.days, "resp_rate", 30)).length >= 20;
    if (recentCp || bySlope) {
      const dir = recentCp ? cp!.direction : slopeShift! > 0 ? "up" : "down";
      const after = recentCp ? mean(resp90.slice(cp!.index + 1)) : resp.mean7;
      out.push(
        finding({
          rule: "respiratory.resp_rate_trend_change",
          engine: ENGINE,
          kind: "trend",
          metric: "resp_rate",
          day: resp.lastDay ?? ctx.today,
          severity: "low",
          title: `Overnight respiratory rate has shifted ${dir}`,
          value: after,
          baseline: resp.median90,
          method: recentCp ? "CUSUM change point on the 90-day series" : "Ordinary least-squares slope over 30 days",
          completeness: completenessOf(ctx.days, "resp_rate", 30),
          explanation: recentCp
            ? `A level shift ${cp!.direction} of about ${round(cp!.magnitude, 1)} MAD units began around ${ctx.days[Math.max(0, ctx.days.length - resp90.length + cp!.index)]?.day ?? "recently"}; nights since then average ${fmtMetric("resp_rate", after)}.`
            : `The 30-day slope works out to ${round(slopeShift, 1)} br/min over the month, against a 90-day median of ${fmtMetric("resp_rate", resp.median90)}.`,
          nextStep: "A sustained change in overnight breathing rate is worth noting alongside sleep, training and how you feel. It is a trend in your own data, not a diagnosis.",
          evidence: { changePoint: cp ? { index: cp.index, direction: cp.direction, magnitude: round(cp.magnitude, 2) } : null, slope30: round(resp.slope30, 4) },
        }),
      );
    }
  }

  // 66 SpO2 status.
  if (on("respiratory.spo2_status") && spo2.last != null && spo2.lastDay != null) {
    out.push(
      finding({
        rule: "respiratory.spo2_status",
        engine: ENGINE,
        kind: "status",
        metric: "spo2",
        day: spo2.lastDay,
        severity: "info",
        title: "Overnight blood oxygen",
        value: spo2.last,
        baseline: spo2.median90,
        method: "Latest overnight average against the 90-day median",
        completeness: completenessOf(ctx.days, "spo2", 7),
        explanation:
          spo2.median90 != null && spo2.n > 1
            ? `Last night averaged ${fmtMetric("spo2", spo2.last)} against your 90-day median of ${fmtMetric("spo2", spo2.median90)}.`
            : `Last night averaged ${fmtMetric("spo2", spo2.last)}. More nights are needed before a personal comparison is possible.`,
        nextStep: "Overnight SpO2 from a wrist sensor is an average with some noise. Trends over several nights matter more than one reading.",
      }),
    );
  }

  // 67 SpO2 deviation below baseline.
  if (on("respiratory.spo2_low") && spo2.ready) {
    const dev = deviation(ctx.days, "spo2", spo2);
    if (dev && dev.z <= -zModerate) {
      out.push(
        finding({
          rule: "respiratory.spo2_low",
          engine: ENGINE,
          kind: "deviation",
          metric: "spo2",
          day: dev.day,
          severity: severityFromZ(Math.abs(dev.z), zModerate),
          title: "Overnight blood oxygen below your baseline",
          value: dev.value,
          baseline: spo2.median90,
          method: `Robust z of the latest night against the 90-day history (threshold ${zModerate})`,
          completeness: completenessOf(ctx.days, "spo2", 7),
          explanation: `Last night averaged ${fmtMetric("spo2", dev.value)}, ${round(Math.abs(dev.z), 1)} MAD units below your median of ${fmtMetric("spo2", spo2.median90)}.`,
          nextStep: `Altitude, alcohol, congestion and strap fit all lower overnight readings. ${CLINICIAN_NOTE}`,
          evidence: { z: round(dev.z, 2) },
        }),
      );
    }
  }

  // 68 unusual oxygen trend: 3-night mean well below the median, or a downward slope.
  if (on("respiratory.spo2_trend") && spo2.ready && spo2.median90 != null) {
    const last3 = series(ctx.days, "spo2", 3);
    const m3 = valid(last3).length >= 2 ? mean(last3) : null;
    const slope30 = spo2.slope30 != null ? spo2.slope30 * 30 : null;
    const byMean = m3 != null && spo2.median90 - m3 >= 1.5;
    const bySlope = slope30 != null && slope30 <= -1 && valid(series(ctx.days, "spo2", 30)).length >= 20;
    if (byMean || bySlope) {
      out.push(
        finding({
          rule: "respiratory.spo2_trend",
          engine: ENGINE,
          kind: "trend",
          metric: "spo2",
          day: spo2.lastDay ?? ctx.today,
          severity: byMean && spo2.median90 - m3! >= 2.5 ? "moderate" : "low",
          title: "Overnight blood oxygen trending below your usual",
          value: byMean ? m3 : spo2.mean7,
          baseline: spo2.median90,
          method: byMean ? "Mean of the last 3 nights against the 90-day median (1.5 point threshold)" : "Ordinary least-squares slope over 30 days",
          completeness: completenessOf(ctx.days, "spo2", byMean ? 3 : 30),
          explanation: byMean
            ? `The last three nights averaged ${fmtMetric("spo2", m3)}, ${round(spo2.median90 - m3!, 1)} points below your median of ${fmtMetric("spo2", spo2.median90)}.`
            : `Overnight SpO2 has drifted about ${round(Math.abs(slope30!), 1)} points lower over the past 30 days.`,
          nextStep: `Several lower nights in a row are more informative than one. ${CLINICIAN_NOTE}`,
          evidence: { mean3: round(m3, 2), slope30: round(spo2.slope30, 4) },
        }),
      );
    }
  }

  // 69 to 71 associations.
  const day = resp.lastDay ?? ctx.today;
  if (on("respiratory.resp_rate_vs_recovery") && resp.ready) {
    const f = corrFinding(ctx, "respiratory.resp_rate_vs_recovery", "resp_rate", "Respiratory rate and recovery move together", resp90, series(ctx.days, "recovery_score", 90), day, (r) =>
      r < 0 ? "Nights with a higher breathing rate tend to come with a lower recovery score." : "Nights with a higher breathing rate tend to come with a higher recovery score.",
    );
    if (f) out.push(f);
  }
  if (on("respiratory.resp_rate_vs_sleep") && resp.ready) {
    const f = corrFinding(ctx, "respiratory.resp_rate_vs_sleep", "resp_rate", "Respiratory rate and sleep duration move together", resp90, series(ctx.days, "sleep_total_min", 90), day, (r) =>
      r < 0 ? "Nights with a higher breathing rate tend to be shorter." : "Nights with a higher breathing rate tend to be longer.",
    );
    if (f) out.push(f);
  }
  if (on("respiratory.resp_rate_vs_prior_strain") && resp.ready) {
    const strain = series(ctx.days, "day_strain", 91);
    const respLag = series(ctx.days, "resp_rate", 91);
    // Pair the night on day t with the strain on day t-1.
    const xs = tail(strain.slice(0, -1), 90);
    const ys = tail(respLag.slice(1), 90);
    const f = corrFinding(ctx, "respiratory.resp_rate_vs_prior_strain", "resp_rate", "Respiratory rate follows the previous day's strain", xs, ys, day, (r) =>
      r > 0 ? "Harder days tend to be followed by a higher overnight breathing rate." : "Harder days tend to be followed by a lower overnight breathing rate.", 1);
    if (f) out.push(f);
  }

  return out;
}
