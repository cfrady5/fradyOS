import { TUNING, COLORS, PixelBatch, bayer, dprOf, makeLayer, pitchFor, lerpFactor, type EffectEnv, type LocalPointer, type PixelEffect } from "../pixelEngine";

type Pulse = { x: number; y: number; t0: number };

/**
 * FIG. 01: a dithered sphere lit by a Lambert light that follows the cursor (or slowly orbits).
 * Specular pixels and click pulses draw in lichen.
 */
export function orb(env: EffectEnv): PixelEffect {
  const T = TUNING.orb;
  let w = 0;
  let h = 0;
  let n = 0;
  let pitch: number = T.pitch;
  let ox = 0;
  let oy = 0;
  let nx = new Float32Array(0);
  let ny = new Float32Array(0);
  let nz = new Float32Array(0);
  let inside = new Uint8Array(0);
  const L = { x: 0.45, y: -0.5, z: 0.74 };
  let ptr: LocalPointer = { x: 0, y: 0, inside: false, present: false };
  const pulses: Pulse[] = [];
  let lastNow = 0;
  let orbit = 0;
  let dimLayer: HTMLCanvasElement | null = null;

  function normalize(v: { x: number; y: number; z: number }) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    v.x /= len;
    v.y /= len;
    v.z /= len;
    return v;
  }

  return {
    resize(ctx, width, height) {
      w = width;
      h = height;
      pitch = pitchFor(width, T.pitch, T.pitchNarrow);
      const size = Math.min(w, h);
      n = Math.max(8, Math.floor(size / pitch));
      ox = (w - n * pitch) / 2;
      oy = (h - n * pitch) / 2;
      nx = new Float32Array(n * n);
      ny = new Float32Array(n * n);
      nz = new Float32Array(n * n);
      inside = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = ((i + 0.5) / n) * 2 - 1;
          const y = ((j + 0.5) / n) * 2 - 1;
          const r2 = x * x + y * y;
          const k = j * n + i;
          if (r2 > 1) continue;
          inside[k] = 1;
          nx[k] = x;
          ny[k] = y;
          nz[k] = Math.sqrt(1 - r2);
        }
      }
      // The sphere's unlit footprint is static: draw it once.
      const ps = pitch * TUNING.pixelFill;
      const po = (pitch - ps) / 2;
      dimLayer = makeLayer(w, h, dprOf(ctx, w), (lctx) => {
        const p = new Path2D();
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (inside[j * n + i]) p.rect(ox + i * pitch + po, oy + j * pitch + po, ps, ps);
        lctx.fillStyle = COLORS.dim;
        lctx.fill(p);
      });
    },

    frame(ctx, dt, now) {
      lastNow = now;
      const cx = ox + (n * pitch) / 2;
      const cy = oy + (n * pitch) / 2;
      const R = (n * pitch) / 2;
      // Light target: toward the cursor relative to the orb centre, or a slow orbit.
      const target = { x: 0, y: 0, z: 0.7 };
      if (ptr.present) {
        let dx = (ptr.x - cx) / R;
        let dy = (ptr.y - cy) / R;
        const len = Math.hypot(dx, dy);
        if (len > 1.15) {
          dx /= len / 1.15;
          dy /= len / 1.15;
        }
        target.x = dx;
        target.y = dy;
        target.z = 0.95 - 0.55 * Math.min(1, len);
      } else {
        if (!env.reducedMotion) orbit += dt * T.orbitSpeed;
        target.x = Math.cos(orbit) * 0.8;
        target.y = Math.sin(orbit * 0.7) * 0.55;
        target.z = 0.62;
      }
      normalize(target);
      const k = lerpFactor(T.lerp, dt);
      L.x += (target.x - L.x) * k;
      L.y += (target.y - L.y) * k;
      L.z += (target.z - L.z) * k;
      normalize(L);

      for (let i = pulses.length - 1; i >= 0; i--) if (now - pulses[i].t0 > T.pulseLife) pulses.splice(i, 1);
      const pl = pulses.map((p) => ({ x: p.x, y: p.y, r: T.pulseSpeed * (now - p.t0), a: 1 - (now - p.t0) / T.pulseLife }));
      const ps2 = 2 * T.pulseSigma * T.pulseSigma;

      const size = pitch * TUNING.pixelFill;
      const off = (pitch - size) / 2;
      const batch = new PixelBatch(size);
      if (dimLayer) ctx.drawImage(dimLayer, 0, 0, w, h);
      for (let j = 0; j < n; j++) {
        const py = oy + j * pitch + off;
        for (let i = 0; i < n; i++) {
          const idx = j * n + i;
          if (!inside[idx]) continue;
          const px = ox + i * pitch + off;
          const dot = nx[idx] * L.x + ny[idx] * L.y + nz[idx] * L.z;
          const lit = dot > 0 ? dot : 0;
          let v = T.ambient + 0.97 * Math.pow(lit, T.exponent);
          let lichen = lit > T.specular;
          if (pl.length) {
            const ccx = px + size / 2;
            const ccy = py + size / 2;
            for (let q = 0; q < pl.length; q++) {
              const dd = Math.hypot(ccx - pl[q].x, ccy - pl[q].y) - pl[q].r;
              if (dd > -40 && dd < 40) {
                const g = Math.exp(-(dd * dd) / ps2) * pl[q].a;
                v += g;
                if (g > 0.3) lichen = true;
              }
            }
          }
          if (v > bayer(i, j)) {
            if (lichen) batch.lichen.rect(px, py, size, size);
            else if (v > 0.45) batch.ink.rect(px, py, size, size);
            else batch.inkMid.rect(px, py, size, size);
          }
        }
      }
      batch.flush(ctx, 0.55);
    },

    pointer(p) {
      ptr = p;
    },
    pointerDown(p) {
      pulses.push({ x: p.x, y: p.y, t0: lastNow });
      if (pulses.length > 4) pulses.shift();
    },
    pointerLeave() {
      ptr = { x: 0, y: 0, inside: false, present: false };
    },
    idle() {
      return !ptr.present && pulses.length === 0;
    },
  };
}
