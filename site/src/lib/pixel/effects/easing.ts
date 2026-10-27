import { TUNING, COLORS, type EffectEnv, type PixelEffect } from "../pixelEngine";

/**
 * FIG. 03: cubic-bezier(.65, 0, .35, 1) with its control handles and a lichen marker that travels
 * the curve on a 1.4 s loop.
 */
export function easing(env: EffectEnv): PixelEffect {
  const [x1, y1, x2, y2] = TUNING.easing.bezier;
  let w = 0;
  let h = 0;
  let drawn = false;

  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  /** Solve x(u) = t by bisection (x is monotonic for a valid easing). */
  const solve = (t: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  return {
    resize(_ctx, width, height) {
      w = width;
      h = height;
      drawn = false;
    },

    frame(ctx, _dt, now) {
      drawn = true;
      const pad = Math.max(28, Math.min(w, h) * 0.16);
      const left = pad;
      const top = pad;
      const pw = w - pad * 2;
      const ph = h - pad * 2;
      const X = (t: number) => left + t * pw;
      const Y = (v: number) => top + (1 - v) * ph;

      // Grid
      ctx.strokeStyle = COLORS.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const gx = Math.round(X(i / 4)) + 0.5;
        const gy = Math.round(Y(i / 4)) + 0.5;
        ctx.moveTo(gx, top);
        ctx.lineTo(gx, top + ph);
        ctx.moveTo(left, gy);
        ctx.lineTo(left + pw, gy);
      }
      ctx.stroke();

      // Handles
      ctx.strokeStyle = COLORS.label;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(x1), Y(y1));
      ctx.moveTo(X(1), Y(1));
      ctx.lineTo(X(x2), Y(y2));
      ctx.stroke();
      ctx.fillStyle = COLORS.borderStrong;
      ctx.strokeStyle = COLORS.label;
      for (const [hx, hy] of [
        [x1, y1],
        [x2, y2],
      ]) {
        ctx.fillRect(X(hx) - 3.5, Y(hy) - 3.5, 7, 7);
        ctx.strokeRect(X(hx) - 3.5, Y(hy) - 3.5, 7, 7);
      }

      // Curve
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = i / 64;
        const px = X(bx(u));
        const py = Y(by(u));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Endpoints
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(X(0) - 2.5, Y(0) - 2.5, 5, 5);
      ctx.fillRect(X(1) - 2.5, Y(1) - 2.5, 5, 5);

      // Marker: travels the curve over `duration`, holds still under reduced motion.
      const t = env.reducedMotion ? 0.5 : (now % TUNING.easing.duration) / TUNING.easing.duration;
      const u = solve(t);
      const mx = X(bx(u));
      const my = Y(by(u));
      ctx.fillStyle = COLORS.lichen;
      ctx.fillRect(Math.round(mx) - 4, Math.round(my) - 4, 8, 8);
      // Progress tick on the time axis.
      ctx.fillRect(Math.round(X(t)) - 1, top + ph - 6, 2, 6);
    },

    pointer() {},
    pointerDown() {},
    pointerLeave() {},
    idle() {
      return env.reducedMotion && drawn;
    },
  };
}
