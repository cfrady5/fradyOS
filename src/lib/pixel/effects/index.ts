import type { EffectEnv, PixelEffect } from "../pixelEngine";
import { heroField } from "./heroField";
import { monogram } from "./monogram";
import { wordmark } from "./wordmark";
import { easing } from "./easing";

export type EffectKind = "hero" | "monogram" | "wordmark" | "easing";

export const EFFECTS: Record<EffectKind, (env: EffectEnv) => PixelEffect> = { hero: heroField, monogram, wordmark, easing };
