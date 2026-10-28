/**
 * In-memory guards for the lab API routes: a per-key token bucket, a concurrency semaphore, a daily
 * counter and a bounded TTL cache. They live in the server instance's memory, which on Vercel means
 * per warm lambda; that is enough to stop a single visitor or a burst from running up a bill, and it
 * needs no extra infrastructure. Swap in a shared store if the lab ever needs global limits.
 */

type Bucket = { tokens: number; updated: number };

export class TokenBucket {
  private buckets = new Map<string, Bucket>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly maxKeys = 5000,
  ) {}

  /** Take one token for `key`. Returns the wait in ms when empty (0 when the request may proceed). */
  take(key: string, now = Date.now()): number {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.updated) * this.refillPerMs);
    b.updated = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / this.refillPerMs);
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (now - b.updated > 10 * 60_000) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

export class Semaphore {
  private active = 0;
  constructor(private readonly max: number) {}
  get inUse() {
    return this.active;
  }
  /** Returns a release function, or null when the cap is reached (callers answer 503 rather than queue). */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}

/** Counts events per UTC day; resets itself when the day changes. */
export class DailyCounter {
  private day = "";
  private count = 0;
  constructor(private readonly cap: number) {}
  /** Increment and report whether the cap allows it. */
  take(now = Date.now()): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.count >= this.cap) return false;
    this.count++;
    return true;
  }
}

export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}
  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < now) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency so the eviction below is roughly least-recently-used.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V, now = Date.now()) {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  get size() {
    return this.map.size;
  }
}

/** Best-effort client key for rate limiting behind Vercel's proxy. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : headers.get("x-real-ip") ?? "") || "unknown";
  return ip.trim();
}

/** Resolve or reject with `message` after `ms`, whichever comes first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
