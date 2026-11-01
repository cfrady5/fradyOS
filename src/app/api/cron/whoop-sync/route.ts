import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isWhoopConfigured } from "@/lib/whoop/client";
import { syncConnection, type WhoopConnection } from "@/lib/whoop/sync";
import { todayIn } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scheduled refresh of every active WHOOP connection. Webhooks cover the day; this catches anything missed. */
export async function GET(request: NextRequest) {
  const auth = isAuthorizedCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });
  if (!isWhoopConfigured()) return NextResponse.json({ skipped: true, reason: "WHOOP keys not set" });
  const admin = createAdminClient();
  const { data, error } = await admin.from("whoop_connections").select("*").in("status", ["active", "error"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results: { user_id: string; ok: boolean; error?: string }[] = [];
  for (const conn of (data ?? []) as WhoopConnection[]) {
    const { data: profile } = await admin.from("profiles").select("timezone").eq("id", conn.user_id).maybeSingle();
    const timezone = (profile as { timezone?: string } | null)?.timezone || "America/Indiana/Indianapolis";
    try {
      await syncConnection(admin, conn, { timezone, today: todayIn(timezone), trigger: "scheduled" });
      results.push({ user_id: conn.user_id, ok: true });
    } catch (e) {
      results.push({ user_id: conn.user_id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ synced: results.filter((r) => r.ok).length, results });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
