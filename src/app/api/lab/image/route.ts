import { type NextRequest, NextResponse } from "next/server";
import { normalizePrompt, type ImageResponse } from "@/lib/ai/schema";
import { getImageProvider } from "@/lib/ai/imageProvider";
import { clientKey, withTimeout } from "@/lib/ai/rateLimit";
import { IMAGE_TIMEOUT_MS, imageCache, imageConcurrency, imageDaily, imageLimiter } from "@/lib/ai/labLimits";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST { subject } → a silhouette PNG data URL from the configured provider, or 503 when none is configured. */
export async function POST(request: NextRequest) {
  const provider = getImageProvider();
  if (!provider) return NextResponse.json({ error: "image_provider_unconfigured" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const subject = normalizePrompt((body as { subject?: unknown })?.subject);
  if (!subject) return NextResponse.json({ error: "empty_subject" }, { status: 400 });

  const key = subject.toLowerCase();
  const hit = imageCache.get(key);
  if (hit) return NextResponse.json({ image: hit, cached: true } satisfies ImageResponse);

  const wait = imageLimiter.take(clientKey(request.headers));
  if (wait > 0) return NextResponse.json({ error: "rate_limited", retryAfterMs: wait }, { status: 429, headers: { "retry-after": String(Math.ceil(wait / 1000)) } });
  if (!imageDaily.take()) return NextResponse.json({ error: "daily_cap_reached" }, { status: 429 });
  const release = imageConcurrency.tryAcquire();
  if (!release) return NextResponse.json({ error: "busy" }, { status: 503, headers: { "retry-after": "5" } });

  const controller = new AbortController();
  try {
    const image = await withTimeout(provider.generate(subject, controller.signal), IMAGE_TIMEOUT_MS, "image generation timed out");
    imageCache.set(key, image);
    return NextResponse.json({ image, cached: false } satisfies ImageResponse);
  } catch (error) {
    controller.abort();
    const message = error instanceof Error ? error.message : "image generation failed";
    console.error(`[lab] image generation failed for "${subject}": ${message}`);
    return NextResponse.json({ error: "generation_failed", message }, { status: 502 });
  } finally {
    release();
  }
}
