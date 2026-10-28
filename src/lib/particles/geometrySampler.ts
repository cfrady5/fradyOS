import type { GeometryKind } from "@/lib/ai/schema";
import { fitToCount, hashString, rng } from "./types";

type Pt = { x: number; y: number; z: number; e: number };

/**
 * Mathematical point distributions. Everything is built in a unit-ish box centred on the origin,
 * then scaled to `fit` (the formation's half-height in world units). Pure functions, so they run in
 * tests and never need a canvas.
 */
export function sampleGeometry(kind: GeometryKind, count: number, seedText: string = kind, fit = 1): { positions: Float32Array; emphasis: Float32Array; colors: null } {
  const random = rng(hashString(seedText + kind));
  const pts = GENERATORS[kind](Math.min(count, 60_000), random);
  for (const p of pts) {
    p.x *= fit;
    p.y *= fit;
    p.z *= fit;
  }
  const out = fitToCount(pts, count, random, 0.012 * fit);
  return { positions: out.positions, emphasis: out.emphasis, colors: null };
}

const TAU = Math.PI * 2;

function spherePoint(random: () => number, r: number): Pt {
  const u = random() * 2 - 1;
  const t = random() * TAU;
  const s = Math.sqrt(1 - u * u);
  return { x: r * s * Math.cos(t), y: r * u, z: r * s * Math.sin(t), e: 0.6 };
}

