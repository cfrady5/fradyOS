import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isPlaidConfigured } from "@/lib/plaid/client";
import { syncItems } from "@/lib/plaid/sync";
import type { PlaidItem } from "@/lib/finance/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scheduled refresh of every healthy Plaid connection (cached balances + new transactions; no per-call balance billing). */
export async function GET(request: NextRequest) {
  const auth = isAuthorizedCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });
  if (!isPlaidConfigured()) return NextResponse.json({ skipped: true, reason: "Plaid keys not set" });
  const admin = createAdminClient();
  const { data, error } = await admin.from("plaid_items").select("*").in("status", ["active", "error"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out = await syncItems(admin, (data ?? []) as PlaidItem[], { trigger: "scheduled", realtime: false });
  return NextResponse.json({ synced: out.filter((o) => o.ok).length, results: out.map((o) => ({ item_id: o.item.item_id, institution: o.item.institution_name, ok: o.ok, error: o.error ?? null, result: o.result ?? null })) });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
