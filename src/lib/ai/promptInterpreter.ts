import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GEOMETRY_KINDS, InterpretationSchema, type Interpretation } from "./schema";
import { interpretDeterministic, reconcile } from "./rules";

export { interpretDeterministic } from "./rules";

/**
 * Prompt interpretation with Claude on top of the rules in `rules.ts`. When `ANTHROPIC_API_KEY` is
 * set, Claude classifies the prompt into the schema; its answer is validated and reconciled (text and
 * geometry stay deterministic whatever it suggests). On any failure or timeout the rules answer.
 */

const MODEL = process.env.LAB_INTERPRET_MODEL ?? "claude-opus-5-5";
const TIMEOUT_MS = 8_000;

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You classify short visitor prompts for a generative particle engine that forms shapes out of 30,000 points.
Return one JSON object matching the schema. Rules:
- category "text" for words, names, initials, numbers or symbols the visitor wants spelled out; method "text"; put the exact characters in "text" (max 40).
- category "geometry" for mathematical forms; method "geometry"; pick the closest "geometry" kind from: ${GEOMETRY_KINDS.join(", ")}.
- Use method "geometry" also for recognizable objects a listed kind represents well (a basketball, the moon, a planet with rings, a rose, a heart, a tornado, a cloud, a black hole, a galaxy).
- Otherwise category "object" (one recognizable thing) or "concept" (a scene, action or fantasy idea) with method "image", "text" and "geometry" null, and "subject" a short lower-case description of the silhouette to generate.
- aspect: width divided by height of the formation (0.5 tall to 2.4 wide). depth: "volume" for things that read as 3D solids the visitor may rotate, "relief" for a sheet with layered depth, "flat" for thin outlines.
- motion: turbulence 0 to 1 (how restless the idle form is), spin 0 to 1 (slow rotation, volume only), pulse 0 to 1 (breathing).
- palette: "lichen" for living or green things, "oak" for warm, fiery or golden things, otherwise "ink".`;

/** Claude classification with validation; falls back to the rules on any failure. */
export async function interpretWithClaude(prompt: string): Promise<{ interpretation: Interpretation; source: "claude" | "deterministic" }> {
  if (!isClaudeConfigured()) return { interpretation: interpretDeterministic(prompt), source: "deterministic" };
  try {
    const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Low effort: this is a classification, not a reasoning task.
      output_config: { effort: "low", format: zodOutputFormat(InterpretationSchema) },
      // Server-side fallback: if the model declines a prompt, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("refused");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("no text block");
    const parsed = InterpretationSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success) throw new Error("schema mismatch");
    return { interpretation: reconcile(parsed.data, prompt), source: "claude" };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[lab] Claude interpretation failed, using rules:", error instanceof Error ? error.message : error);
    return { interpretation: interpretDeterministic(prompt), source: "deterministic" };
  }
}
