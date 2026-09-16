import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublishableKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/cron/", "/api/health"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    // Let the setup page explain what is missing instead of crashing.
    if (request.nextUrl.pathname.startsWith("/setup")) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        if (headers) {
          for (const [k, v] of Object.entries(headers)) supabaseResponse.headers.set(k, v);
        }
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const isAuthed = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!isAuthed && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname + request.nextUrl.search)}` : "";
    return NextResponse.redirect(url);
  }

  if (isAuthed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  supabaseResponse.headers.set("Cache-Control", "private, no-store");
  return supabaseResponse;
}
