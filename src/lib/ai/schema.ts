import { z } from "zod";

/**
 * What the particle engine needs to know about a prompt. Produced by the interpreter (deterministic
 * rules, or Claude when an API key is configured) and validated here before anything renders.
 */
export const PROMPT_MAX_LENGTH = 80;

/** Procedural forms the geometry sampler can build. Keep in sync with `geometrySampler.ts`. */
export const GEOMETRY_KINDS = [
  "sphere",
  "basketball",
  "galaxy",
  "ring",
  "torus",
  "helix",
  "wave",
  "heart",
  "star",
  "moon",
  "blackhole",
  "cube",
  "rose",
  "saturn",
  "tornado",
  "cloud",
  "concept",
] as const;
export type GeometryKind = (typeof GEOMETRY_KINDS)[number];

export const InterpretationSchema = z.object({
  /** text: words, initials, numbers, symbols. geometry: mathematical forms. object: a recognizable thing. concept: scenes, abstract or fantasy ideas. */
  category: z.enum(["text", "geometry", "object", "concept"]),
  /** Short, lower-case description of what to draw, e.g. "wolf howling at the moon". */
  subject: z.string().min(1).max(120),
  /** How to build the target: deterministic text or geometry, or a generated silhouette image. */
  method: z.enum(["text", "geometry", "image"]),
  /** For method "text": the exact characters to render. */
  text: z.string().max(40).nullable(),
  /** For method "geometry": which procedural form. */
  geometry: z.enum(GEOMETRY_KINDS).nullable(),
  /** Width / height the formation should occupy, 0.5 (tall) to 2.4 (wide). */
  aspect: z.number().min(0.5).max(2.4),
  /** flat: a sheet with slight relief. relief: a sheet with layered depth. volume: a true 3D form the visitor can rotate. */
  depth: z.enum(["flat", "relief", "volume"]),
  motion: z.object({
    /** 0 still, 1 very turbulent idle movement. */
    turbulence: z.number().min(0).max(1),
    /** 0 none, 1 steady slow rotation (volume forms only). */
    spin: z.number().min(0).max(1),
    /** 0 none, 1 strong breathing pulse. */
    pulse: z.number().min(0).max(1),
  }),
  /** Which site colour the formation leans toward. */
  palette: z.enum(["ink", "lichen", "oak"]),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

/** API response of POST /api/lab/interpret. */
export const InterpretResponseSchema = z.object({
  interpretation: InterpretationSchema,
  source: z.enum(["claude", "deterministic"]),
  cached: z.boolean(),
  /** True when the server can generate silhouettes for image prompts. */
  imageProvider: z.boolean(),
});
export type InterpretResponse = z.infer<typeof InterpretResponseSchema>;

/** API response of POST /api/lab/image. */
export const ImageResponseSchema = z.object({
  /** PNG data URL of a high-contrast subject silhouette on black. */
  image: z.string().startsWith("data:image/"),
  cached: z.boolean(),
});
export type ImageResponse = z.infer<typeof ImageResponseSchema>;

export const EXAMPLE_PROMPTS = ["A spiral galaxy", "A wolf howling at the moon", "The word FRADY", "A basketball"] as const;

/** Trim, collapse whitespace, strip control characters, enforce the length limit. Returns null when nothing usable remains. */
export function normalizePrompt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, PROMPT_MAX_LENGTH);
}
