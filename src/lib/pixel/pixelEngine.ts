/**
 * FRADY pixel engine: shared Canvas 2D plumbing for every dithered effect on the site.
 *
 * - Ordered dithering with an 8x8 Bayer matrix (`bayer(x, y)`)
 * - `PixelBatch`: one Path2D per colour per frame, filled once (never a fillStyle per pixel)
 * - A single page-level pointer bus that converts pointer events into each canvas's local space
 * - Text rasterisation into a coverage grid for the monogram and wordmark
 *
 * Tuning constants live in `TUNING` at the top so every effect can be adjusted from one place.
 */
import { tokens, fieldGreens } from "@/lib/site/tokens";

export const TUNING = {
  /** Device pixel ratio cap. */
  maxDpr: 2,
  /** Pixel square size as a fraction of the cell pitch (leaves visible gaps). */
  pixelFill: 0.7,
  /** Canvases narrower than this use the "narrow" pitch (fewer pixels on phones). */
  narrowWidth: 720,
  /** Fraction of a canvas that must be on screen before its effect's `enter()` runs (the wordmark flood). */
  enterThreshold: 0.35,

  hero: {
    pitch: 6,
    pitchNarrow: 9,
    /** Field brightness is measured in shade levels (0 = unlit grid, 1..5 = the five steps of a green
     *  family) and ordered-dithered between neighbouring steps. Texture: base ± amplitude levels of slow
     *  sine-noise sparkle. */
    base: 0.13,
    amplitude: 0.11,
    waveSpeed: 0.35,
    /** Fade toward the left so the headline sits on a calm field (fractions of the width). */
    leftFadeStart: 0.16,
    leftFadeEnd: 0.6,
    leftFadeFloor: 0.14,
    /** Cursor light: gaussian sigma in px and added shade levels at the centre. */
    lightSigma: 115,
    lightGain: 3.4,
    /** Click ripples: ring speed (px/s), gaussian width (px), lifetime (s), added shade levels. */
    rippleSpeed: 460,
    rippleSigma: 13,
    rippleLife: 2.5,
    rippleGain: 3.2,
    /** The flowing wave: a main band travelling at `flowSpeed` px/s toward `flowAngle` degrees (0 is
     *  rightward, negative drifts up), with wavelength `flowWavelength` px, plus a weaker cross band.
     *  `flowMeander` (radians) bends the fronts row by row so they ripple like water. `flowGain` is
     *  the crest height in shade levels; on the left it is scaled down to `flowFloor`. */
    flowWavelength: 620,
    flowSpeed: 55,
    flowAngle: -12,
    flowGain: 6.6,
    flow2Wavelength: 380,
    flow2Speed: 34,
    flow2Angle: 32,
    flow2Weight: 0.3,
    flowMeander: 1.3,
    flowMeanderScale: 0.0105,
    flowMeanderSpeed: 0.22,
    flowFloor: 0.6,
    /** Variance. The travel speed of each band swings by ±`flowSpeedVar` at `flowSpeedVarRate` rad/s
     *  (the bands speed up and slow down out of step). `flowMeander2` bends the fronts column by column
     *  too. A drifting swell scales the crests down by up to `swellDepth` in some regions, so the wave
     *  runs strong in places and calm in others. */
    flowSpeedVar: 0.4,
    flowSpeedVarRate: 0.13,
    flowMeander2: 0.9,
    flowMeander2Scale: 0.0055,
    flowMeander2Speed: 0.16,
    swellDepth: 0.4,
    swellScaleX: 0.0032,
    swellScaleY: 0.0055,
    swellSpeed: 0.07,
    /** Hue. A slow hue map (wavelength 2π / `hueScale` px, tilted `hueAngle` degrees, drifting at
     *  `hueDrift` rad/s) picks the green family per pixel, dithered between neighbours; `hueSpread` is
     *  its range. Crests lean warm (fern) and flanks cool (tide) by `hueCrestBias`. */
    hueScale: 0.0042,
    hueAngle: 58,
    hueDrift: 0.06,
    hueSpread: 0.62,
    hueCrestBias: 0.18,
    /** Text-safe cap: pixels never go above `textCap` shades left of `textCapStart` (fraction of the
     *  width), rising to the full ramp by `textCapEnd`. Narrow screens keep the cap everywhere. */
    textCap: 3,
    textCapStart: 0.55,
    textCapEnd: 0.85,
  },

  monogram: {
    cols: 52,
    rows: 68,
    weight: 800,
    /** Pixels within this distance of the cursor light up in lichen. */
    lichenRadius: 50,
    shimmerSpeed: 1.1,
    shimmerAmount: 0.35,
  },

  wordmark: {
    pitch: 4,
    pitchNarrow: 6,
    weight: 800,
    letterSpacing: "-0.04em",
    repelRadius: 90,
    repelForce: 2.4,
    shockSpeed: 650,
    shockWidth: 26,
    shockForce: 7,
    shockLife: 1.6,
    spring: 0.055,
    damping: 0.84,
    /** Displacement (px) beyond which a particle draws in lichen. */
    lichenDistance: 4,
    sweepSpeed: 110,
    sweepWavelength: 420,
    /** Flood-in on first view: launch delays spread over `floodStagger` s from the nearest corner
     *  outward, plus up to `floodJitter` s of noise; each flight lasts `floodFlight` s along a curve
     *  whose control point is bent sideways by up to `floodBend` of the flight length. */
    floodStagger: 1.3,
    floodJitter: 0.35,
    floodFlight: 0.9,
    floodBend: 0.25,
  },

  easing: {
    duration: 1.4,
    bezier: [0.65, 0, 0.35, 1] as const,
  },
} as const;

