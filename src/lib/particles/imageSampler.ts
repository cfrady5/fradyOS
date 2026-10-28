import { fitToCount, hashString, rng } from "./types";

/**
 * Turns an image into particle targets. Two modes:
 *
 * - "silhouette" (generated images: bright subject on black): threshold against the mean luminance,
 *   clean specks, trace the contour at full emphasis and fill the interior weighted by brightness.
 * - "photo" (visitor uploads): the background colour is estimated from the border, the subject is
 *   whatever differs from it (Otsu threshold on that distance), and particles are placed by a
 *   weight that follows brightness and edge strength, so the picture reads as a luminous stipple.
 *   If no subject separates from the background, the whole frame is used.
 *
 * Interior points sit slightly deeper than edges for a layered 2.5D read; colour is carried along.
 * Browser only, and nothing leaves the browser.
 */
export async function sampleImage(src: string, count: number, options: { fit: number; useColor: boolean; mode?: "silhouette" | "photo" }): Promise<{ positions: Float32Array; emphasis: Float32Array; colors: Float32Array | null; aspect: number }> {
  if (options.mode === "photo") return samplePhoto(src, count, options.fit);
  const img = await loadImage(src);
  const random = rng(hashString(src.slice(0, 256)));
  const S = 192;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;

  // Luminance, then an adaptive threshold between the dark background and the bright subject.
  const lum = new Float32Array(S * S);
  let sum = 0;
  for (let i = 0; i < S * S; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    lum[i] = l;
    sum += l;
  }
  const mean = sum / (S * S);
  const threshold = Math.min(0.6, Math.max(0.18, mean * 1.6));
  const mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) mask[i] = lum[i] > threshold ? 1 : 0;
  // Drop isolated specks (fewer than 3 of 8 neighbours set).
  const clean = new Uint8Array(S * S);
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (!mask[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && mask[i + dy * S + dx]) n++;
      clean[i] = n >= 3 ? 1 : 0;
    }
  // Bounding box of the subject, so it is normalised to the formation size.
  let minX = S, minY = S, maxX = 0, maxY = 0, filled = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (clean[y * S + x]) {
        filled++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (filled < 40) throw new Error("no subject found in image");
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const aspect = bw / bh;
  const scale = (options.fit * 2) / Math.max(bh, bw / Math.min(2.2, Math.max(0.6, aspect)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const contour: { x: number; y: number; z: number; e: number; r?: number; g?: number; b?: number }[] = [];
  const interior: typeof contour = [];
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (!clean[i]) continue;
      const edge = !clean[i - 1] || !clean[i + 1] || !clean[i - S] || !clean[i + S];
      const px = (x - cx) * scale;
      const py = (cy - y) * scale;
      const pt: (typeof contour)[number] = { x: px, y: py, z: edge ? 0.05 : -0.08 + (random() - 0.5) * 0.14, e: edge ? 1 : 0.3 + 0.5 * lum[i] };
      if (options.useColor) {
        const sat = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) - Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        if (sat > 40) {
          pt.r = data[i * 4] / 255;
          pt.g = data[i * 4 + 1] / 255;
          pt.b = data[i * 4 + 2] / 255;
        } else {
          // Grey pixels fall back to the palette by carrying alpha 0 (fitToCount writes alpha 1; mark via NaN sentinel below).
          pt.r = -1;
          pt.g = -1;
          pt.b = -1;
        }
      }
      (edge ? contour : interior).push(pt);
    }
  // Balance: contour gets ~35% of the budget (or all its pixels if fewer), interior the rest.
  const contourBudget = Math.min(contour.length * 2, Math.round(count * 0.35));
  const interiorBudget = count - contourBudget;
  const take = (arr: typeof contour, n: number) => {
    if (arr.length === 0 || n <= 0) return [] as typeof contour;
    const out: typeof contour = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(random() * arr.length)]);
    return out;
  };
  const chosen = [...take(contour, contourBudget), ...take(interior, interiorBudget)];
  const fitted = fitToCount(chosen, count, random, scale);
  if (fitted.colors) {
    // Restore the "use palette" alpha for grey pixels marked with -1 above.
    for (let i = 0; i < count; i++) {
      if (fitted.colors[i * 4] < 0) {
        fitted.colors[i * 4] = 1;
        fitted.colors[i * 4 + 1] = 1;
        fitted.colors[i * 4 + 2] = 1;
        fitted.colors[i * 4 + 3] = 0;
      }
    }
  }
  return { positions: fitted.positions, emphasis: fitted.emphasis, colors: fitted.colors, aspect };
}

