import { describe, expect, it } from "vitest";
import { changePoint, correlationCI, ewma, mad, mean, median, pearson, percentileRank, quantile, robustZ, sd, slope, spearman, trailingRun, welch } from "../stats";

describe("descriptive statistics", () => {
  it("skip nulls and never invent samples", () => {
    expect(mean([1, null, 3, undefined])).toBe(2);
    expect(mean([null])).toBeNull();
    expect(sd([5])).toBeNull();
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(median([3, null, 1, 2])).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
  it("mad is robust to a single outlier", () => {
    const xs = [50, 51, 52, 50, 49, 51, 50, 200];
    expect(mad(xs)).toBeLessThan(3);
    expect(sd(xs)).toBeGreaterThan(40);
  });
  it("percentile rank and robust z", () => {
    expect(percentileRank([1, 2, 3, 4, 5], 3)).toBe(50);
    expect(robustZ(60, [50, 51, 52, 50, 49, 51, 50])).toBeGreaterThan(5);
    expect(robustZ(50, [50, 50, 50])).toBeNull();
  });
});

describe("trend and smoothing", () => {
  it("slope is per step and ignores gaps", () => {
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1);
    expect(slope([10, null, 14, null, 18])).toBeCloseTo(2);
    expect(slope([1, 2])).toBeNull();
  });
  it("ewma tracks the latest values more", () => {
    expect(ewma([10, 10, 10])).toBe(10);
    expect(ewma([10, 20], 0.5)).toBe(15);
  });
  it("trailing run stops on nulls", () => {
    expect(trailingRun([1, 5, 6, 7], (x) => x > 4)).toBe(3);
    expect(trailingRun([5, null, 6], (x) => x > 4)).toBe(1);
  });
  it("finds a level shift upward", () => {
    const xs = [...Array(15).fill(50), ...Array(10).fill(58)].map((v, i) => v + (i % 3) - 1);
    const cp = changePoint(xs);
    expect(cp?.direction).toBe("up");
    expect(cp!.index).toBeGreaterThanOrEqual(13);
    expect(cp!.index).toBeLessThanOrEqual(17);
    expect(changePoint(Array(20).fill(50).map((v, i) => v + (i % 2)))).toBeNull();
  });
});

describe("relationships", () => {
  it("pearson and spearman agree on a monotone series", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = [2, 4, 5, 4, 5, 7];
    expect(pearson(xs, ys)!.r).toBeCloseTo(0.83, 1);
    expect(spearman(xs, ys)!.r).toBeGreaterThan(0.7);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("confidence interval narrows with n", () => {
    const wide = correlationCI(0.5, 10)!;
    const narrow = correlationCI(0.5, 100)!;
    expect(wide[1] - wide[0]).toBeGreaterThan(narrow[1] - narrow[0]);
  });
  it("welch reports the difference with a CI", () => {
    const w = welch([400, 420, 410, 430], [450, 470, 460, 455])!;
    expect(w.diff).toBeCloseTo(-43.75);
    expect(w.ci[0]).toBeLessThan(w.diff);
    expect(w.ci[1]).toBeGreaterThan(w.diff);
    expect(welch([1, 2], [3, 4, 5])).toBeNull();
  });
});
