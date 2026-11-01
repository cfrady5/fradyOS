/**
 * Baseline statistics. Pure, dependency-free, and tolerant of nulls: every function takes the
 * values it is given and never invents a sample. Robust estimators (median, MAD) are preferred where
 * outliers are common, which is most physiological series.
 */

export const valid = (xs: (number | null | undefined)[]): number[] => xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function mean(xs: (number | null | undefined)[]): number | null {
  const v = valid(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sd(xs: (number | null | undefined)[]): number | null {
  const v = valid(xs);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function quantile(xs: (number | null | undefined)[], q: number): number | null {
  const v = valid(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export const median = (xs: (number | null | undefined)[]) => quantile(xs, 0.5);

/** Median absolute deviation, scaled by 1.4826 so it estimates the SD of a normal series. */
export function mad(xs: (number | null | undefined)[]): number | null {
  const v = valid(xs);
  if (v.length < 3) return null;
  const m = median(v)!;
  const dev = v.map((x) => Math.abs(x - m));
  return 1.4826 * median(dev)!;
}

/** Percentile rank of x within xs, 0..100 (share of samples at or below x). */
export function percentileRank(xs: (number | null | undefined)[], x: number): number | null {
  const v = valid(xs);
  if (!v.length) return null;
  const below = v.filter((y) => y < x).length;
  const equal = v.filter((y) => y === x).length;
  return ((below + equal * 0.5) / v.length) * 100;
}

/** Robust z-score: distance from the median in MAD units. Falls back to SD when MAD is zero. */
export function robustZ(x: number, xs: (number | null | undefined)[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  const scale = mad(xs);
  if (scale != null && scale > 0) return (x - m) / scale;
  const s = sd(xs);
  if (s != null && s > 0) return (x - m) / s;
  return null;
}

/** Ordinary least-squares slope per unit x; nulls are skipped by index. */
export function slope(ys: (number | null | undefined)[]): number | null {
  const pts: [number, number][] = [];
  ys.forEach((y, i) => {
    if (typeof y === "number" && Number.isFinite(y)) pts.push([i, y]);
  });
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (sxx === 0) return null;
  return pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
}

/** Exponentially weighted moving average over the valid samples in order. */
export function ewma(xs: (number | null | undefined)[], alpha = 0.2): number | null {
  let acc: number | null = null;
  for (const x of xs) {
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    acc = acc == null ? x : alpha * x + (1 - alpha) * acc;
  }
  return acc;
}

/** Trailing window of the last n entries (not the last n valid ones). */
export function tail<T>(xs: T[], n: number): T[] {
  return n >= xs.length ? xs.slice() : xs.slice(xs.length - n);
}

/** Length of the trailing run for which `pred` holds, skipping nothing: a null breaks the run. */
export function trailingRun(xs: (number | null | undefined)[], pred: (x: number) => boolean): number {
  let run = 0;
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (typeof x !== "number" || !Number.isFinite(x) || !pred(x)) break;
    run++;
  }
  return run;
}

/**
 * Two-sided CUSUM change-point detector on standardised residuals. Returns the index after which the
 * mean most plausibly shifted, or null. `k` is the allowance (half the shift worth detecting, in SDs)
 * and `h` the decision threshold.
 */
export function changePoint(xs: (number | null | undefined)[], k = 0.5, h = 4): { index: number; direction: "up" | "down"; magnitude: number } | null {
  const pts: [number, number][] = [];
  xs.forEach((x, i) => {
    if (typeof x === "number" && Number.isFinite(x)) pts.push([i, x]);
  });
  if (pts.length < 10) return null;
  const ref = pts.slice(0, Math.max(5, Math.floor(pts.length / 2))).map((p) => p[1]);
  const m = median(ref)!;
  const s = mad(ref) || sd(ref) || 0;
  if (!s) return null;
  let up = 0;
  let down = 0;
  let upStart = 0;
  let downStart = 0;
  for (let i = 0; i < pts.length; i++) {
    const z = (pts[i][1] - m) / s;
    up = Math.max(0, up + z - k);
    if (up === 0) upStart = i + 1;
    down = Math.max(0, down - z - k);
    if (down === 0) downStart = i + 1;
    if (up > h) {
      const after = pts.slice(upStart).map((p) => p[1]);
      return { index: pts[Math.max(0, upStart - 1)][0], direction: "up", magnitude: (mean(after)! - m) / s };
    }
    if (down > h) {
      const after = pts.slice(downStart).map((p) => p[1]);
      return { index: pts[Math.max(0, downStart - 1)][0], direction: "down", magnitude: (m - mean(after)!) / s };
    }
  }
  return null;
}

/** Pearson correlation over index-aligned pairs where both are valid. */
export function pearson(xs: (number | null | undefined)[], ys: (number | null | undefined)[]): { r: number; n: number } | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

/** Spearman rank correlation (Pearson on average ranks). */
export function spearman(xs: (number | null | undefined)[], ys: (number | null | undefined)[]): { r: number; n: number } | null {
  const idx: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) idx.push(i);
  }
  if (idx.length < 3) return null;
  const rank = (get: (i: number) => number) => {
    const order = idx.slice().sort((a, b) => get(a) - get(b));
    const ranks = new Map<number, number>();
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && get(order[j + 1]) === get(order[i])) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks.set(order[k], r);
      i = j + 1;
    }
    return idx.map((k) => ranks.get(k)!);
  };
  return pearson(rank((i) => xs[i] as number), rank((i) => ys[i] as number));
}

/** Fisher-z 95% confidence interval for a correlation coefficient. */
export function correlationCI(r: number, n: number): [number, number] | null {
  if (n < 4 || Math.abs(r) >= 1) return null;
  const z = Math.atanh(r);
  const se = 1 / Math.sqrt(n - 3);
  return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)];
}

/** Welch two-sample comparison of means with a 95% CI on the difference (a minus b). */
export function welch(a: (number | null | undefined)[], b: (number | null | undefined)[]): { diff: number; ci: [number, number]; nA: number; nB: number; t: number } | null {
  const va = valid(a);
  const vb = valid(b);
  if (va.length < 3 || vb.length < 3) return null;
  const ma = mean(va)!;
  const mb = mean(vb)!;
  const sa = sd(va) ?? 0;
  const sb = sd(vb) ?? 0;
  const se = Math.sqrt((sa * sa) / va.length + (sb * sb) / vb.length);
  if (!se) return { diff: ma - mb, ci: [ma - mb, ma - mb], nA: va.length, nB: vb.length, t: 0 };
  const diff = ma - mb;
  // t critical approximated at 2.0 for small samples; conservative enough for exploratory insights.
  const tCrit = va.length + vb.length > 30 ? 1.96 : 2.1;
  return { diff, ci: [diff - tCrit * se, diff + tCrit * se], nA: va.length, nB: vb.length, t: diff / se };
}

export const round = (x: number | null | undefined, d = 1): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export const pct = (a: number | null | undefined, b: number | null | undefined): number | null => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
