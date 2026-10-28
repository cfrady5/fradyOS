import { fitToCount, hashString, rng } from "./types";

/**
 * Renders text to an offscreen canvas and samples its foreground pixels into particle targets.
 * Edge pixels get full emphasis so the letterforms stay legible; interior pixels fill at lower
 * weight. Long strings wrap onto up to three lines. Browser only (needs a canvas).
 */
export function sampleText(text: string, count: number, options: { fontFamily: string; aspect: number; fit: number }): { positions: Float32Array; emphasis: Float32Array; colors: null; aspect: number } {
  const random = rng(hashString(text));
  const lines = wrap(text, 12);
  const W = 512;
  const H = Math.round(W / Math.max(0.6, Math.min(2.4, options.aspect)));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ...fitToCount([], count, random), colors: null, aspect: options.aspect };

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Fit: start large, shrink until the widest line fits 88% of the width and all lines fit 80% of the height.
  let size = 400;
  const lineGap = 1.05;
  for (;;) {
    ctx.font = `800 ${size}px ${options.fontFamily}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if ((widest <= W * 0.88 && size * lineGap * lines.length <= H * 0.8) || size < 12) break;
    size *= 0.92;
  }
  const total = size * lineGap * lines.length;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - total / 2 + size * lineGap * (i + 0.5)));

  const data = ctx.getImageData(0, 0, W, H).data;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4] > 128;
  const pts: { x: number; y: number; z: number; e: number }[] = [];
  const scaleY = (options.fit * 2) / H;
  const step = Math.max(1, Math.floor(Math.sqrt((W * H) / (count * 2.2))));
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - step, y) || !inside(x + step, y) || !inside(x, y - step) || !inside(x, y + step);
      const px = (x - W / 2) * scaleY;
      const py = (H / 2 - y) * scaleY;
      pts.push({ x: px, y: py, z: edge ? 0.03 : (random() - 0.5) * 0.12, e: edge ? 1 : 0.45 });
    }
  }
  const fitted = fitToCount(pts, count, random, step * scaleY);
  return { positions: fitted.positions, emphasis: fitted.emphasis, colors: null, aspect: W / H };
}

export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
    if (lines.length === 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  return lines.length ? lines : [text.slice(0, maxChars)];
}