async function samplePhoto(src: string, count: number, fit: number): Promise<{ positions: Float32Array; emphasis: Float32Array; colors: Float32Array | null; aspect: number }> {
  const img = await loadImage(src);
  const random = rng(hashString(src.slice(-512)));
  // Analyse at a modest size that keeps the aspect ratio.
  const longest = 240;
  const W = img.width >= img.height ? longest : Math.max(32, Math.round((longest * img.width) / img.height));
  const H = img.width >= img.height ? Math.max(32, Math.round((longest * img.height) / img.width)) : longest;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const N = W * H;
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;

  // Background: the median colour of the border ring.
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
  const median = (ch: number) => {
    const v = border.map((i) => data[i * 4 + ch]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const bg = [median(0), median(1), median(2)];
  const dist = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const dr = data[i * 4] - bg[0];
    const dg = data[i * 4 + 1] - bg[1];
    const db = data[i * 4 + 2] - bg[2];
    const d = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);
    dist[i] = d;
    hist[Math.min(255, Math.floor(d * 255))]++;
  }
  // Otsu's threshold on the distance-from-background histogram.
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = 0, thresholdBin = 64;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = N - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thresholdBin = t;
    }
  }
  const threshold = Math.max(0.08, thresholdBin / 255);
  const mask = new Uint8Array(N);
  let filled = 0;
  for (let i = 0; i < N; i++) {
    if (dist[i] > threshold) {
      mask[i] = 1;
      filled++;
    }
  }
  // No clear subject (a busy photo, or one that fills the frame): use the whole picture.
  const wholeFrame = filled < N * 0.04 || filled > N * 0.96;
  if (wholeFrame) mask.fill(1);

  // Sobel edge magnitude on luminance.
  const edge = new Float32Array(N);
  let maxEdge = 1e-3;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1] + lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
      const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
      edge[i] = Math.sqrt(gx * gx + gy * gy);
      if (edge[i] > maxEdge) maxEdge = edge[i];
    }

  // Subject bounds, for normalisation.
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const aspect = bw / bh;
  const scale = (fit * 2) / Math.max(bh, bw / Math.min(2.2, Math.max(0.6, aspect)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Placement weight: brightness (a luminous stipple on black) plus edges, inside the subject.
  // Against a dark background the subject's own tones carry it; against a light one, invert so the
  // subject still reads bright.
  const bgLum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
  const weights = new Float32Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const tone = bgLum > 0.5 && !wholeFrame ? 1 - lum[i] : lum[i];
    const e = edge[i] / maxEdge;
    weights[i] = 0.08 + 0.9 * tone + 1.4 * e;
    total += weights[i];
  }
  if (total <= 0) throw new Error("nothing to sample");
  const cumulative = new Float32Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += weights[i];
    cumulative[i] = acc;
  }
  const pick = () => {
    const r = random() * total;
    let lo = 0, hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const pts: { x: number; y: number; z: number; e: number; r: number; g: number; b: number }[] = [];
  const n = Math.min(count, N * 3);
  for (let k = 0; k < n; k++) {
    const i = pick();
    const x = i % W;
    const y = (i - x) / W;
    const e = edge[i] / maxEdge;
    const tone = bgLum > 0.5 && !wholeFrame ? 1 - lum[i] : lum[i];
    // Sub-pixel jitter so repeated picks of one pixel spread out.
    const px = (x + random() - 0.5 - cx) * scale;
    const py = (cy - (y + random() - 0.5)) * scale;
    pts.push({ x: px, y: py, z: (e > 0.35 ? 0.05 : -0.06) + (random() - 0.5) * 0.1, e: Math.min(1, 0.25 + 0.5 * tone + 0.6 * e), r: data[i * 4] / 255, g: data[i * 4 + 1] / 255, b: data[i * 4 + 2] / 255 });
  }
  const fitted = fitToCount(pts, count, random, scale * 0.6);
  return { positions: fitted.positions, emphasis: fitted.emphasis, colors: fitted.colors, aspect };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}
