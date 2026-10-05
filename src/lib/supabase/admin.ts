import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "./env";
import { createPreviewClient, isPreviewMode } from "./preview/fake-client";

/**
 * Service-role client for server-side schedulers (cron routes).
 * Bypasses RLS. Never import from client components.
 */
export function createAdminClient() {
  if (isPreviewMode()) return createPreviewClient() as unknown as ReturnType<typeof createSupabaseClient>;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is not set");
  }
  return createSupabaseClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function isAdminConfigured() {
  return Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}
