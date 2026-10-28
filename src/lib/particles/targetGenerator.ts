import type { Interpretation } from "@/lib/ai/schema";
import { sampleGeometry } from "./geometrySampler";
import { sampleText } from "./textSampler";
import { sampleImage } from "./imageSampler";
import type { TargetData } from "./types";

export interface TargetOptions {
  count: number;
  /** Viewport width / height, so wide formations shrink on phones. */
  viewAspect: number;
  fontFamily: string;
  /** Fetches a silhouette for an image prompt; resolves to a data URL, or null when generation is unavailable. */
  fetchImage?: (subject: string) => Promise<string | null>;
}

/** Half-height of the formation in world units for a given aspect, keeping it inside the view. */
export function fitFor(aspect: number, viewAspect: number): number {
  const viewHalfHeight = 1.3;
  const viewHalfWidth = viewHalfHeight * viewAspect;
  // Leave room for the prompt bar at the bottom and the margins.
  const maxH = viewHalfHeight * 0.68;
  const maxW = viewHalfWidth * 0.8;
  return Math.min(maxH, maxW / Math.max(0.5, aspect));
}

/**
 * Builds the particle targets for an interpretation. Text and geometry are deterministic; image
 * prompts call `fetchImage` and fall back to a seeded procedural form when no image comes back, so
 * the scene always has something to assemble into.
 */
export async function buildTarget(interp: Interpretation, opts: TargetOptions): Promise<{ target: TargetData; fallback: "none" | "procedural"; reason?: string }> {
  const base = { count: opts.count, depth: interp.depth, motion: interp.motion, palette: interp.palette } as const;
  if (interp.method === "text") {
    const text = interp.text ?? interp.subject;
    const fit = fitFor(interp.aspect, opts.viewAspect);
    const s = sampleText(text, opts.count, { fontFamily: opts.fontFamily, aspect: interp.aspect, fit });
    return { target: { ...base, positions: s.positions, emphasis: s.emphasis, colors: null }, fallback: "none" };
  }
  if (interp.method === "geometry" && interp.geometry) {
    const fit = fitFor(interp.aspect, opts.viewAspect);
    const s = sampleGeometry(interp.geometry, opts.count, interp.subject, fit);
    return { target: { ...base, positions: s.positions, emphasis: s.emphasis, colors: null }, fallback: "none" };
  }
  // Image route.
  const src = opts.fetchImage ? await opts.fetchImage(interp.subject) : null;
  let reason: string | undefined;
  if (src) {
    const fit = fitFor(interp.aspect, opts.viewAspect);
    // Silhouette mode first (crisp contour), then the photo analysis, which copes with any background.
    for (const mode of ["silhouette", "photo"] as const) {
      try {
        const s = await sampleImage(src, opts.count, { fit, useColor: true, mode });
        return { target: { ...base, positions: s.positions, emphasis: s.emphasis, colors: s.colors }, fallback: "none" };
      } catch (error) {
        reason = error instanceof Error ? error.message : "image could not be sampled";
      }
    }
  }
  const fit = fitFor(1.2, opts.viewAspect);
  const s = sampleGeometry("concept", opts.count, interp.subject, fit);
  return { target: { ...base, depth: "volume", positions: s.positions, emphasis: s.emphasis, colors: null }, fallback: "procedural", reason };
}
