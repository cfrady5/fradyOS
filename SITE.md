# FRADY · public homepage

The public homepage for Caleb Frady lives inside the FRADY OS app at `/` (route group `src/app/(site)`), built with Next.js (App Router), TypeScript and Tailwind CSS v4. Every pixel effect is hand-written Canvas 2D; there are no WebGL or animation libraries. The OS is reached through the "Portal" link in the footer (`/today`).

## Files

| Path | What it is |
| --- | --- |
| `src/lib/site/tokens.ts` | The single tokens file. `tokensToCss()` injects `--site-*` CSS variables in the site layout; `src/app/globals.css` maps them to Tailwind utilities (`bg-ground`, `text-ink`, `text-ink-muted`, `text-lichen` …); the pixel engine reads the same values. |
| `src/lib/site/copy.ts` | Copy and contact details. Everything in `[brackets]` is a placeholder waiting for real text. |
| `src/data/sites.ts` | The live-sites showcase (17 sites). `preview: "live"` embeds the site; `"link"` shows a placeholder card with the open link. |
| `src/lib/pixel/pixelEngine.ts` | Shared engine: tuning constants, Bayer dithering, batched Path2D drawing, the page-level pointer bus, text rasterisation. |
| `src/lib/pixel/effects/*.ts` | The four effects: `heroField`, `monogram`, `wordmark`, `easing`. |
| `src/components/site/PixelCanvas.tsx` | Hosts an effect: DPR-aware sizing, one rAF loop per canvas paused offscreen, reduced-motion handling. |
| `src/components/site/*` | Nav, Button, StatusChip, FigureFrame (crosshair corners), CodeCard, Strip, Gallery, LivePreview, Footer (with the Portal link). |
| `src/app/(site)/page.tsx` | The homepage. `/work`, `/ventures`, `/writing`, `/about` are placeholder pages. |

## Tuning the effects

All constants live in `TUNING` at the top of `src/lib/pixel/pixelEngine.ts`.

**Shared**: `maxDpr` (device pixel ratio cap, 2), `pixelFill` (pixel square as a fraction of the cell pitch, 0.7 leaves visible gaps), `narrowWidth` (canvases narrower than this use the `pitchNarrow` of each effect, so phones render fewer pixels), `enterThreshold` (fraction of a canvas on screen before its effect's entrance runs, 0.35).

**Hero field** (`hero`): `pitch` 6 px (9 on narrow). `base` ± `amplitude` is the slow sine-noise brightness (0.13 ± 0.11) and `waveSpeed` its tempo. `leftFadeStart` / `leftFadeEnd` / `leftFadeFloor` fade the field toward the left so the headline stays calm. `lightSigma` (115 px) and `lightGain` (+0.8) shape the cursor light. Clicks spawn ripples: `rippleSpeed` 460 px/s, `rippleSigma` 13 px, `rippleLife` 2.5 s. Lit pixels draw in `moss` (#183224); pixels brighter than `peakThreshold` (the core of the cursor light, and ripples) draw in `mossLit` (#21452F); unlit pixels are pixel-dim. Both greens sit close to the unlit grid's luminance, so the headline and copy keep their contrast wherever the light is. Brighten them in `src/lib/site/tokens.ts` only after checking the text over them.

**Monogram** (`monogram`): the "f" is rasterised with Geist 800 into a `cols x rows` grid (52 x 68). `shimmerSpeed` / `shimmerAmount` control the vertical shimmer; pixels within `lichenRadius` (50 px) of the cursor light up in lichen.

**Wordmark** (`wordmark`): "frady" rasterised at `pitch` 4 px (6 on narrow) with `letterSpacing` -0.04em. Each covered cell is a particle in Float32Arrays. Per frame: repel inside `repelRadius` with force `(1 - d/R)^2 * repelForce`, click shockwave front at `shockSpeed` with `shockWidth` and `shockForce`, spring to home at `spring`, velocity `damping`. Particles displaced more than `lichenDistance` draw in lichen; settled particles are dithered by a horizontal light sweep (`sweepSpeed`, `sweepWavelength`). The box stays empty until `enterThreshold` of it is on screen; then the particles flood in from its four corners. Each particle leaves its nearest corner on a quadratic curve (control point bent sideways by up to `floodBend` of the flight length), eases in and out over `floodFlight` (0.9 s), and launches after a delay that grows with its distance from the corner across `floodStagger` (1.3 s) plus up to `floodJitter` (0.35 s) of noise, so the outer letters fill first and the centre last. Flying particles draw in lichen and ignore the cursor; once landed they are interactive. A resize after the flood has started shows the word in place.

**Easing** (`easing`): `bezier` control points and `duration` of the marker loop.

The canvases wait for `document.fonts.load("800 100px <Geist family>")` before rasterising text. The family string comes from `next/font` (`geist.style.fontFamily`), which is the name the browser actually registers.

## Behaviour notes

- One `pointermove` / `pointerdown` / `pointerup` set of listeners on the page feeds every canvas through `registerPointerTarget`; events are passive and canvases have `pointer-events: none`, so interaction never blocks scrolling or text selection.
- `prefers-reduced-motion`: ambient motion stops (field wave, wordmark flood, shimmer, sweep, marker) and idle canvases skip frames; hover and click still respond.
- Each canvas pauses its loop when offscreen (IntersectionObserver) and re-measures on resize (ResizeObserver).
- Live previews in the gallery mount only while a card is near the viewport and unmount when it scrolls away, so only a handful of iframes are ever live. Frames are scaled from a 1280 x 800 virtual browser and are non-interactive; the "Open" link goes to the real site. If a site refuses to be framed, switch it to `preview: "link"` in `src/data/sites.ts`.

## Contrast note

The brief lists `label: #71717A`. On the `#09090B` ground that measures 4.1:1, below the 4.5:1 bar, so the token ships as `#7A7A84` (4.7:1). Change it back in `src/lib/site/tokens.ts` if the exact value matters more than the ratio.

## Copy rules

No em dashes anywhere. Replace every `[bracketed]` placeholder in `src/lib/site/copy.ts` before launch. Nothing in the UI states numbers, clients or testimonials that are not in the data files.
