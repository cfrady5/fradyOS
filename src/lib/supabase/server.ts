import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use in Server Components, Server Actions and Route Handlers.
 * Create a fresh client per request (do not cache across requests).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies can't be written here.
          // The proxy refreshes sessions, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Returns the authenticated user's id (from a verified JWT) or null.
 */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) throw new Error("Not authenticated");
  return id;
}
