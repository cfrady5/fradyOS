import { TUNING, PixelBatch, bayer, ensureFont, rasterizeText, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

/**
 * FIG. 02: the "f" monogram rasterised to a 52x68 grid, dithered with a slow vertical shimmer.
 * Pixels near the cursor light up in lichen.
 */
export function monogram(env: EffectEnv): PixelEffect {
  const T = TUNING.monogram;
  let w = 0;
  let h = 0;
  let coverage: Float32Array = new Float32Array(T.cols * T.rows);
  let ready = false;
  let time = 0;
  let ptr: LocalPointer = { x: -1e4, y: -1e4, inside: false, present: false };
  let dirty = true;

  return {
    async resize(_ctx, width, height) {
      w = width;
      h = height;
      if (!ready) {
        await ensureFont(env.fontFamily, T.weight);
        coverage = rasterizeText("f", T.cols, T.rows, { fontFamily: env.fontFamily, weight: T.weight, fitHeight: 0.82 });
        ready = true;
      }
      dirty = true;
    },

    frame(ctx, dt) {
      if (!env.reducedMotion) time += dt;
      dirty = false;
      const pitch = Math.min(w / T.cols, h / T.rows);
      const ox = (w - pitch * T.cols) / 2;
      const oy = (h - pitch * T.rows) / 2;
      const size = pitch * TUNING.pixelFill;
      const off = (pitch - size) / 2;
      const batch = new PixelBatch(size);
      const r2 = T.lichenRadius * T.lichenRadius;
      for (let y = 0; y < T.rows; y++) {
        const shimmer = 1 - T.shimmerAmount + T.shimmerAmount * (0.5 + 0.5 * Math.sin(y * 0.28 - time * T.shimmerSpeed));
        const py = oy + y * pitch + off;
        for (let x = 0; x < T.cols; x++) {
          const px = ox + x * pitch + off;
          const c = ready ? coverage[y * T.cols + x] : 0;
          if (c < 0.05) {
            // Sparse background texture so the frame reads as a field, not empty space.
            if (0.06 > bayer(x, y)) batch.dim.rect(px, py, size, size);
            continue;
          }
          let v = c * shimmer;
          let near = false;
          if (ptr.inside) {
            const dx = px + size / 2 - ptr.x;
            const dy = py + size / 2 - ptr.y;
            if (dx * dx + dy * dy < r2) {
              near = true;
              v = Math.min(1, v + 0.5);
            }
          }
          if (v > bayer(x, y)) {
            if (near) batch.lichen.rect(px, py, size, size);
            else batch.ink.rect(px, py, size, size);
          } else {
            batch.dim.rect(px, py, size, size);
          }
        }
      }
      batch.flush(ctx);
    },

    pointer(p) {
      if (p.inside || ptr.inside) dirty = true;
      ptr = p;
    },
    pointerDown() {},
    pointerLeave() {
      ptr = { x: -1e4, y: -1e4, inside: false, present: false };
      dirty = true;
    },
    idle() {
      return !ptr.inside && !dirty;
    },
  };
}
