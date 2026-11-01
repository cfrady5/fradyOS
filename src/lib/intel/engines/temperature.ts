/**
 * Temperature engine: overnight skin temperature from the strap's nightly summaries, plus a small
 * cross-metric deviation panel (skin temperature, resting HR, HRV, respiratory rate) for the dashboard.
 *
 * Skin temperature is not core temperature. Deviations are reported against the person's own history;
 * nothing here confirms infection or illness.
 */

import type { EngineContext, Finding, MetricKey } from "../types";
import { changePoint, correlationCI, mean, pearson, round, sd, trailingRun, valid } from "../stats";
import { series } from "../baselines";
import { CLINICIAN_NOTE, completenessOf, deviation, finding, fmtMetric, severityFromZ } from "../findings";

const ENGINE = "temperature" as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: "temperature.skin_temp_status", label: "Overnight skin temperature", description: "The latest overnight skin temperature against your 90-day median." },
  { rule: "temperature.skin_temp_baseline", label: "Skin temperature baseline", description: "Your personal skin temperature baseline and whether it is ready for alerts." },
  { rule: "temperature.skin_temp_deviation", label: "Skin temperature deviation", description: "Overnight skin temperature well above or below your own baseline." },
  { rule: "temperature.skin_temp_elevated_run", label: "Consecutive elevated readings", description: "Several nights in a row at least 0.3 °C above your median." },
  { rule: "temperature.skin_temp_reduced_run", label: "Consecutive reduced readings", description: "Several nights in a row at least 0.3 °C below your median." },
  { rule: "temperature.skin_temp_variability", label: "Skin temperature variability", description: "Night-to-night variation this week compared with your 90-day spread." },
  { rule: "temperature.skin_temp_vs_resting_hr", label: "Skin temperature and resting heart rate", description: "Association between overnight skin temperature and resting heart rate." },
  { rule: "temperature.skin_temp_vs_hrv", label: "Skin temperature and HRV", description: "Association between overnight skin temperature and HRV." },
  { rule: "temperature.skin_temp_vs_recovery", label: "Skin temperature and recovery", description: "Association between overnight skin temperature and recovery score." },
  { rule: "temperature.skin_temp_trend_change", label: "Skin temperature trend change", description: "A sustained shift in overnight skin temperature over recent weeks." },
  { rule: "temperature.multi_metric_deviation", label: "Several overnight measures deviate together", description: "At least two of skin temperature, resting HR, HRV and respiratory rate deviate in the same physiological direction." },
];

const RUN_DELTA_C = 0.3;
const MIN_CORR_N = 14;
const PANEL_METRICS: MetricKey[] = ["skin_temp", "resting_hr", "hrv_rmssd", "resp_rate"];

export interface DeviationPanelRow {
  metric: MetricKey;
  value: number | null;
  baseline: number | null;
  z: number | null;
  direction: "up" | "down" | "flat" | null;
  ready: boolean;
}

/** Latest-night deviation for the four overnight measures the dashboard shows side by side. */
export function deviationPanel(ctx: EngineContext): DeviationPanelRow[] {
  return PANEL_METRICS.map((metric) => {
    const b = ctx.baselines[metric];
    const dev = deviation(ctx.days, metric, b);
    const z = dev ? dev.z : null;
    return {
      metric,
      value: b.last,
      baseline: b.median90,
      z: z == null ? null : round(z, 2),
      direction: z == null ? null : z >= 0.5 ? "up" : z <= -0.5 ? "down" : "flat",
      ready: b.ready,
    };
  });
}

function corrFinding(
  rule: string,
  title: string,
  xs: (number | null)[],
  ys: (number | null)[],
  day: string,
  describe: (r: number) => string,
): Finding | null {
  const p = pearson(xs, ys);
  if (!p || p.n < MIN_CORR_N) return null;
  const ci = correlationCI(p.r, p.n) ?? (Math.abs(p.r) >= 1 ? ([p.r, p.r] as [number, number]) : null);
  if (!ci || Math.abs(p.r) < 0.3 || (ci[0] < 0 && ci[1] > 0)) return null;
  return finding({
    rule,
    engine: ENGINE,
    kind: "correlation",
    metric: "skin_temp",
    day,
    severity: "info",
    title,
    value: p.r,
    method: "Pearson correlation over the last 90 days",
    completeness: p.n / 90,
    explanation: `${describe(p.r)} Across ${p.n} paired nights r = ${round(p.r, 2)} (95% CI ${round(ci[0], 2)} to ${round(ci[1], 2)}). This is an association in your own data, not a cause.`,
    nextStep: "Treat it as a pattern worth watching rather than a rule.",
    evidence: { n: p.n, r: round(p.r, 3), ci: [round(ci[0], 3), round(ci[1], 3)], period: 90, lag: 0 },
  });
}

