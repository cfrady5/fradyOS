import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { runHealthIntelligence } from "@/lib/intel/pipeline";
import { deriveAndStore } from "@/lib/strap/ingest";
import { todayIn } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily recompute for every user with health data, so baselines and events roll forward even without new imports. */
export async function GET(request: NextRequest) {
  const auth = isAuthorizedCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select("id,timezone");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results: { user_id: string; ok: boolean; error?: string; findings?: number }[] = [];
  for (const p of (data ?? []) as { id: string; timezone: string | null }[]) {
    const timezone = p.timezone || "America/Indiana/Indianapolis";
    const today = todayIn(timezone);
    // Strap minutes that arrived without a recorder pull (live heart rate only) still get derived daily.
    const { count: minuteCount } = await admin.from("strap_minutes").select("minute", { count: "exact", head: true }).eq("user_id", p.id);
    if (minuteCount) {
      const { data: dev } = await admin.from("strap_devices").select("max_hr").eq("user_id", p.id).limit(1).maybeSingle();
      const fromDay = new Date(Date.parse(today) - 3 * 86_400_000).toISOString().slice(0, 10);
      await deriveAndStore(admin, p.id, { fromDay, toDay: today, today, timezone, maxHr: (dev as { max_hr: number | null } | null)?.max_hr ?? null }).catch(() => undefined);
    }
    const { count } = await admin.from("health_days").select("id", { count: "exact", head: true }).eq("user_id", p.id);
    if (!count) continue;
    const out = await runHealthIntelligence(admin, p.id, { kind: "scheduled", today, timezone });
    results.push(out.ok ? { user_id: p.id, ok: true, findings: out.stats.findings } : { user_id: p.id, ok: false, error: out.error });
  }
  return NextResponse.json({ processed: results.length, results });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
