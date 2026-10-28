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
| `src/components/site/*` | Button, TwoTone, SectionHeader (heading, then supporting copy; exports the shared section padding), FigureFrame (crosshair corners), CodeCard, Gallery, LivePreview, Footer (with the Portal link). |
| `src/components/site/sections/*` | Hero, Services, HowIWork, SelectedWork, StartSomething. |
| `src/app/(site)/page.tsx` | The homepage. It has no top navigation; the hero buttons and the footer carry the links. |
| `src/app/(site)/lab/page.tsx` | The particle lab (see below). |

## Section structure

Every section follows the same order: heading, supporting description, then content. There are no eyebrow labels, section numbers, figure numbers, status chips or captions; hierarchy comes from the type scale (`h1`, `h2`, `h3`, `lede` and `label` utilities in `src/app/globals.css`) and from spacing (`SECTION_PAD` in `SectionHeader.tsx`, with content starting at `mt-12 md:mt-16` below the header). The mono `label` style is kept only for metadata inside components: the gallery counter, hosts and open links, the live-preview loading line, and the footer.

## Particle lab (`/lab`)

A GPU particle engine: the visitor types a prompt and about 30,000 particles (8,100 on phones, 4,096 on low-power phones) assemble into it. The hero links to it; nothing else on the homepage changes.

