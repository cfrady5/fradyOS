import type { EffectEnv, PixelEffect } from "../pixelEngine";
import { heroField } from "./heroField";
import { orb } from "./orb";
import { monogram } from "./monogram";
import { wordmark } from "./wordmark";
import { easing } from "./easing";

export type EffectKind = "hero" | "orb" | "monogram" | "wordmark" | "easing";

export const EFFECTS: Record<EffectKind, (env: EffectEnv) => PixelEffect> = { hero: heroField, orb, monogram, wordmark, easing };
