import { GEOMETRY_KINDS, type GeometryKind, type Interpretation } from "./schema";

/**
 * Rule-based prompt interpretation. Runs anywhere (server and browser), never fails. Text and
 * mathematical forms are always rendered deterministically; prompts it recognises as objects with a
 * good procedural stand-in (a basketball, the moon) get geometry; anything else is classed as an
 * object or concept that wants a generated silhouette. The server-only `promptInterpreter.ts` layers
 * Claude on top of these rules.
 */

const TEXT_PATTERNS: RegExp[] = [
  /^(?:the\s+)?(?:word|words|text|letters?|initials?|name|number|numbers|symbol|logo)\s*[:\-]?\s*["“']?(.+?)["”']?$/i,
  /^(?:spell|write|type|show|display)\s+(?:out\s+)?(?:the\s+)?(?:word\s+|words\s+|text\s+)?["“']?(.+?)["”']?$/i,
  /^["“'](.+)["”']$/,
];

/** Keyword → procedural form. Earlier entries win, so put the more specific words first. */
const GEOMETRY_WORDS: [RegExp, GeometryKind][] = [
  [/black\s*hole|event horizon|singularity/i, "blackhole"],
  [/basketball|basket ball/i, "basketball"],
  [/galaxy|milky way|nebula|spiral\b/i, "galaxy"],
  [/saturn|ringed planet|planet with (?:a )?rings?/i, "saturn"],
  [/\bmoon\b|crescent|lunar/i, "moon"],
  [/\bsun\b|\bstar\b|starfish/i, "star"],
  [/\bheart\b|\blove\b/i, "heart"],
  [/\brose\b|flower|blossom|bloom/i, "rose"],
  [/tornado|twister|vortex|whirl(?:pool|wind)|cyclone|hurricane/i, "tornado"],
  [/\bdna\b|double helix|helix|spiral staircase|spring\b|coil/i, "helix"],
  [/torus|donut|doughnut|\bring\b|halo|wedding ring|\bhoop\b|\bo\b/i, "torus"],
  [/\bcube\b|\bbox\b|dice|\bdie\b/i, "cube"],
  [/\bwave\b|waves|ocean|\bsea\b|ripple/i, "wave"],
  [/\bcloud\b|smoke|fog|mist/i, "cloud"],
  [/sphere|\bball\b|\bglobe\b|\borb\b|planet|earth|\bworld\b|bubble|pearl|marble/i, "sphere"],
  [/\bcircle\b|\bdisc\b|\bdisk\b|\bwheel\b|coin/i, "ring"],
];

const PALETTE_WORDS: [RegExp, Interpretation["palette"]][] = [
  [/fire|flame|sun|gold|warm|autumn|desert|lion|tiger|fox|amber|copper|bronze|oak/i, "oak"],
  [/forest|tree|leaf|leaves|plant|grass|moss|frog|snake|dragon|nature|earth|jungle|lichen|green|rose|flower|bloom/i, "lichen"],
];

const STOP_WORDS = /^(?:a|an|the|of|in|on|at|to|with|and|some|my|your|his|her|its|their|our)$/i;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pickPalette(prompt: string): Interpretation["palette"] {
  for (const [re, p] of PALETTE_WORDS) if (re.test(prompt)) return p;
  return "ink";
}

/** Short subject: drop a leading article and trailing punctuation. */
function subjectOf(prompt: string): string {
  return prompt
    .replace(/[.!?]+$/, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim()
    .toLowerCase();
}

export function textInterpretation(text: string, prompt: string): Interpretation {
  const t = text.trim().slice(0, 40);
  const lines = Math.ceil(t.length / 12);
  return {
    category: "text",
    subject: t,
    method: "text",
    text: t,
    geometry: null,
    aspect: Math.min(2.4, Math.max(0.8, (t.length / Math.max(1, lines)) * 0.55)),
    depth: "relief",
    motion: { turbulence: 0.25, spin: 0, pulse: 0.15 },
    palette: pickPalette(prompt),
  };
}

const GEOMETRY_META: Record<GeometryKind, Pick<Interpretation, "aspect" | "depth" | "motion">> = {
  sphere: { aspect: 1, depth: "volume", motion: { turbulence: 0.2, spin: 0.5, pulse: 0.2 } },
  basketball: { aspect: 1, depth: "volume", motion: { turbulence: 0.15, spin: 0.6, pulse: 0.1 } },
  galaxy: { aspect: 1.4, depth: "volume", motion: { turbulence: 0.35, spin: 0.7, pulse: 0.1 } },
  ring: { aspect: 1, depth: "flat", motion: { turbulence: 0.2, spin: 0, pulse: 0.3 } },
  torus: { aspect: 1.2, depth: "volume", motion: { turbulence: 0.2, spin: 0.6, pulse: 0.1 } },
  helix: { aspect: 0.7, depth: "volume", motion: { turbulence: 0.2, spin: 0.8, pulse: 0 } },
  wave: { aspect: 2, depth: "relief", motion: { turbulence: 0.5, spin: 0, pulse: 0.4 } },
  heart: { aspect: 1.1, depth: "relief", motion: { turbulence: 0.2, spin: 0, pulse: 0.7 } },
  star: { aspect: 1, depth: "relief", motion: { turbulence: 0.3, spin: 0.2, pulse: 0.4 } },
  moon: { aspect: 1, depth: "relief", motion: { turbulence: 0.15, spin: 0, pulse: 0.1 } },
  blackhole: { aspect: 1.5, depth: "volume", motion: { turbulence: 0.6, spin: 0.9, pulse: 0.2 } },
  cube: { aspect: 1, depth: "volume", motion: { turbulence: 0.1, spin: 0.5, pulse: 0 } },
  rose: { aspect: 1, depth: "volume", motion: { turbulence: 0.25, spin: 0.4, pulse: 0.3 } },
  saturn: { aspect: 1.6, depth: "volume", motion: { turbulence: 0.2, spin: 0.6, pulse: 0 } },
  tornado: { aspect: 0.8, depth: "volume", motion: { turbulence: 0.7, spin: 0.9, pulse: 0.2 } },
  cloud: { aspect: 1.6, depth: "volume", motion: { turbulence: 0.6, spin: 0.1, pulse: 0.3 } },
  concept: { aspect: 1.2, depth: "volume", motion: { turbulence: 0.5, spin: 0.4, pulse: 0.3 } },
};

export function geometryInterpretation(kind: GeometryKind, subject: string, prompt: string, category: Interpretation["category"] = "geometry"): Interpretation {
  return { category, subject, method: "geometry", text: null, geometry: kind, ...GEOMETRY_META[kind], palette: pickPalette(prompt) };
}

/** Rules only. Never throws. */
export function interpretDeterministic(prompt: string): Interpretation {
  const p = prompt.trim();
  for (const re of TEXT_PATTERNS) {
    const m = p.match(re);
    if (m?.[1]) return textInterpretation(m[1], p);
  }
  // Bare short tokens read as text: "FRADY", "42", "A+B", "hello world" (all caps or digits, or a single short token).
  const words = p.split(/\s+/);
  const isAllCapsOrDigits = /^[A-Z0-9&@#$%+\-*/=!?.'’]+$/.test(p.replace(/\s/g, "")) && p.length <= 16;
  const singleShortToken = words.length === 1 && p.length <= 10 && !GEOMETRY_WORDS.some(([re]) => re.test(p)) && /^[\p{L}\p{N}&@#$%+\-*/=!?.'’]+$/u.test(p) && !/^(?:[a-z]{4,})$/.test(p);
  if (isAllCapsOrDigits || singleShortToken) return textInterpretation(p, p);

  // A scene (an action or a relation between things) is never one procedural form, however many
  // keywords it contains: "a wolf howling at the moon" is not the moon. Descriptive -ing words that
  // name things rather than actions (blooming, ring, spring, wedding) do not count.
  const content = words.filter((w) => !STOP_WORDS.test(w));
  const isScene =
    /\b(?!blooming\b|ring\b|spring\b|wedding\b|king\b|thing\b|string\b|ceiling\b|morning\b|evening\b|ringed\b|lightning\b)\w+ing\b/i.test(p) ||
    /\b(?:under|over|above|below|between|against|with|and|inside|through|behind|beside|next to|on top of)\b/i.test(p) ||
    content.length >= 4;
  if (!isScene) {
    for (const [re, kind] of GEOMETRY_WORDS) {
      if (re.test(p)) {
        const category: Interpretation["category"] = ["basketball", "moon", "saturn", "rose", "heart", "cloud", "tornado", "blackhole", "galaxy"].includes(kind) ? "object" : "geometry";
        return geometryInterpretation(kind, subjectOf(p), p, category);
      }
    }
  }

  // Everything else wants an image. Scenes and fantasy read as concepts; short noun phrases as objects.
  const h = hash(p.toLowerCase());
  return {
    category: isScene ? "concept" : "object",
    subject: subjectOf(p),
    method: "image",
    text: null,
    geometry: null,
    aspect: isScene ? 1.5 : 1.1,
    depth: "relief",
    motion: { turbulence: 0.2 + (h % 30) / 100, spin: 0, pulse: 0.1 + (h % 20) / 100 },
    palette: pickPalette(p),
  };
}

/** Keep whatever the model says inside what the engine can draw. */
export function reconcile(ai: Interpretation, prompt: string): Interpretation {
  const det = interpretDeterministic(prompt);
  // Text is always deterministic: trust the rules whenever they found characters to render.
  if (det.method === "text") return { ...det, motion: ai.motion, palette: ai.palette };
  if (ai.method === "text") {
    const t = (ai.text ?? ai.subject).trim();
    return t ? textInterpretation(t, prompt) : det;
  }
  if (ai.method === "geometry") {
    const kind = ai.geometry && (GEOMETRY_KINDS as readonly string[]).includes(ai.geometry) ? ai.geometry : det.geometry;
    if (!kind) return det;
    return { ...geometryInterpretation(kind, ai.subject.toLowerCase(), prompt, ai.category), motion: ai.motion, palette: ai.palette };
  }
  return { ...ai, text: null, geometry: null, subject: ai.subject.toLowerCase() };
}

