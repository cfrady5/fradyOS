import { TUNING, COLORS, bayer, dprOf, makeLayer, pitchFor, smoothstep, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

type Ripple = { x: number; y: number; t0: number };

/**
 * Hero background. Every cell gets a brightness in shade levels (0 = the unlit grid, 1..5 = moss1..moss5)
 * from four sources: a steady green wave flowing across the field, a faint sine-noise sparkle, a
 * gaussian light around the cursor, and click ripples. The level is ordered-dithered between
 * neighbouring shades, so the wave reads as smooth bands of green. Under the text column the level is
 * capped at `textCap`, keeping the headline and copy as readable as on the plain grid.
 */
export function heroField(env: EffectEnv): PixelEffect {
  const T = TUNING.hero;
  const SHADES = COLORS.moss.length;
  let w = 0;
  let h = 0;
  let pitch: number = T.pitch;
  let cols = 0;
  let rows = 0;
  // Per column: sparkle fade, wave fade, text cap, and the column halves of each wave's phase.
  let fade = new Float32Array(0);
  let flowFade = new Float32Array(0);
  let cap = new Float32Array(0);
  let aSinX = new Float32Array(0);
  let aCosX = new Float32Array(0);
  let bSinX = new Float32Array(0);
  let bCosX = new Float32Array(0);
  // Per row, refreshed each frame: sparkle tables and the row halves of each wave's phase.
  let sx1 = new Float32Array(0);
  let sx2 = new Float32Array(0);
  let sy1 = new Float32Array(0);
  let sy2 = new Float32Array(0);
  let aSinY = new Float32Array(0);
  let aCosY = new Float32Array(0);
  let bSinY = new Float32Array(0);
  let bCosY = new Float32Array(0);
  let time = 0;
  let ptr: LocalPointer = { x: -1e4, y: -1e4, inside: false, present: false };
  const ripples: Ripple[] = [];
  let lastNow = 0;
  let dimLayer: HTMLCanvasElement | null = null;

  // Wave vectors: k = 2π / wavelength along the travel direction.
  const rad = Math.PI / 180;
  const kA = (Math.PI * 2) / T.flowWavelength;
  const kB = (Math.PI * 2) / T.flow2Wavelength;
  const kAx = kA * Math.cos(T.flowAngle * rad);
  const kAy = kA * Math.sin(T.flowAngle * rad);
  const kBx = kB * Math.cos(T.flow2Angle * rad);
  const kBy = kB * Math.sin(T.flow2Angle * rad);

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
      // Phones stack the text across the whole width, so the cap holds everywhere there.
      const narrow = width < TUNING.narrowWidth;
      fade = new Float32Array(cols);
      flowFade = new Float32Array(cols);
      cap = new Float32Array(cols);
      aSinX = new Float32Array(cols);
      aCosX = new Float32Array(cols);
      bSinX = new Float32Array(cols);
      bCosX = new Float32Array(cols);
      for (let x = 0; x < cols; x++) {
        const u = (x * pitch) / w;
        const s = smoothstep(T.leftFadeStart, T.leftFadeEnd, u);
        fade[x] = T.leftFadeFloor + (1 - T.leftFadeFloor) * s;
        flowFade[x] = T.flowFloor + (1 - T.flowFloor) * s;
        cap[x] = narrow ? T.textCap : T.textCap + (SHADES - T.textCap) * smoothstep(T.textCapStart, T.textCapEnd, u);
        const cx = x * pitch + pitch / 2;
        aSinX[x] = Math.sin(kAx * cx);
        aCosX[x] = Math.cos(kAx * cx);
        bSinX[x] = Math.sin(kBx * cx);
        bCosX[x] = Math.cos(kBx * cx);
      }
      sx1 = new Float32Array(cols);
      sx2 = new Float32Array(cols);
      sy1 = new Float32Array(rows);
      sy2 = new Float32Array(rows);
      aSinY = new Float32Array(rows);
      aCosY = new Float32Array(rows);
      bSinY = new Float32Array(rows);
      bCosY = new Float32Array(rows);
    },

    frame(ctx, dt, now) {
      lastNow = now;
      if (!env.reducedMotion) time += dt;
      const nt = time * T.waveSpeed;
      // Sparkle: separable sines, two per axis.
      for (let x = 0; x < cols; x++) {
        sx1[x] = Math.sin(x * 0.11 + nt * 2.6);
        sx2[x] = Math.sin(x * 0.047 - nt * 1.1);
      }
      // Wave rows: phase = column part + row part, so sin(phase) = sinX·cosY + cosX·sinY per cell.
      // The row part carries the travel (-ωt) and the meander that bends the fronts.
      const wA = kA * T.flowSpeed * time;
      const wB = kB * T.flow2Speed * time;
      for (let y = 0; y < rows; y++) {
        sy1[y] = Math.sin(y * 0.13 - nt * 2.0);
        sy2[y] = Math.sin(y * 0.071 + nt * 1.6);
        const cy = y * pitch + pitch / 2;
        const meander = T.flowMeander * Math.sin(cy * T.flowMeanderScale + time * T.flowMeanderSpeed);
        const pa = kAy * cy - wA + meander;
        const pb = kBy * cy - wB;
        aSinY[y] = Math.sin(pa);
        aCosY[y] = Math.cos(pa);
        bSinY[y] = Math.sin(pb);
        bCosY[y] = Math.cos(pb);
      }
      // Ripples age out.
      for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > T.rippleLife) ripples.splice(i, 1);
      const rip = ripples.map((r) => ({ x: r.x, y: r.y, r: T.rippleSpeed * (now - r.t0), a: 1 - (now - r.t0) / T.rippleLife }));

      const size = pitch * TUNING.pixelFill;
      const off = (pitch - size) / 2;
      const paths = COLORS.moss.map(() => new Path2D());
      const sig2 = 2 * T.lightSigma * T.lightSigma;
      const lightReach2 = (3.2 * T.lightSigma) ** 2;
      const rs2 = 2 * T.rippleSigma * T.rippleSigma;
      const rippleReach = 4 * T.rippleSigma;
      const lit = ptr.inside || ptr.present;
      const norm = 1 / (1 + T.flow2Weight);
      if (dimLayer) ctx.drawImage(dimLayer, 0, 0, w, h);

      for (let y = 0; y < rows; y++) {
        const cy = y * pitch + pitch / 2;
        const py = y * pitch + off;
        const a1 = sy1[y];
        const a2 = sy2[y];
        const as = aSinY[y];
        const ac = aCosY[y];
        const bs = bSinY[y];
        const bc = bCosY[y];
        for (let x = 0; x < cols; x++) {
          const cx = x * pitch + pitch / 2;
          // Wave crests: (0.5 + 0.5 sin)^3 narrows the bright bands and widens the dark troughs.
          let a = 0.5 + 0.5 * (aSinX[x] * ac + aCosX[x] * as);
          let b = 0.5 + 0.5 * (bSinX[x] * bc + bCosX[x] * bs);
          a = a * a * a;
          b = b * b * b;
          let q = (a + T.flow2Weight * b) * norm * T.flowGain * flowFade[x];
          q += (T.base + T.amplitude * (0.6 * sx1[x] * a1 + 0.4 * sx2[x] * a2)) * fade[x];
          if (lit) {
            const dx = cx - ptr.x;
            const dy = cy - ptr.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < lightReach2) q += T.lightGain * Math.exp(-d2 / sig2);
          }
          for (let k = 0; k < rip.length; k++) {
            const rp = rip[k];
            const dx = cx - rp.x;
            const dy = cy - rp.y;
            const dd = Math.sqrt(dx * dx + dy * dy) - rp.r;
            if (dd > -rippleReach && dd < rippleReach) q += Math.exp(-(dd * dd) / rs2) * rp.a * T.rippleGain;
          }
          // Ordered dithering between neighbouring shades, then the text-safe cap (dithered too, so
          // the boundary has no seam).
          const t = bayer(x, y);
          const f = Math.floor(q);
          let level = f + (q - f > t ? 1 : 0);
          const c = cap[x];
          const cf = Math.floor(c);
          const lim = cf + (c - cf > t ? 1 : 0);
          if (level > lim) level = lim;
          if (level <= 0) continue;
          paths[level - 1].rect(x * pitch + off, py, size, size);
        }
      }
      for (let i = 0; i < SHADES; i++) {
        ctx.fillStyle = COLORS.moss[i];
        ctx.fill(paths[i]);
      }
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