/* ------------------------------------------------------------------------------------------------
   Dithering
   ------------------------------------------------------------------------------------------------ */

const BAYER_RAW = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** 8x8 Bayer thresholds in 0..1, row-major. */
export const BAYER8: Float32Array = (() => {
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = (BAYER_RAW[y][x] + 0.5) / 64;
  return out;
})();

/** Threshold for grid cell (x, y). Draw the pixel when brightness v > bayer(x, y). */
export function bayer(x: number, y: number): number {
  return BAYER8[((y & 7) << 3) | (x & 7)];
}

/* ------------------------------------------------------------------------------------------------
   Batched drawing
   ------------------------------------------------------------------------------------------------ */

export const COLORS = {
  dim: tokens.pixelDim,
  ink: tokens.ink,
  lichen: tokens.lichen,
  /** Hero field greens: hue families cool to warm, each five steps darkest first. */
  field: [fieldGreens.tide, fieldGreens.emerald, fieldGreens.moss, fieldGreens.fern],
  label: tokens.label,
  hairline: tokens.hairline,
  borderStrong: tokens.borderStrong,
} as const;

/** One Path2D per colour; every pixel of a frame is appended here and each path is filled once. */
export class PixelBatch {
  dim = new Path2D();
  ink = new Path2D();
  lichen = new Path2D();
  constructor(public readonly size: number) {}

  flush(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = COLORS.dim;
    ctx.fill(this.dim);
    ctx.fillStyle = COLORS.ink;
    ctx.fill(this.ink);
    ctx.fillStyle = COLORS.lichen;
    ctx.fill(this.lichen);
  }
}

/* ------------------------------------------------------------------------------------------------
   Effects
   ------------------------------------------------------------------------------------------------ */

export interface LocalPointer {
  /** Pointer position in the canvas's CSS-pixel space (may be outside the canvas). */
  x: number;
  y: number;
  /** Inside this canvas. */
  inside: boolean;
  /** A pointer is somewhere on the page. */
  present: boolean;
}

export interface EffectEnv {
  reducedMotion: boolean;
  /** Resolved font-family string from next/font (used for canvas text). */
  fontFamily: string;
}

export interface PixelEffect {
  /** Called on mount and whenever the canvas changes size. May be async (font loading). */
  resize(ctx: CanvasRenderingContext2D, width: number, height: number): void | Promise<void>;
  /** Draw one frame. `dt` in seconds (clamped), `now` in seconds. The canvas is already cleared. */
  frame(ctx: CanvasRenderingContext2D, dt: number, now: number): void;
  pointer(p: LocalPointer): void;
  pointerDown(p: LocalPointer): void;
  pointerLeave(): void;
  /** True when nothing is changing, so the host can skip frames (used under reduced motion). */
  idle(): boolean;
  /** Optional entrance: called once, the first time `TUNING.enterThreshold` of the canvas is on screen. */
  enter?(): void;
}

/** Pitch for a canvas of the given width: fewer, larger pixels on narrow screens. */
export function pitchFor(width: number, normal: number, narrow: number): number {
  return width < TUNING.narrowWidth ? narrow : normal;
}

/* ------------------------------------------------------------------------------------------------
   Pointer bus: one set of page-level listeners feeding every registered canvas
   ------------------------------------------------------------------------------------------------ */

type PointerTarget = { el: HTMLElement; effect: PixelEffect };
const targets = new Set<PointerTarget>();
let attached = false;
let present = false;

function localPointer(t: PointerTarget, clientX: number, clientY: number): LocalPointer {
  const r = t.el.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  return { x, y, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height, present };
}

