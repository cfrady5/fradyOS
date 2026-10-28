/** A particle formation: exactly `count` targets in the engine's world units (the view is about 2.6 units tall). */
export interface TargetData {
  count: number;
  /** xyz per particle. */
  positions: Float32Array;
  /** 0..1 per particle; contour points are 1, interior lower. Drives brightness and size. */
  emphasis: Float32Array;
  /** rgba per particle (0..1), alpha 0 when the palette should be used instead. */
  colors: Float32Array | null;
  /** volume forms can be rotated by the visitor and spin slowly on their own. */
  depth: "flat" | "relief" | "volume";
  motion: { turbulence: number; spin: number; pulse: number };
  palette: "ink" | "lichen" | "oak";
}

export type LabPhase = "IDLE" | "DISPERSING" | "GENERATING" | "ASSEMBLING" | "FORMED" | "INTERACTIVE" | "ERROR";

/** Deterministic PRNG (mulberry32) so the same prompt always builds the same cloud. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Bring any sampled point set to exactly `count` entries: repeat with jitter when short, subsample when long. Shuffled so morphs look organic. */
export function fitToCount(points: { x: number; y: number; z: number; e: number; r?: number; g?: number; b?: number }[], count: number, random: () => number, jitter = 0.01): TargetData["positions"] extends Float32Array ? { positions: Float32Array; emphasis: Float32Array; colors: Float32Array | null } : never {
  const positions = new Float32Array(count * 3);
  const emphasis = new Float32Array(count);
  const hasColor = points.length > 0 && points[0].r !== undefined;
  const colors = hasColor ? new Float32Array(count * 4) : null;
  const n = points.length;
  if (n === 0) {
    // Nothing to show: a loose cloud so the scene never goes blank.
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 2.4;
      positions[i * 3 + 1] = (random() - 0.5) * 1.6;
      positions[i * 3 + 2] = (random() - 0.5) * 0.6;
      emphasis[i] = 0.3;
    }
    return { positions, emphasis, colors };
  }
  // Fisher-Yates over an index list, cycling through the source when count > n.
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i % n;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let i = 0; i < count; i++) {
    const p = points[order[i]];
    const dup = i >= n;
    positions[i * 3] = p.x + (dup ? (random() - 0.5) * jitter : 0);
    positions[i * 3 + 1] = p.y + (dup ? (random() - 0.5) * jitter : 0);
    positions[i * 3 + 2] = p.z + (random() - 0.5) * jitter * 0.5;
    emphasis[i] = p.e;
    if (colors) {
      colors[i * 4] = p.r ?? 1;
      colors[i * 4 + 1] = p.g ?? 1;
      colors[i * 4 + 2] = p.b ?? 1;
      colors[i * 4 + 3] = 1;
    }
  }
  return { positions, emphasis, colors };
}
