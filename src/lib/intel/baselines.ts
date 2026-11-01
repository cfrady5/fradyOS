import { ALGORITHM_VERSION, METRICS, METRIC_KEYS, type Baseline, type DailySummary, type MetricKey } from "./types";
import { ewma, mad, mean, median, pct, percentileRank, quantile, sd, slope, tail, valid } from "./stats";

export const BASELINE_VERSION = 1;

/** Values of one metric in day order, from the trailing `n` calendar days ending at the last entry. */
export function series(days: DailySummary[], metric: MetricKey, n?: number): (number | null)[] {
  const rows = n == null ? days : tail(days, n);
  return rows.map((d) => (d.scored ? d[metric] : null));
}

/** Baseline for one metric as of the last day in `days` (ascending). Only scored days count. */
export function computeBaseline(days: DailySummary[], metric: MetricKey): Baseline {
  const asOf = days.length ? days[days.length - 1].day : "";
  const all90 = series(days, metric, 90);
  const v90 = valid(all90);
  let last: number | null = null;
  let lastDay: string | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i].scored ? days[i][metric] : null;
    if (typeof v === "number") {
      last = v;
      lastDay = days[i].day;
      break;
    }
  }
  const m7 = mean(series(days, metric, 7));
  const m30 = mean(series(days, metric, 30));
  return {
    metric,
    asOf,
    version: BASELINE_VERSION,
    n: v90.length,
    last,
    lastDay,
    mean7: m7,
    mean14: mean(series(days, metric, 14)),
    mean30: m30,
    mean60: mean(series(days, metric, 60)),
    median90: median(v90),
    sd90: sd(v90),
    mad90: mad(v90),
    p25: quantile(v90, 0.25),
    p75: quantile(v90, 0.75),
    percentile: last == null ? null : percentileRank(v90, last),
    slope30: slope(series(days, metric, 30)),
    slope90: slope(all90),
    ewma: ewma(all90),
    rateOfChange: pct(m7, m30),
    ready: v90.length >= METRICS[metric].minSamples,
  };
}

export function computeBaselines(days: DailySummary[]): Record<MetricKey, Baseline> {
  const out = {} as Record<MetricKey, Baseline>;
  for (const k of METRIC_KEYS) out[k] = computeBaseline(days, k);
  return out;
}

export { ALGORITHM_VERSION };