function onMove(e: PointerEvent) {
  present = true;
  for (const t of targets) t.effect.pointer(localPointer(t, e.clientX, e.clientY));
}
function onDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  present = true;
  for (const t of targets) {
    const p = localPointer(t, e.clientX, e.clientY);
    t.effect.pointer(p);
    if (p.inside) t.effect.pointerDown(p);
  }
}
function onLeave() {
  present = false;
  for (const t of targets) t.effect.pointerLeave();
}
function onUp(e: PointerEvent) {
  if (e.pointerType === "touch") onLeave();
}

/** Register a canvas with the pointer bus. Returns an unregister function. */
export function registerPointerTarget(el: HTMLElement, effect: PixelEffect): () => void {
  const t: PointerTarget = { el, effect };
  targets.add(t);
  if (!attached) {
    // Passive listeners: interactions never block scrolling or text selection.
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    attached = true;
  }
  return () => {
    targets.delete(t);
    if (targets.size === 0 && attached) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      attached = false;
    }
  };
}

/* ------------------------------------------------------------------------------------------------
   Text rasterisation
   ------------------------------------------------------------------------------------------------ */

/** Resolve once the font is available for canvas text. */
export async function ensureFont(fontFamily: string, weight = 800): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await document.fonts.load(`${weight} 100px ${fontFamily}`);
  } catch {
    // Fall through: the browser draws with the fallback font.
  }
}

export interface RasterOptions {
  fontFamily: string;
  weight: number;
  /** Fit the text to this fraction of the grid width. */
  fitWidth?: number;
  /** Or fit its ascent+descent to this fraction of the grid height. */
  fitHeight?: number;
  letterSpacing?: string;
}

/**
 * Draw `text` large on an offscreen canvas, then downsample it to `cols x rows` so each grid cell
 * gets an anti-aliased coverage value in 0..1.
 */
export function rasterizeText(text: string, cols: number, rows: number, opts: RasterOptions): Float32Array {
  const coverage = new Float32Array(cols * rows);
  if (typeof document === "undefined" || cols < 2 || rows < 2) return coverage;
  const scale = 4;
  const big = document.createElement("canvas");
  big.width = cols * scale;
  big.height = rows * scale;
  const bctx = big.getContext("2d");
  if (!bctx) return coverage;

  const applySpacing = (c: CanvasRenderingContext2D) => {
    if (opts.letterSpacing && "letterSpacing" in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = opts.letterSpacing;
  };

  // Measure at a reference size, then scale to fit.
  bctx.font = `${opts.weight} 100px ${opts.fontFamily}`;
  applySpacing(bctx);
  const m = bctx.measureText(text);
  const w100 = m.width;
  const h100 = (m.actualBoundingBoxAscent || 70) + (m.actualBoundingBoxDescent || 20);
  let size = 100;
  if (opts.fitWidth) size = Math.min(size * ((big.width * opts.fitWidth) / Math.max(1, w100)), Number.MAX_SAFE_INTEGER);
  if (opts.fitHeight) {
    const byHeight = 100 * ((big.height * opts.fitHeight) / Math.max(1, h100));
    size = opts.fitWidth ? Math.min(size, byHeight) : byHeight;
  }
  bctx.font = `${opts.weight} ${size}px ${opts.fontFamily}`;
  applySpacing(bctx);
  const mm = bctx.measureText(text);
  const ascent = mm.actualBoundingBoxAscent || size * 0.7;
  const descent = mm.actualBoundingBoxDescent || size * 0.2;
  bctx.fillStyle = "#fff";
  bctx.textAlign = "center";
  bctx.textBaseline = "alphabetic";
  bctx.fillText(text, big.width / 2, big.height / 2 + (ascent - descent) / 2);

  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) return coverage;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(big, 0, 0, cols, rows);
  const data = sctx.getImageData(0, 0, cols, rows).data;
  for (let i = 0; i < cols * rows; i++) coverage[i] = data[i * 4 + 3] / 255;
  return coverage;
}

/* ------------------------------------------------------------------------------------------------
   Static layers: pixels that never change (the unlit grid) are drawn once to an offscreen canvas
   and composited each frame, so the per-frame path only holds the lit pixels.
   ------------------------------------------------------------------------------------------------ */

export function dprOf(ctx: CanvasRenderingContext2D, width: number): number {
  return ctx.canvas.width / Math.max(1, width);
}

export function makeLayer(width: number, height: number, dpr: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * dpr));
  c.height = Math.max(1, Math.round(height * dpr));
  const x = c.getContext("2d");
  if (!x) return null;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(x);
  return c;
}

/* ------------------------------------------------------------------------------------------------
   Small maths
   ------------------------------------------------------------------------------------------------ */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
