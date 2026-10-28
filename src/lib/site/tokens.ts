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
  oak: "#C9A578",
  crosshair: "#52525B",
} as const;

export type TokenName = keyof typeof tokens;

/**
 * Hero field greens: four hue families from cool to warm (tide teal, emerald, moss, fern olive), each a
 * five-step OKLCH ramp. Step n has the same luminance in every family (0.026 to 0.068, close to the
 * unlit grid's 0.035), so hue can drift freely without changing text contrast. The field caps pixels
 * under the copy at step 3. Canvas-only, so these are not emitted as CSS variables.
 */
export const fieldGreens = {
  tide: ["#05342B", "#023D33", "#00453A", "#024D41", "#035447"],
  emerald: ["#123321", "#123C26", "#11452B", "#104D30", "#0E5535"],
  moss: ["#1B331C", "#1E3B1F", "#204422", "#234C25", "#265429"],
  fern: ["#253114", "#2B3A16", "#304216", "#364917", "#3A5118"],
} as const;

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
