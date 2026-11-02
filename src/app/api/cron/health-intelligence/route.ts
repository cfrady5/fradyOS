import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { runHealthIntelligence } from "@/lib/intel/pipeline";
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
    const { count } = await admin.from("health_days").select("id", { count: "exact", head: true }).eq("user_id", p.id);
    if (!count) continue;
    const timezone = p.timezone || "America/Indiana/Indianapolis";
    const out = await runHealthIntelligence(admin, p.id, { kind: "scheduled", today: todayIn(timezone), timezone });
    results.push(out.ok ? { user_id: p.id, ok: true, findings: out.stats.findings } : { user_id: p.id, ok: false, error: out.error });
  }
  return NextResponse.json({ processed: results.length, results });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
