import { type NextRequest, NextResponse } from "next/server";
import { normalizePrompt, type InterpretResponse } from "@/lib/ai/schema";
import { interpretDeterministic, interpretWithClaude } from "@/lib/ai/promptInterpreter";
import { getImageProvider } from "@/lib/ai/imageProvider";
import { clientKey } from "@/lib/ai/rateLimit";
import { interpretCache, interpretConcurrency, interpretLimiter } from "@/lib/ai/labLimits";

export const runtime = "nodejs";

/** POST { prompt } → the validated interpretation. Text and geometry never need the model; image prompts do not call the provider here. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const prompt = normalizePrompt((body as { prompt?: unknown })?.prompt);
  if (!prompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });

  const wait = interpretLimiter.take(clientKey(request.headers));
  if (wait > 0) return NextResponse.json({ error: "rate_limited", retryAfterMs: wait }, { status: 429, headers: { "retry-after": String(Math.ceil(wait / 1000)) } });

  const key = prompt.toLowerCase();
  const imageProvider = Boolean(getImageProvider());
  const hit = interpretCache.get(key);
  if (hit) return NextResponse.json({ ...hit, cached: true, imageProvider } satisfies InterpretResponse);

  const release = interpretConcurrency.tryAcquire();
  // Over the concurrency cap the rules still answer instantly; nothing waits on the model.
  const result = release ? await interpretWithClaude(prompt).finally(release) : { interpretation: interpretDeterministic(prompt), source: "deterministic" as const };
  interpretCache.set(key, result);
  return NextResponse.json({ ...result, cached: false, imageProvider } satisfies InterpretResponse);
}
