import "server-only";

/** First non-empty value among several environment variable names. */
function firstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Anthropic key: the standard name, or the short `anthropic` / `ANTHROPIC` names. */
export const anthropicApiKey = () => firstEnv("ANTHROPIC_API_KEY", "anthropic", "ANTHROPIC", "Anthropic");

/** OpenAI key: the standard name, or the short `openai` / `OPENAI` names. */
export const openaiApiKey = () => firstEnv("OPENAI_API_KEY", "openai", "OPENAI", "OpenAI");
