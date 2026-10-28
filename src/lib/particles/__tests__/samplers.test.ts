import { describe, expect, it } from "vitest";
import { GEOMETRY_KINDS } from "@/lib/ai/schema";
import { sampleGeometry } from "../geometrySampler";
import { fitFor } from "../targetGenerator";
import { fitToCount, rng } from "../types";
import { wrap } from "../textSampler";

describe("sampleGeometry", () => {
  it("fills exactly the requested count for every kind, inside the fit box, deterministically", () => {
    for (const kind of GEOMETRY_KINDS) {
      const a = sampleGeometry(kind, 2000, "seed", 0.8);
      const b = sampleGeometry(kind, 2000, "seed", 0.8);
      expect(a.positions.length, kind).toBe(6000);
      expect(a.emphasis.length, kind).toBe(2000);
      expect(Array.from(a.positions.slice(0, 30)), kind).toEqual(Array.from(b.positions.slice(0, 30)));
      let maxR = 0;
      for (let i = 0; i < 2000; i++) maxR = Math.max(maxR, Math.hypot(a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]));
      expect(maxR, kind).toBeLessThan(0.8 * 1.6);
      expect(Number.isNaN(a.positions[0]), kind).toBe(false);
    }
  });
  it("gives a galaxy spiral arms spread wider than tall", () => {
    const g = sampleGeometry("galaxy", 4000, "x", 1);
    let sx = 0, sy = 0;
    for (let i = 0; i < 4000; i++) {
      sx += Math.abs(g.positions[i * 3]);
      sy += Math.abs(g.positions[i * 3 + 1]);
    }
    expect(sx).toBeGreaterThan(sy);
  });
});

describe("fitToCount", () => {
  it("subsamples long lists and jitters repeated points", () => {
    const random = rng(1);
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0, e: 1 }));
    const few = fitToCount(pts, 4, random);
    expect(few.positions.length).toBe(12);
    const many = fitToCount(pts, 25, random, 0.1);
    expect(many.positions.length).toBe(75);
    expect(many.emphasis.every((e) => e === 1)).toBe(true);
    const none = fitToCount([], 8, random);
    expect(none.positions.length).toBe(24);
  });
});

describe("helpers", () => {
  it("keeps wide formations inside narrow views", () => {
    expect(fitFor(2.4, 0.5)).toBeLessThan(fitFor(1, 0.5));
    expect(fitFor(1, 1.8)).toBeCloseTo(1.3 * 0.68, 5);
  });
  it("wraps long text onto at most three lines", () => {
    expect(wrap("FRADY", 12)).toEqual(["FRADY"]);
    expect(wrap("the quick brown fox jumps over the lazy dog again", 12).length).toBe(3);
  });
});
