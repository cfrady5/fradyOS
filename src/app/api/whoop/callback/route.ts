import { after, type NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { connectWithCode, syncConnection, type WhoopConnection } from "@/lib/whoop/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exchanges the code, stores encrypted tokens and starts the 180-day backfill in the background. */
export async function GET(request: NextRequest) {
  const ws = await requireWorkspace();
  const back = (q: string) => NextResponse.redirect(new URL(`/health/data?whoop=${q}`, request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("whoop_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) return back("state_mismatch");
  if (!isAdminConfigured()) return back("admin_missing");
  const admin = createAdminClient();
  try {
    await connectWithCode(admin, ws.userId, code, new URL("/api/whoop/callback", request.url).toString());
  } catch (e) {
    return back(`error&message=${encodeURIComponent(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  const res = back("connected");
  res.cookies.delete("whoop_oauth_state");
  after(async () => {
    const { data } = await admin.from("whoop_connections").select("*").eq("user_id", ws.userId).maybeSingle();
    if (data) await syncConnection(admin, data as WhoopConnection, { timezone: ws.timezone, today: ws.today, trigger: "backfill" }).catch(() => undefined);
  });
  return res;
}