export function temperatureEngine(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const on = (rule: string) => !ctx.settings.disabled.has(rule);
  const { zModerate, persistDays } = ctx.settings;
  const temp = ctx.baselines.skin_temp;
  const temp90 = series(ctx.days, "skin_temp", 90);
  const day = temp.lastDay ?? ctx.today;

  // 72 status.
  if (on("temperature.skin_temp_status") && temp.last != null && temp.lastDay != null) {
    out.push(
      finding({
        rule: "temperature.skin_temp_status",
        engine: ENGINE,
        kind: "status",
        metric: "skin_temp",
        day: temp.lastDay,
        severity: "info",
        title: "Overnight skin temperature",
        value: temp.last,
        baseline: temp.median90,
        method: "Latest overnight average against the 90-day median",
        completeness: completenessOf(ctx.days, "skin_temp", 7),
        explanation:
          temp.median90 != null && temp.n > 1
            ? `Last night averaged ${fmtMetric("skin_temp", temp.last)} against your 90-day median of ${fmtMetric("skin_temp", temp.median90)} (${temp.last - temp.median90 >= 0 ? "+" : ""}${round(temp.last - temp.median90, 2)} °C).`
            : `Last night averaged ${fmtMetric("skin_temp", temp.last)}. More nights are needed before a personal comparison is possible.`,
        nextStep: "Skin temperature is affected by room temperature, bedding and the menstrual cycle as well as the body. Compare against your own nights, not a population number.",
      }),
    );
  }

  // 73 baseline status.
  if (on("temperature.skin_temp_baseline") && temp.n > 0) {
    const remaining = Math.max(0, 14 - temp.n);
    out.push(
      finding({
        rule: "temperature.skin_temp_baseline",
        engine: ENGINE,
        kind: "status",
        metric: "skin_temp",
        day: temp.asOf,
        severity: "info",
        title: temp.ready ? "Skin temperature baseline ready" : "Skin temperature baseline building",
        value: temp.median90,
        method: "90-day median with interquartile range from scored nights",
        completeness: temp.n / 90,
        explanation: temp.ready
          ? `Your overnight skin temperature centres on ${fmtMetric("skin_temp", temp.median90)} (middle half ${fmtMetric("skin_temp", temp.p25)} to ${fmtMetric("skin_temp", temp.p75)}) across ${temp.n} nights.`
          : `${temp.n} night${temp.n === 1 ? "" : "s"} recorded so far; ${remaining} more ${remaining === 1 ? "is" : "are"} needed before personal alerts switch on.`,
        nextStep: temp.ready ? "Personal deviation alerts are active for this metric." : "Keep wearing the strap overnight to build the baseline.",
        evidence: { n: temp.n, median90: round(temp.median90, 3), p25: round(temp.p25, 3), p75: round(temp.p75, 3), ready: temp.ready },
      }),
    );
  }

  // 74 deviation in either direction.
  if (on("temperature.skin_temp_deviation") && temp.ready) {
    const dev = deviation(ctx.days, "skin_temp", temp);
    if (dev && Math.abs(dev.z) >= zModerate) {
      const up = dev.z > 0;
      out.push(
        finding({
          rule: "temperature.skin_temp_deviation",
          engine: ENGINE,
          kind: "deviation",
          metric: "skin_temp",
          day: dev.day,
          severity: severityFromZ(Math.abs(dev.z), zModerate),
          title: up ? "Overnight skin temperature above your baseline" : "Overnight skin temperature below your baseline",
          value: dev.value,
          baseline: temp.median90,
          method: `Robust z of the latest night against the 90-day history (threshold ${zModerate})`,
          completeness: completenessOf(ctx.days, "skin_temp", 7),
          explanation: `Last night averaged ${fmtMetric("skin_temp", dev.value)}, ${round(Math.abs(dev.z), 1)} MAD units ${up ? "above" : "below"} your median of ${fmtMetric("skin_temp", temp.median90)} (${up ? "+" : ""}${round(dev.delta, 2)} °C).`,
          nextStep: `A warm room, late alcohol, a hard session or the start of a cold can all move this by a few tenths. ${CLINICIAN_NOTE}`,
          evidence: { z: round(dev.z, 2) },
        }),
      );
    }
  }

  // 75 and 76 consecutive runs relative to the median.
  if (temp.ready && temp.median90 != null) {
    const med = temp.median90;
    const upRun = trailingRun(temp90, (x) => x >= med + RUN_DELTA_C);
    const downRun = trailingRun(temp90, (x) => x <= med - RUN_DELTA_C);
    const runFinding = (rule: string, run: number, up: boolean) =>
      finding({
        rule,
        engine: ENGINE,
        kind: "pattern",
        metric: "skin_temp",
        day,
        severity: run >= persistDays * 2 ? "moderate" : "low",
        title: `Skin temperature ${up ? "elevated" : "reduced"} for ${run} nights running`,
        value: mean(temp90.slice(temp90.length - run)),
        baseline: med,
        method: `Trailing run of nights at least ${RUN_DELTA_C} °C ${up ? "above" : "below"} the 90-day median (${persistDays}+ nights)`,
        completeness: completenessOf(ctx.days, "skin_temp", run),
        explanation: `Each of the last ${run} nights read at least ${RUN_DELTA_C} °C ${up ? "above" : "below"} your median of ${fmtMetric("skin_temp", med)}; the latest was ${fmtMetric("skin_temp", temp.last)}.`,
        nextStep: up
          ? `A sustained rise over several nights is more informative than one warm night. ${CLINICIAN_NOTE}`
          : `A sustained drop can follow a colder room, different bedding or a change in strap position. ${CLINICIAN_NOTE}`,
        evidence: { run, threshold: RUN_DELTA_C },
      });
    if (on("temperature.skin_temp_elevated_run") && upRun >= persistDays) out.push(runFinding("temperature.skin_temp_elevated_run", upRun, true));
    if (on("temperature.skin_temp_reduced_run") && downRun >= persistDays) out.push(runFinding("temperature.skin_temp_reduced_run", downRun, false));
  }

  // 77 variability: 7-day SD against 90-day SD.
  if (on("temperature.skin_temp_variability") && temp.ready && temp.sd90 != null && temp.sd90 > 0) {
    const last7 = series(ctx.days, "skin_temp", 7);
    const sd7 = sd(last7);
    if (sd7 != null && valid(last7).length >= 5) {
      const ratio = sd7 / temp.sd90;
      if (ratio >= 1.5) {
        out.push(
          finding({
            rule: "temperature.skin_temp_variability",
            engine: ENGINE,
            kind: "pattern",
            metric: "skin_temp",
            day,
            severity: ratio >= 2 ? "moderate" : "low",
            title: "Skin temperature varying more than usual",
            value: sd7,
            baseline: temp.sd90,
            method: "7-day standard deviation against the 90-day standard deviation",
            completeness: valid(last7).length / 7,
            explanation: `Night-to-night spread this week is ${round(sd7, 2)} °C against your usual ${round(temp.sd90, 2)} (${round(ratio, 1)}x).`,
            nextStep: "Changes in room temperature, bedding or wear position widen this spread. Note anything that changed this week.",
            evidence: { sd7: round(sd7, 3), sd90: round(temp.sd90, 3), ratio: round(ratio, 2) },
          }),
        );
      }
    }
  }

  // 78 to 80 associations.
  if (temp.ready) {
    if (on("temperature.skin_temp_vs_resting_hr")) {
      const f = corrFinding("temperature.skin_temp_vs_resting_hr", "Skin temperature and resting heart rate move together", temp90, series(ctx.days, "resting_hr", 90), day, (r) =>
        r > 0 ? "Warmer nights tend to come with a higher resting heart rate." : "Warmer nights tend to come with a lower resting heart rate.",
      );
      if (f) out.push(f);
    }
    if (on("temperature.skin_temp_vs_hrv")) {
      const f = corrFinding("temperature.skin_temp_vs_hrv", "Skin temperature and HRV move together", temp90, series(ctx.days, "hrv_rmssd", 90), day, (r) =>
        r < 0 ? "Warmer nights tend to come with lower HRV." : "Warmer nights tend to come with higher HRV.",
      );
      if (f) out.push(f);
    }
    if (on("temperature.skin_temp_vs_recovery")) {
      const f = corrFinding("temperature.skin_temp_vs_recovery", "Skin temperature and recovery move together", temp90, series(ctx.days, "recovery_score", 90), day, (r) =>
        r < 0 ? "Warmer nights tend to come with a lower recovery score." : "Warmer nights tend to come with a higher recovery score.",
      );
      if (f) out.push(f);
    }
  }

  // 81 trend change: CUSUM change point in the last 30 days, or a 30-day slope.
  if (on("temperature.skin_temp_trend_change") && temp.ready) {
    const cp = changePoint(temp90);
    const recentCp = cp != null && cp.index >= temp90.length - 30;
    const slopeShift = temp.slope30 != null ? temp.slope30 * 30 : null;
    const bySlope = slopeShift != null && Math.abs(slopeShift) >= 0.3 && valid(series(ctx.days, "skin_temp", 30)).length >= 20;
    if (recentCp || bySlope) {
      const dir = recentCp ? cp!.direction : slopeShift! > 0 ? "up" : "down";
      const after = recentCp ? mean(temp90.slice(cp!.index + 1)) : temp.mean7;
      out.push(
        finding({
          rule: "temperature.skin_temp_trend_change",
          engine: ENGINE,
          kind: "trend",
          metric: "skin_temp",
          day,
          severity: "low",
          title: `Overnight skin temperature has shifted ${dir}`,
          value: after,
          baseline: temp.median90,
          method: recentCp ? "CUSUM change point on the 90-day series" : "Ordinary least-squares slope over 30 days",
          completeness: completenessOf(ctx.days, "skin_temp", 30),
          explanation: recentCp
            ? `A level shift ${cp!.direction} of about ${round(cp!.magnitude, 1)} MAD units began around ${ctx.days[Math.max(0, ctx.days.length - temp90.length + cp!.index)]?.day ?? "recently"}; nights since then average ${fmtMetric("skin_temp", after)}.`
            : `The 30-day slope works out to ${round(slopeShift, 2)} °C over the month, against a 90-day median of ${fmtMetric("skin_temp", temp.median90)}.`,
          nextStep: "Seasonal room temperature and cycle phase move this over weeks. It is a trend in your own data, not a diagnosis.",
          evidence: { changePoint: cp ? { index: cp.index, direction: cp.direction, magnitude: round(cp.magnitude, 2) } : null, slope30: round(temp.slope30, 5) },
        }),
      );
    }
  }

  // Multi-metric concordant deviation across the panel.
  if (on("temperature.multi_metric_deviation")) {
    const panel = deviationPanel(ctx);
    const concordant = panel.filter((row) => {
      if (row.z == null || !row.ready) return false;
      if (row.metric === "hrv_rmssd") return row.z <= -zModerate;
      return row.z >= zModerate;
    });
    if (concordant.length >= 2) {
      const names = concordant.map((r) => `${r.metric === "skin_temp" ? "skin temperature" : r.metric === "resting_hr" ? "resting heart rate" : r.metric === "hrv_rmssd" ? "HRV" : "respiratory rate"} (${r.metric === "hrv_rmssd" ? "down" : "up"}, z ${r.z})`);
      out.push(
        finding({
          rule: "temperature.multi_metric_deviation",
          engine: ENGINE,
          kind: "pattern",
          metric: "skin_temp",
          day,
          severity: "high",
          title: "Several overnight measures deviate together",
          value: concordant.length,
          baseline: 4,
          method: `Robust z of the latest night for skin temperature, resting HR, HRV and respiratory rate; two or more past ${zModerate} in the concordant direction (temperature up, resting HR up, HRV down, respiratory rate up)`,
          completeness: panel.filter((r) => r.z != null).length / panel.length,
          explanation: `${concordant.length} of 4 overnight measures moved together last night: ${names.join(", ")}. Seen together these are consistent with the body working harder overnight, which can follow a very hard day, alcohol, heat, poor sleep or the early stage of a cold. The data cannot say which.`,
          nextStep: `Take the day easier and compare tonight's readings. ${CLINICIAN_NOTE}`,
          evidence: { metrics: concordant.map((r) => ({ metric: r.metric, z: r.z, value: r.value, baseline: r.baseline })), zModerate },
        }),
      );
    }
  }

  return out;
}
