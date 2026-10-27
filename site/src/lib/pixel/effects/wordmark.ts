import { TUNING, PixelBatch, bayer, ensureFont, pitchFor, rasterizeText, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

type Shock = { x: number; y: number; t0: number };

/**
 * FIG. 04: "frady" as a particle system. Every covered grid cell is a particle with a home
 * position; the cursor repels, clicks send a shockwave, springs pull everything back.
 */
export function wordmark(env: EffectEnv): PixelEffect {
  const T = TUNING.wordmark;
  let w = 0;
  let h = 0;
  let pitch: number = T.pitch;
  let count = 0;
  let hx = new Float32Array(0);
  let hy = new Float32Array(0);
  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let col = new Uint16Array(0);
  let row = new Uint16Array(0);
  let time = 0;
  let settled = false;
  let ptr: LocalPointer = { x: -1e4, y: -1e4, inside: false, present: false };
  const shocks: Shock[] = [];
  let lastNow = 0;
  let fontReady = false;

  function build() {
    const cols = Math.max(4, Math.floor(w / pitch));
    const rows = Math.max(4, Math.floor(h / pitch));
    const cov = rasterizeText("frady", cols, rows, { fontFamily: env.fontFamily, weight: T.weight, fitWidth: 0.9, fitHeight: 0.8, letterSpacing: T.letterSpacing });
    const ox = (w - cols * pitch) / 2;
    const oy = (h - rows * pitch) / 2;
    let n = 0;
    for (let i = 0; i < cov.length; i++) if (cov[i] > 0.45) n++;
    count = n;
    hx = new Float32Array(n);
    hy = new Float32Array(n);
    x = new Float32Array(n);
    y = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    col = new Uint16Array(n);
    row = new Uint16Array(n);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cov[r * cols + c] <= 0.45) continue;
        hx[k] = ox + c * pitch + pitch / 2;
        hy[k] = oy + r * pitch + pitch / 2;
        col[k] = c;
        row[k] = r;
        if (env.reducedMotion) {
          x[k] = hx[k];
          y[k] = hy[k];
        } else {
          // Start scattered; the springs fly everything into place on load.
          x[k] = Math.random() * w;
          y[k] = hy[k] + (Math.random() - 0.5) * h * 2.2;
        }
        k++;
      }
    }
    settled = env.reducedMotion;
  }

  return {
    async resize(_ctx, width, height) {
      w = width;
      h = height;
      pitch = pitchFor(width, T.pitch, T.pitchNarrow);
      if (!fontReady) {
        await ensureFont(env.fontFamily, T.weight);
        fontReady = true;
      }
      build();
    },

    frame(ctx, dt, now) {
      lastNow = now;
      if (!env.reducedMotion) time += dt;
      for (let i = shocks.length - 1; i >= 0; i--) if (now - shocks[i].t0 > T.shockLife) shocks.splice(i, 1);
      const sh = shocks.map((s) => ({ x: s.x, y: s.y, r: T.shockSpeed * (now - s.t0), a: 1 - (now - s.t0) / T.shockLife }));
      const R = T.repelRadius;
      const R2 = R * R;
      const size = pitch * TUNING.pixelFill;
      const half = size / 2;
      const batch = new PixelBatch(size);
      const sweepK = (Math.PI * 2) / T.sweepWavelength;
      const sweepX = time * T.sweepSpeed;
      let moving = 0;

      for (let i = 0; i < count; i++) {
        let ax = 0;
        let ay = 0;
        if (ptr.inside) {
          const dx = x[i] - ptr.x;
          const dy = y[i] - ptr.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((1 - d / R) * (1 - d / R) * T.repelForce) / d;
            ax += dx * f;
            ay += dy * f;
          }
        }
        for (let q = 0; q < sh.length; q++) {
          const dx = x[i] - sh[q].x;
          const dy = y[i] - sh[q].y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const dd = Math.abs(d - sh[q].r);
          if (dd < T.shockWidth) {
            const f = ((1 - dd / T.shockWidth) * T.shockForce * sh[q].a) / d;
            ax += dx * f;
            ay += dy * f;
          }
        }
        // Spring to home, then damping.
        ax += (hx[i] - x[i]) * T.spring;
        ay += (hy[i] - y[i]) * T.spring;
        vx[i] = (vx[i] + ax) * T.damping;
        vy[i] = (vy[i] + ay) * T.damping;
        x[i] += vx[i];
        y[i] += vy[i];

        const ddx = x[i] - hx[i];
        const ddy = y[i] - hy[i];
        const disp = Math.abs(ddx) + Math.abs(ddy);
        const px = x[i] - half;
        const py = y[i] - half;
        if (disp > T.lichenDistance) {
          moving++;
          batch.lichen.rect(px, py, size, size);
        } else {
          // Settled: dithered with a slow horizontal light sweep.
          const v = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin((hx[i] - sweepX) * sweepK));
          if (v > bayer(col[i], row[i])) batch.ink.rect(px, py, size, size);
          else batch.dim.rect(px, py, size, size);
        }
      }
      settled = moving === 0;
      batch.flush(ctx);
    },

    pointer(p) {
      ptr = p;
    },
    pointerDown(p) {
      shocks.push({ x: p.x, y: p.y, t0: lastNow });
      if (shocks.length > 4) shocks.shift();
    },
    pointerLeave() {
      ptr = { x: -1e4, y: -1e4, inside: false, present: false };
    },
    idle() {
      return settled && !ptr.inside && shocks.length === 0;
    },
  };
}