| Path | What it is |
| --- | --- |
| `src/lib/particles/simulation.ts` | `ParticleSimulation`: positions and velocities live in float textures advanced by two fragment-shader passes per frame (three's `GPUComputationRenderer`); the render pass reads the position texture per vertex. Targets are uploaded as a texture; pointer, impulses and mode ramps are uniforms. Nothing per-particle runs in JavaScript after setup. |
| `src/lib/particles/shaders/*` | Simplex and curl noise, the velocity pass (spring to target, curl turbulence, dispersion burst, cursor repulsion, click impulses, soft containment, damping, speed clamp), the position pass, and the point sprite shaders (size by depth and seed, palette or image colour, lichen on fast movers, twinkle). |
| `src/lib/particles/textSampler.ts` | Offscreen-canvas text rendering sampled into targets; edges get full emphasis so letters stay legible. |
| `src/lib/particles/geometrySampler.ts` | Procedural forms (sphere, basketball, galaxy, ring, torus, helix, wave, heart, star, moon, black hole, cube, rose, saturn, tornado, cloud, and a seeded `concept` blob used as the image fallback). Pure functions, unit-tested. |
| `src/lib/particles/imageSampler.ts` | Turns an image into targets. Silhouette mode (generated images): adaptive threshold, speck removal, contour plus interior sampling. Photo mode (visitor uploads): background estimated from the border, subject by Otsu threshold on the distance from it, particles placed by brightness and edge strength, colours carried along. Slight 2.5D depth in both. |
| `src/lib/particles/targetGenerator.ts` | Builds a `TargetData` for an interpretation at the current particle count, falling back to the procedural form when no image is available. |
| `src/lib/particles/transitions.ts` | The state machine (IDLE, DISPERSING, GENERATING, ASSEMBLING, FORMED, INTERACTIVE, ERROR) and the controller the UI subscribes to. One submission at a time; the scene is re-targeted, never rebuilt. Text and geometry prompts the rules recognise never leave the browser. |
| `src/lib/particles/performance.ts` | Device tiering, WebGL2 probing (float or half-float render targets), reduced-motion check, and the frame-rate monitor. |
| `src/lib/ai/schema.ts` | Zod schema of an interpretation (category, subject, method, text or geometry kind, aspect, depth, motion, palette) and the API response shapes. |
| `src/lib/ai/rules.ts` | Rule-based interpretation that runs anywhere and never fails. |
| `src/lib/ai/promptInterpreter.ts` | Server-only: Claude classification on top of the rules when `ANTHROPIC_API_KEY` is set, validated and reconciled; falls back to the rules on any failure. |
| `src/lib/ai/imageProvider.ts` | Silhouette generation behind one interface; an OpenAI Images adapter ships, selected through env. |
| `src/lib/ai/rateLimit.ts`, `labLimits.ts` | Per-visitor token buckets, concurrency caps, a daily image cap and TTL caches for the two routes (in-memory, per server instance). |
| `src/app/api/lab/interpret`, `src/app/api/lab/image` | The routes. Prompts are normalised and capped at 80 characters; keys never reach the browser. |
| `src/components/particle-engine/*` | `ParticleCanvas` (R3F canvas: DPR cap, pause when hidden, context-loss recovery), `ParticleSystem` (owns the simulation, pointer and orbit input, parallax, FPS step-down), `ParticleInput`, `ParticleControls`, `ParticleStatus`, `ParticleLab` (layout and the no-WebGL fallback), `LabClient` (client-only loader). |

**Environment variables** (all optional; without them the lab runs text and geometry deterministically and shows a procedural stand-in for image prompts):

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` (or `anthropic`) | Enables Claude prompt interpretation (`claude-opus-5-5` by default, `LAB_INTERPRET_MODEL` overrides). Low effort, structured output, 8 s timeout, server-side refusal fallback on. |
| `OPENAI_API_KEY` (or `openai`) | Enables silhouette generation through the OpenAI Images API (`LAB_IMAGE_PROVIDER=openai`, the default when the key is set; `LAB_IMAGE_MODEL` is tried first, then gpt-image-1-mini, gpt-image-1.5, gpt-image-2, gpt-image-2.5-sunburst, gpt-image-2.5-flare, chatgpt-image-latest, gpt-image-1 and dall-e-3 until one the account can use answers, with a bare retry when a model rejects an optional parameter; `LAB_IMAGE_SIZE` default `1024x1024`). Set `LAB_IMAGE_PROVIDER=none` to keep the key but turn generation off. |
| `LAB_IMAGE_DAILY_CAP` | Global images per UTC day per server instance (default 200). |
| `LAB_IMAGE_CONCURRENCY`, `LAB_INTERPRET_CONCURRENCY` | In-flight caps (defaults 2 and 4). |
| `LAB_IMAGE_TIMEOUT_MS` | Image generation timeout (default 45000). |

**Uploads**: "Upload an image" (or dropping a file on the page) forms the visitor's own picture. Sampling runs in the browser in photo mode; the file never leaves the device and no API is called. Images over 12 MB and non-image files are refused with a message.

Per-visitor limits: 20 interpretations and 6 images per minute. Results are cached for an hour (interpretations) and a day (images, 40 entries).

**Adding another image provider**: implement `ImageProvider` in `src/lib/ai/imageProvider.ts` (return a PNG data URL of a bright subject on black) and select it in `getImageProvider()`. The browser does the sampling, so the server never decodes pixels.

**Performance knobs**: particle budgets and the DPR cap in `detectTier()`; point size in `ParticleSystem`; spring, damping, noise and interaction constants as uniforms in `ParticleSimulation`. The first low-FPS reading halves the drawn particles without a rebuild; the next halves the simulation itself and re-samples the formation.

## Tuning the effects

All constants live in `TUNING` at the top of `src/lib/pixel/pixelEngine.ts`.

**Shared**: `maxDpr` (device pixel ratio cap, 2), `pixelFill` (pixel square as a fraction of the cell pitch, 0.7 leaves visible gaps), `narrowWidth` (canvases narrower than this use the `pitchNarrow` of each effect, so phones render fewer pixels), `enterThreshold` (fraction of a canvas on screen before its effect's entrance runs, 0.35).

**Hero field** (`hero`): `pitch` 6 px (9 on narrow). Brightness is counted in shade levels, 0 for the unlit grid and 1 to 5 for the five steps of a green family, ordered-dithered between neighbouring steps. There are four families, cool to warm: tide (teal), emerald, moss and fern (olive), defined as `fieldGreens` in `src/lib/site/tokens.ts`. Step n has the same luminance in every family (0.026 to 0.068, near the unlit grid), so hue can change without changing text contrast.

The main source is a flowing wave: a band with `flowWavelength` 620 px heading toward `flowAngle` (-12 deg) at `flowSpeed` 55 px/s, plus a weaker cross band (`flow2*`, weight `flow2Weight`). Crests are `(0.5 + 0.5 sin)^3`, so bright bands stay narrow and troughs show the grey grid; `flowGain` (6.6 levels) sets their height, scaled toward `flowFloor` on the left. Variance: each band's speed swings by `flowSpeedVar` (±40%) out of step with the other, `flowMeander` and `flowMeander2` bend the fronts along rows and columns, and a drifting swell (`swellDepth`, `swellScaleX/Y`, `swellSpeed`) makes the wave strong in some regions and calm in others. Hue: a slow hue map (`hueScale`, `hueAngle`, drifting at `hueDrift`, range `hueSpread`) picks the family per pixel, with crests leaning warm by `hueCrestBias`; the family is dithered with the transposed Bayer matrix so hue and brightness boundaries do not align.

A faint sine-noise sparkle (`base` ± `amplitude`, `waveSpeed`) sits on top, faded on the left by `leftFadeStart` / `leftFadeEnd` / `leftFadeFloor`. The cursor adds a gaussian light (`lightSigma` 115 px, `lightGain` 3.4 levels) and clicks spawn ripples (`rippleSpeed` 460 px/s, `rippleSigma` 13 px, `rippleLife` 2.5 s, `rippleGain` 3.2 levels). To keep copy readable, pixels never exceed `textCap` (step 3) left of `textCapStart` of the width, rising to the full ramp by `textCapEnd`; phones keep the cap everywhere. Reduced motion freezes the field in place.

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
