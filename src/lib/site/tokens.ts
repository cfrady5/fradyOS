/**
 * FRADY site design tokens. This file is the single source of truth: `tokensToCss()` injects the
 * CSS variables (prefixed `--site-`) in the site layout, globals.css maps them to Tailwind utilities
 * (`bg-ground`, `text-ink`, `text-ink-muted` …), and the pixel engine reads the same values.
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
  /** Hero field greens, darkest to brightest (OKLCH ramp, deep teal to leaf). All stay near the unlit grid's
   *  luminance; the field caps pixels under the text at moss3 so copy keeps its contrast. */
  moss1: "#113327",
  moss2: "#153C29",
  moss3: "#194429",
  moss4: "#1F4C2B",
  moss5: "#26542C",
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

/** `:root { --site-ground: #09090B; … }` for the site layout. Prefixed so they never collide with the OS theme. */
export function tokensToCss(): string {
  return `:root{${Object.entries(tokens)
    .map(([k, v]) => `--site-${kebab(k)}:${v}`)
    .join(";")}}`;
}
