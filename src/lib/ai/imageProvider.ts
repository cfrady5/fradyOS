import "server-only";
import { openaiApiKey } from "./env";

/**
 * Silhouette generation behind one small interface, so the lab can switch providers through env
 * without touching the sampler. The provider returns a PNG of a bright subject on a black ground;
 * the browser turns that into particle targets (`lib/particles/imageSampler.ts`).
 *
 * Configure with:
 *   LAB_IMAGE_PROVIDER = "openai" | "none" (default: "openai" when OPENAI_API_KEY is set, else "none")
 *   OPENAI_API_KEY (or `openai`), LAB_IMAGE_MODEL (default "gpt-image-1"), LAB_IMAGE_SIZE (default "1024x1024")
 */

export interface ImageProvider {
  readonly name: string;
  /** Generate a silhouette of `subject`. Resolves to a PNG data URL. */
  generate(subject: string, signal: AbortSignal): Promise<string>;
}

export function silhouettePrompt(subject: string): string {
  return `A clean, high-contrast white silhouette of ${subject}, centered, filling most of the frame, on a solid pure black background. Flat white shape with a crisp, readable outline, slight interior detail in mid grey only where it helps recognition. No text, no watermark, no border, no gradient background.`;
}

class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly size: string,
  ) {}

  async generate(subject: string, signal: AbortSignal): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, prompt: silhouettePrompt(subject), n: 1, size: this.size, output_format: "png", quality: "low" }),
      signal,
    });
    if (!res.ok) {
      // Surface the provider's own message (model access, bad parameter, quota) rather than a bare status.
      let detail = "";
      try {
        const err = (await res.json()) as { error?: { message?: string; code?: string } };
        detail = err.error?.message ?? err.error?.code ?? "";
      } catch {
        // No JSON body.
      }
      throw new Error(`OpenAI ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
    }
    const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const first = json.data?.[0];
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
    if (first?.url) {
      // Some models answer with a hosted URL; pull it server-side so the browser never talks to the provider.
      const img = await fetch(first.url, { signal });
      if (!img.ok) throw new Error(`image download ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      return `data:${img.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
    }
    throw new Error("image provider returned no image");
  }
}

let cached: ImageProvider | null | undefined;

/** The configured provider, or null when image generation is off. */
export function getImageProvider(): ImageProvider | null {
  if (cached !== undefined) return cached;
  const key = openaiApiKey();
  const choice = (process.env.LAB_IMAGE_PROVIDER ?? (key ? "openai" : "none")).toLowerCase();
  if (choice === "openai" && key) {
    cached = new OpenAIImageProvider(key, process.env.LAB_IMAGE_MODEL ?? "gpt-image-1", process.env.LAB_IMAGE_SIZE ?? "1024x1024");
  } else {
    cached = null;
  }
  return cached;
}

/** For tests and hot reloads. */
export function resetImageProviderCache() {
  cached = undefined;
}
