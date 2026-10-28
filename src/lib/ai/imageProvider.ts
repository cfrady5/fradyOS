import "server-only";
import { openaiApiKey } from "./env";

/**
 * Silhouette generation behind one small interface, so the lab can switch providers through env
 * without touching the sampler. The provider returns a PNG of a bright subject on a black ground;
 * the browser turns that into particle targets (`lib/particles/imageSampler.ts`).
 *
 * Configure with:
 *   LAB_IMAGE_PROVIDER = "openai" | "none" (default: "openai" when OPENAI_API_KEY is set, else "none")
 *   OPENAI_API_KEY (or `openai`), LAB_IMAGE_MODEL (tried first; then gpt-image-1, gpt-image-1-mini, gpt-image-2,
 *   dall-e-3, dall-e-2 until one the account can use answers), LAB_IMAGE_SIZE (default "1024x1024")
 */

export interface ImageProvider {
  readonly name: string;
  /** Generate a silhouette of `subject`. Resolves to a PNG data URL. */
  generate(subject: string, signal: AbortSignal): Promise<string>;
}

export function silhouettePrompt(subject: string): string {
  return `A clean, high-contrast white silhouette of ${subject}, centered, filling most of the frame, on a solid pure black background. Flat white shape with a crisp, readable outline, slight interior detail in mid grey only where it helps recognition. No text, no watermark, no border, no gradient background.`;
}

/** Models tried in order until one the account can use answers. `LAB_IMAGE_MODEL` goes first. */
const OPENAI_IMAGE_MODELS = ["gpt-image-1", "gpt-image-1-mini", "gpt-image-2", "dall-e-3", "dall-e-2"];

function openAIBody(model: string, subject: string, size: string): Record<string, unknown> {
  const base = { model, prompt: silhouettePrompt(subject), n: 1, size };
  // DALL·E takes response_format; the gpt-image family returns base64 by default and takes quality.
  if (model.startsWith("dall-e")) return { ...base, response_format: "b64_json" };
  return { ...base, quality: "low" };
}

/** True when the error means the model is unknown or unavailable to this account, so the next model is worth trying. */
function isModelUnavailable(status: number, detail: string): boolean {
  return status === 404 || (status === 400 && /model|does not exist|not found|unsupported|invalid/i.test(detail)) || (status === 403 && /model|verif/i.test(detail));
}

class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  private models: string[];
  constructor(
    private readonly apiKey: string,
    preferredModel: string | undefined,
    private readonly size: string,
  ) {
    this.models = preferredModel ? [preferredModel, ...OPENAI_IMAGE_MODELS.filter((m) => m !== preferredModel)] : [...OPENAI_IMAGE_MODELS];
  }

  async generate(subject: string, signal: AbortSignal): Promise<string> {
    // A masked value pasted from a dashboard ("sk-proj-abc•••") would fail inside fetch with an
    // opaque ByteString error; say what is wrong instead.
    if (/[^\x21-\x7e]/.test(this.apiKey)) throw new Error("the OpenAI key contains characters that are not part of a real key, re-enter it from the original source");
    let lastError = "no image model available";
    for (const model of this.models) {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(openAIBody(model, subject, this.size)),
        signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          const err = (await res.json()) as { error?: { message?: string; code?: string } };
          detail = err.error?.message ?? err.error?.code ?? "";
        } catch {
          // No JSON body.
        }
        lastError = `OpenAI ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`;
        if (isModelUnavailable(res.status, detail)) {
          // Remember so later requests skip straight to a model that works.
          this.models = this.models.filter((m) => m !== model);
          continue;
        }
        throw new Error(lastError);
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
    throw new Error(lastError);
  }
}

let cached: ImageProvider | null | undefined;

/** The configured provider, or null when image generation is off. */
export function getImageProvider(): ImageProvider | null {
  if (cached !== undefined) return cached;
  const key = openaiApiKey();
  const choice = (process.env.LAB_IMAGE_PROVIDER ?? (key ? "openai" : "none")).toLowerCase();
  if (choice === "openai" && key) {
    cached = new OpenAIImageProvider(key, process.env.LAB_IMAGE_MODEL, process.env.LAB_IMAGE_SIZE ?? "1024x1024");
  } else {
    cached = null;
  }
  return cached;
}

/** For tests and hot reloads. */
export function resetImageProviderCache() {
  cached = undefined;
}
