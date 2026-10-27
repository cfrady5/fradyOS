import { TUNING, COLORS, bayer, dprOf, makeLayer, pitchFor, smoothstep, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

type Ripple = { x: number; y: number; t0: number };

/**
 * Hero background: a slow sine-noise field, calm on the left, lit by a gaussian around the cursor,
 * with click ripples. Lit pixels are dark greens (moss, mossLit) close to the unlit grid's
 * luminance, so the headline and copy on top stay readable wherever the light sits.
 */
export function heroField(env: EffectEnv): PixelEffect {
  const T = TUNING.hero;
  let w = 0;
  let h = 0;
  let pitch: number = T.pitch;
  let cols = 0;
  let rows = 0;
  let fade = new Float32Array(0);
  let sx1 = new Float32Array(0);
  let sx2 = new Float32Array(0);
  let sy1 = new Float32Array(0);
  let sy2 = new Float32Array(0);
  let time = 0;
  let ptr: LocalPointer = { x: -1e4, y: -1e4, inside: false, present: false };
  const ripples: Ripple[] = [];
  let lastNow = 0;
  let dimLayer: HTMLCanvasElement | null = null;

  return {
    resize(ctx, width, height) {
      w = width;
      h = height;
      pitch = pitchFor(width, T.pitch, T.pitchNarrow);
      cols = Math.ceil(w / pitch) + 1;
      rows = Math.ceil(h / pitch) + 1;
      // The unlit grid never changes: draw it once.
      const size = pitch * TUNING.pixelFill;
      const off = (pitch - size) / 2;
      dimLayer = makeLayer(w, h, dprOf(ctx, w), (lctx) => {
        const p = new Path2D();
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) p.rect(x * pitch + off, y * pitch + off, size, size);
        lctx.fillStyle = COLORS.dim;
        lctx.fill(p);
      });
      fade = new Float32Array(cols);
      for (let x = 0; x < cols; x++) fade[x] = T.leftFadeFloor + (1 - T.leftFadeFloor) * smoothstep(T.leftFadeStart, T.leftFadeEnd, (x * pitch) / w);
      sx1 = new Float32Array(cols);
      sx2 = new Float32Array(cols);
      sy1 = new Float32Array(rows);
      sy2 = new Float32Array(rows);
    },

    frame(ctx, dt, now) {
      lastNow = now;
      if (!env.reducedMotion) time += dt * T.waveSpeed;
      // Separable waves: two sine tables per axis, so the per-cell cost is two multiplies.
      for (let x = 0; x < cols; x++) {
        sx1[x] = Math.sin(x * 0.11 + time * 2.6);
        sx2[x] = Math.sin(x * 0.047 - time * 1.1);
      }
      for (let y = 0; y < rows; y++) {
        sy1[y] = Math.sin(y * 0.13 - time * 2.0);
        sy2[y] = Math.sin(y * 0.071 + time * 1.6);
      }
      // Ripples age out.
      for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > T.rippleLife) ripples.splice(i, 1);
      const rip = ripples.map((r) => ({ x: r.x, y: r.y, r: T.rippleSpeed * (now - r.t0), a: 1 - (now - r.t0) / T.rippleLife }));

      const size = pitch * TUNING.pixelFill;
      const off = (pitch - size) / 2;
      const moss = new Path2D();
      const mossLit = new Path2D();
      const sig2 = 2 * T.lightSigma * T.lightSigma;
      const lightReach2 = (3.2 * T.lightSigma) ** 2;
      const rs2 = 2 * T.rippleSigma * T.rippleSigma;
      const rippleReach = 4 * T.rippleSigma;
      const lit = ptr.inside || ptr.present;
      if (dimLayer) ctx.drawImage(dimLayer, 0, 0, w, h);

      for (let y = 0; y < rows; y++) {
        const cy = y * pitch + pitch / 2;
        const py = y * pitch + off;
        const a1 = sy1[y];
        const a2 = sy2[y];
        for (let x = 0; x < cols; x++) {
          const cx = x * pitch + pitch / 2;
          let v = (T.base + T.amplitude * (0.6 * sx1[x] * a1 + 0.4 * sx2[x] * a2)) * fade[x];
          if (lit) {
            const dx = cx - ptr.x;
            const dy = cy - ptr.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < lightReach2) v += T.lightGain * Math.exp(-d2 / sig2);
          }
          let ripple = 0;
          for (let k = 0; k < rip.length; k++) {
            const rp = rip[k];
            const dx = cx - rp.x;
            const dy = cy - rp.y;
            const dd = Math.sqrt(dx * dx + dy * dy) - rp.r;
            if (dd > -rippleReach && dd < rippleReach) {
              const g = Math.exp(-(dd * dd) / rs2) * rp.a;
              ripple += g;
              v += g * T.rippleGain;
            }
          }
          if (v > bayer(x, y)) {
            (ripple > 0.22 || v > T.peakThreshold ? mossLit : moss).rect(x * pitch + off, py, size, size);
          }
        }
      }
      ctx.fillStyle = COLORS.moss;
      ctx.fill(moss);
      ctx.fillStyle = COLORS.mossLit;
      ctx.fill(mossLit);
    },

    pointer(p) {
      ptr = p;
    },
    pointerDown(p) {
      ripples.push({ x: p.x, y: p.y, t0: lastNow });
      if (ripples.length > 6) ripples.shift();
    },
    pointerLeave() {
      ptr = { x: -1e4, y: -1e4, inside: false, present: false };
    },
    idle() {
      return !ptr.present && ripples.length === 0;
    },
  };
}
