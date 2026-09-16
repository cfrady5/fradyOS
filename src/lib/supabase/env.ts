/**
 * Supabase connection settings.
 * The NEXT_PUBLIC_* names are primary (they are inlined into the browser bundle). The un-prefixed
 * names are accepted as server-side fallbacks because the Vercel ↔ Supabase integration injects them.
 */
function pick(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function getSupabaseUrl() {
  const url = pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url;
}

export function getSupabasePublishableKey() {
  const key = pick("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set");
  }
  return key;
}

export function isSupabaseConfigured() {
  return Boolean(pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL") && pick("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"));
}
