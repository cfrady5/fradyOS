import "server-only";
import { DailyCounter, Semaphore, TokenBucket, TtlCache } from "./rateLimit";
import type { Interpretation } from "./schema";

/** Shared, module-level guards for the two lab routes (one set per server instance). */
export const interpretLimiter = new TokenBucket(20, 20 / 60_000); // 20 per minute per visitor
export const interpretConcurrency = new Semaphore(Number(process.env.LAB_INTERPRET_CONCURRENCY ?? 4));
export const interpretCache = new TtlCache<{ interpretation: Interpretation; source: "claude" | "deterministic" }>(500, 60 * 60_000);

export const imageLimiter = new TokenBucket(6, 6 / 60_000); // 6 per minute per visitor
export const imageConcurrency = new Semaphore(Number(process.env.LAB_IMAGE_CONCURRENCY ?? 2));
export const imageDaily = new DailyCounter(Number(process.env.LAB_IMAGE_DAILY_CAP ?? 200));
export const imageCache = new TtlCache<string>(40, 24 * 60 * 60_000);
export const IMAGE_TIMEOUT_MS = Number(process.env.LAB_IMAGE_TIMEOUT_MS ?? 45_000);
