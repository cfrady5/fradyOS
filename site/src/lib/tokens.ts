/**
 * FRADY design tokens. This file is the single source of truth: `tokensToCss()` injects the
 * CSS variables at the root, globals.css maps them to Tailwind utilities, and the pixel engine
 * reads the same values for canvas drawing.
 */
export const tokens = {
  ground: "#09090B",
  ink: "#F4F4F5",
  muted: "#8B8B94",
  body: "#A1A1AA",
  label: "#7A7A84",
  hairline: "#1E1E22",
  borderStrong: "#26262B",
  pixelDim: "#34343B",
  lichen: "#9DD6B0",
  oak: "#C9A578",
  crosshair: "#52525B",
} as const;

export type TokenName = keyof typeof tokens;

/** Type scale, kept here so the headline rules live next to the colours. */
export const type = {
  h1: { size: 76, weight: 500, tracking: "-0.05em", leading: 1.02 },
  h2: { size: 52, weight: 500, tracking: "-0.045em", leading: 1.05 },
  body: { size: 17, leading: 1.6 },
  label: { size: 11, tracking: "0.13em" },
} as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** `:root { --ground: #09090B; … }` for a `<style>` tag in the root layout. */
export function tokensToCss(): string {
  return `:root{${Object.entries(tokens)
    .map(([k, v]) => `--${kebab(k)}:${v}`)
    .join(";")}}`;
}
