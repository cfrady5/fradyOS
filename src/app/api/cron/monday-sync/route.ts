import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isMondayConfigured } from "@/lib/monday/client";
import { runMondaySync } from "@/lib/monday/sync";
import { runMondaySocialSync } from "@/lib/monday/social-sync";
import type { MondayConnection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scheduled Monday.com sync for every connection with auto-sync enabled. */
export async function GET(request: NextRequest) {
  const auth = isAuthorizedCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });
  if (!isMondayConfigured()) return NextResponse.json({ skipped: true, reason: "MONDAY_API_TOKEN not set" });

  const supabase = createAdminClient();
  const { data: connections, error } = await supabase.from("monday_connections").select("*").eq("auto_sync_enabled", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown>[] = [];
  for (const conn of (connections ?? []) as MondayConnection[]) {
    try {
      const r = conn.purpose === "social" ? await runMondaySocialSync(supabase, conn.user_id, conn, "scheduled") : await runMondaySync(supabase, conn.user_id, conn, "scheduled");
      results.push({ user_id: conn.user_id, purpose: conn.purpose, board_id: conn.board_id, ok: true, ...r });
    } catch (e) {
      results.push({ user_id: conn.user_id, board_id: conn.board_id, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ synced: results.length, results });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
