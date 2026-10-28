import { describe, expect, it } from "vitest";
import { DailyCounter, Semaphore, TokenBucket, TtlCache } from "../rateLimit";

describe("TokenBucket", () => {
  it("allows a burst then throttles, and refills over time", () => {
    const b = new TokenBucket(3, 1 / 1000);
    expect(b.take("a", 0)).toBe(0);
    expect(b.take("a", 0)).toBe(0);
    expect(b.take("a", 0)).toBe(0);
    expect(b.take("a", 0)).toBeGreaterThan(0);
    expect(b.take("b", 0)).toBe(0);
    expect(b.take("a", 1000)).toBe(0);
  });
});

describe("Semaphore", () => {
  it("caps concurrency and releases once", () => {
    const s = new Semaphore(1);
    const r = s.tryAcquire();
    expect(r).not.toBeNull();
    expect(s.tryAcquire()).toBeNull();
    r?.();
    r?.();
    expect(s.inUse).toBe(0);
    expect(s.tryAcquire()).not.toBeNull();
  });
});

describe("DailyCounter and TtlCache", () => {
  it("resets per day and expires entries", () => {
    const d = new DailyCounter(1);
    const day1 = Date.UTC(2026, 0, 1);
    expect(d.take(day1)).toBe(true);
    expect(d.take(day1)).toBe(false);
    expect(d.take(day1 + 86_400_000)).toBe(true);
    const c = new TtlCache<number>(2, 100);
    c.set("a", 1, 0);
    c.set("b", 2, 0);
    c.set("c", 3, 0);
    expect(c.get("a", 0)).toBeUndefined();
    expect(c.get("c", 0)).toBe(3);
    expect(c.get("c", 200)).toBeUndefined();
  });
});
