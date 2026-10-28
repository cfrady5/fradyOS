import { fitToCount, hashString, rng } from "./types";

/**
 * Turns a generated silhouette (bright subject on black) into particle targets. The image is
 * downsampled, thresholded against its own mean luminance, cleaned of stray specks, and sampled:
 * about a third of the particles trace the contour at full emphasis, the rest fill the interior
 * weighted by brightness. Interior points sit slightly deeper than the outline for a layered
 * 2.5D read. Colour is carried along when the image has any. Browser only.
 */
export async function sampleImage(src: string, count: number, options: { fit: number; useColor: boolean }): Promise<{ positions: Float32Array; emphasis: Float32Array; colors: Float32Array | null; aspect: number }> {
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}
