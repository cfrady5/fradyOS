import { TUNING, PixelBatch, bayer, ensureFont, pitchFor, rasterizeText, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

type Shock = { x: number; y: number; t0: number };

/**
 * FIG. 03: "frady" as a particle system. Every covered grid cell is a particle with a home position.
 * The first time the frame scrolls into view, the particles flood in from its four corners: each
 * one waits for its launch time, then flies along a curved path from its nearest corner to home,
 * nearest homes first. Once landed, the cursor repels, clicks send a shockwave, and springs pull
 * everything back. Reduced motion skips the flood and shows the word in place.
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
  // Flood-in: start point, quadratic-curve control point, launch delay (s), and whether it has landed.
  let sx = new Float32Array(0);
  let sy = new Float32Array(0);
  let qx = new Float32Array(0);
  let qy = new Float32Array(0);
  let delay = new Float32Array(0);
  let landed = new Uint8Array(0);
  let entered = false;
  /** Time the flood began (s), or -1 before it has. */
  let floodStart = -1;
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
    sx = new Float32Array(n);
    sy = new Float32Array(n);
    qx = new Float32Array(n);
    qy = new Float32Array(n);
    delay = new Float32Array(n);
    landed = new Uint8Array(n);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cov[r * cols + c] <= 0.45) continue;
        hx[k] = x[k] = ox + c * pitch + pitch / 2;
        hy[k] = y[k] = oy + r * pitch + pitch / 2;
        col[k] = c;
        row[k] = r;
        k++;
      }
    }
    // A rebuild after the flood has begun (a resize) shows the word in place rather than replaying it.
    if (env.reducedMotion || floodStart >= 0) landed.fill(1);
    else planFlood();
    settled = landed.length === 0 || landed[0] === 1;
  }

  /** Assign each particle its nearest corner, a curved path home, and a launch delay. */
  function planFlood() {
    const dist = new Float32Array(count);
    let minD = Infinity;
    let maxD = 0;
    for (let i = 0; i < count; i++) {
      const left = hx[i] < w / 2;
      const top = hy[i] < h / 2;
      // Emit from just inside the corner, with a little spread so the stream has width.
      sx[i] = left ? Math.random() * 6 : w - Math.random() * 6;
      sy[i] = top ? Math.random() * 6 : h - Math.random() * 6;
      const dx = hx[i] - sx[i];
      const dy = hy[i] - sy[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dist[i] = d;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      // Control point: the midpoint pushed sideways, so each corner sprays a fan of curved streams.
      const bend = (Math.random() * 2 - 1) * T.floodBend;
      qx[i] = (sx[i] + hx[i]) / 2 - dy * bend;
      qy[i] = (sy[i] + hy[i]) / 2 + dx * bend;
    }
    const span = Math.max(1, maxD - minD);
    for (let i = 0; i < count; i++) delay[i] = (T.floodStagger * (dist[i] - minD)) / span + Math.random() * T.floodJitter;
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
      if (entered && floodStart < 0 && count > 0) floodStart = now;
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
        if (!landed[i]) {
          moving++;
          // Parked until the flood starts and this particle's launch time comes round: not drawn.
          if (floodStart < 0) continue;
          const t = (now - floodStart - delay[i]) / T.floodFlight;
          if (t <= 0) continue;
          if (t >= 1) {
            landed[i] = 1;
            x[i] = hx[i];
            y[i] = hy[i];
            vx[i] = 0;
            vy[i] = 0;
          } else {
            // Ease in and out along the quadratic curve corner -> control -> home, drawn in lichen.
            // Easing in keeps a visible source at each corner; easing out lands without a jolt.
            const e = t < 0.5 ? 4 * t * t * t : 1 - ((2 - 2 * t) * (2 - 2 * t) * (2 - 2 * t)) / 2;
            const u = 1 - e;
            x[i] = u * u * sx[i] + 2 * u * e * qx[i] + e * e * hx[i];
            y[i] = u * u * sy[i] + 2 * u * e * qy[i] + e * e * hy[i];
            batch.lichen.rect(x[i] - half, y[i] - half, size, size);
            continue;
          }
        }

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

    enter() {
      entered = true;
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