const GENERATORS: Record<GeometryKind, (n: number, random: () => number) => Pt[]> = {
  sphere(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      // Mostly surface, a few interior points so the volume reads when it turns.
      const r = random() < 0.85 ? 1 : Math.cbrt(random());
      const p = spherePoint(random, r);
      p.e = r > 0.98 ? 0.8 : 0.3;
      pts.push(p);
    }
    return pts;
  },
  basketball(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p = spherePoint(random, 1);
      // Seams: two great circles and two curved panel lines, drawn bright.
      const lat = Math.asin(p.y);
      const lon = Math.atan2(p.z, p.x);
      const seam =
        Math.abs(p.y) < 0.03 ||
        Math.abs(p.x) < 0.03 ||
        Math.abs(Math.abs(lon) - Math.PI / 2) < 0.03 / Math.max(0.2, Math.cos(lat)) ||
        Math.abs(Math.abs(lat) - 0.62 + 0.25 * Math.cos(2 * lon)) < 0.025;
      p.e = seam ? 1 : 0.35;
      pts.push(p);
    }
    return pts;
  },
  galaxy(n, random) {
    const pts: Pt[] = [];
    const arms = 2;
    for (let i = 0; i < n; i++) {
      if (random() < 0.18) {
        // Central bulge.
        const p = spherePoint(random, 0.22 * Math.cbrt(random()));
        p.y *= 0.6;
        p.e = 0.9;
        pts.push(p);
        continue;
      }
      const arm = Math.floor(random() * arms);
      const t = Math.pow(random(), 0.6) * 2.4;
      const r = 0.14 + t * 0.42;
      const angle = t * 2.1 + (arm * TAU) / arms + (random() - 0.5) * 0.45 * (0.3 + t * 0.3);
      const spread = 0.05 + t * 0.03;
      pts.push({ x: r * Math.cos(angle) + (random() - 0.5) * spread, z: r * Math.sin(angle) + (random() - 0.5) * spread, y: (random() - 0.5) * (0.05 + 0.03 * (1 - t / 2.4)), e: 0.35 + 0.5 * random() });
    }
    // Tilt so the disc reads as a disc rather than a line.
    const tilt = 0.6;
    for (const p of pts) {
      const y = p.y * Math.cos(tilt) - p.z * Math.sin(tilt);
      const z = p.y * Math.sin(tilt) + p.z * Math.cos(tilt);
      p.y = y;
      p.z = z;
    }
    return pts;
  },
  ring(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = random() * TAU;
      const r = 0.9 + (random() - 0.5) * 0.06;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z: (random() - 0.5) * 0.03, e: 1 });
    }
    return pts;
  },
  torus(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const u = random() * TAU;
      const v = random() * TAU;
      const R = 0.72;
      const r = 0.3 * (random() < 0.9 ? 1 : Math.sqrt(random()));
      pts.push({ x: (R + r * Math.cos(v)) * Math.cos(u), y: r * Math.sin(v) * 0.9, z: (R + r * Math.cos(v)) * Math.sin(u), e: 0.3 + 0.6 * (0.5 + 0.5 * Math.cos(v)) });
    }
    return pts;
  },
  helix(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = random() * 2 - 1;
      const strand = random() < 0.42 ? 0 : random() < 0.72 ? 1 : 2;
      const angle = t * 7 + (strand === 1 ? Math.PI : 0);
      if (strand === 2) {
        // Rungs between the strands.
        const k = Math.round(t * 14) / 14;
        const a = k * 7;
        const s = random();
        pts.push({ x: 0.32 * Math.cos(a) * (2 * s - 1), z: 0.32 * Math.sin(a) * (2 * s - 1), y: k, e: 0.35 });
        continue;
      }
      pts.push({ x: 0.32 * Math.cos(angle) + (random() - 0.5) * 0.03, z: 0.32 * Math.sin(angle) + (random() - 0.5) * 0.03, y: t, e: 0.95 });
    }
    return pts;
  },
  wave(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const x = random() * 2.6 - 1.3;
      const z = random() * 1.2 - 0.6;
      const y = 0.22 * Math.sin(x * 3.1 + z * 1.2) + 0.1 * Math.sin(x * 7.3 - z * 2.1) - 0.15;
      pts.push({ x, y, z, e: 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(x * 3.1 + z * 1.2)) });
    }
    return pts;
  },
  heart(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      // Classic heart curve, filled by scaling toward the centre.
      const t = random() * TAU;
      const s = random() < 0.4 ? 1 : Math.sqrt(random());
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push({ x: (hx / 17) * s, y: ((hy + 2) / 17) * s, z: (random() - 0.5) * 0.12 * s, e: s > 0.97 ? 1 : 0.4 });
    }
    return pts;
  },
  star(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = random() * TAU;
      const k = 5;
      const outer = 1;
      const inner = 0.45;
      const phase = ((t * k) / TAU) % 1;
      const edge = outer + (inner - outer) * (1 - Math.abs(phase * 2 - 1));
      const s = random() < 0.4 ? 1 : Math.sqrt(random());
      const r = edge * s;
      pts.push({ x: r * Math.cos(t + Math.PI / 2), y: r * Math.sin(t + Math.PI / 2), z: (random() - 0.5) * 0.08, e: s > 0.97 ? 1 : 0.4 });
    }
    return pts;
  },
  moon(n, random) {
    const pts: Pt[] = [];
    let guard = 0;
    while (pts.length < n && guard++ < n * 10) {
      const p = spherePoint(random, 1);
      // Lit crescent: keep points on the side facing an offset light, dim the terminator.
      const lit = p.x * 0.75 + p.z * 0.66;
      if (lit < -0.25) continue;
      p.e = lit > 0.3 ? 0.9 : 0.35;
      pts.push(p);
    }
    return pts;
  },
  blackhole(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = random() * TAU;
      if (random() < 0.25) {
        // Photon ring, nearly edge-on.
        const r = 0.46 + (random() - 0.5) * 0.03;
        pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) * 0.55, z: r * Math.sin(t) * 0.2, e: 1 });
        continue;
      }
      // Accretion disc, thin and tilted, brighter near the hole.
      const r = 0.52 + Math.pow(random(), 1.4) * 0.95;
      const a = t;
      const y = (random() - 0.5) * 0.02;
      const p = { x: r * Math.cos(a), y, z: r * Math.sin(a), e: 0.3 + 0.7 * (1 - (r - 0.52) / 0.95) };
      const tilt = 1.2;
      const yy = p.y * Math.cos(tilt) - p.z * Math.sin(tilt);
      const zz = p.y * Math.sin(tilt) + p.z * Math.cos(tilt);
      pts.push({ x: p.x, y: yy, z: zz, e: p.e });
    }
    return pts;
  },
  cube(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const face = Math.floor(random() * 6);
      const u = random() * 2 - 1;
      const v = random() * 2 - 1;
      const s = 0.75;
      const edge = Math.abs(u) > 0.94 || Math.abs(v) > 0.94 ? 1 : 0.3;
      const p = face === 0 ? [s, u * s, v * s] : face === 1 ? [-s, u * s, v * s] : face === 2 ? [u * s, s, v * s] : face === 3 ? [u * s, -s, v * s] : face === 4 ? [u * s, v * s, s] : [u * s, v * s, -s];
      pts.push({ x: p[0], y: p[1], z: p[2], e: edge });
    }
    return pts;
  },
  rose(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      // Petals as spiralling cupped surfaces around a tight core.
      const petal = Math.floor(random() * 9);
      const t = random();
      const a = random() * TAU;
      const open = 0.2 + petal * 0.1;
      const r = (0.12 + petal * 0.1) * (0.6 + 0.4 * Math.abs(Math.cos(a * 1.5)));
      const rr = r * Math.sqrt(t);
      const z = -0.35 + open * (1 - t) + Math.pow(rr, 2) * 1.6;
      pts.push({ x: rr * Math.cos(a + petal * 0.7), y: rr * Math.sin(a + petal * 0.7), z, e: t > 0.85 ? 0.95 : 0.4 });
    }
    return pts;
  },
  saturn(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      if (random() < 0.55) {
        const p = spherePoint(random, 0.55);
        p.e = 0.5 + 0.3 * random();
        pts.push(p);
      } else {
        const t = random() * TAU;
        const r = 0.75 + random() * 0.55;
        const gap = r > 1.05 && r < 1.12 ? 0.15 : 1;
        pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) * 0.35, z: (random() - 0.5) * 0.015 + r * Math.sin(t) * 0.12, e: 0.9 * gap });
      }
    }
    return pts;
  },
  tornado(n, random) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const h = random();
      const r = 0.08 + Math.pow(h, 1.8) * 0.9;
      const a = h * 18 + random() * 0.8;
      pts.push({ x: r * Math.cos(a) + (random() - 0.5) * 0.05, y: h * 2 - 1, z: r * Math.sin(a) + (random() - 0.5) * 0.05, e: 0.3 + 0.6 * random() });
    }
    return pts;
  },
  cloud(n, random) {
    const pts: Pt[] = [];
    const lobes = [
      [0, 0, 0, 0.5],
      [-0.55, -0.1, 0.1, 0.38],
      [0.55, -0.1, -0.1, 0.4],
      [0.2, 0.3, 0, 0.36],
      [-0.25, 0.28, 0.05, 0.3],
    ];
    for (let i = 0; i < n; i++) {
      const l = lobes[Math.floor(random() * lobes.length)];
      const p = spherePoint(random, l[3] * (random() < 0.7 ? 1 : Math.cbrt(random())));
      pts.push({ x: p.x + l[0], y: p.y * 0.75 + l[1] - 0.1, z: p.z * 0.6 + l[2], e: 0.5 });
    }
    return pts;
  },
  concept(n, random) {
    // Fallback when no image provider is configured: a seeded superformula blob, so each subject gets its own form.
    const m = 3 + Math.floor(random() * 6);
    const n1 = 0.3 + random() * 1.2;
    const n2 = 0.5 + random() * 1.5;
    const n3 = 0.5 + random() * 1.5;
    const sf = (phi: number) => Math.pow(Math.pow(Math.abs(Math.cos((m * phi) / 4)), n2) + Math.pow(Math.abs(Math.sin((m * phi) / 4)), n3), -1 / n1);
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const theta = random() * TAU - Math.PI;
      const phi = Math.asin(random() * 2 - 1);
      const r1 = sf(theta);
      const r2 = sf(phi);
      const s = random() < 0.8 ? 1 : Math.cbrt(random());
      pts.push({ x: 0.9 * s * r1 * Math.cos(theta) * r2 * Math.cos(phi), y: 0.9 * s * r1 * Math.sin(theta) * r2 * Math.cos(phi), z: 0.9 * s * r2 * Math.sin(phi), e: s > 0.98 ? 0.85 : 0.35 });
    }
    return pts;
  },
};
