import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isMondayConfigured } from "@/lib/monday/client";
import { isMondayWebhookConfigured } from "@/lib/monday/webhook";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { diagnosePlaidKeys, isPlaidConfigured, plaidEnv } from "@/lib/plaid/client";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { timingSafeEqual } from "@/lib/monday/webhook";
import { keySource } from "@/lib/plaid/crypto";

export async function GET(request: NextRequest) {
  // ?probe=plaid with the CRON_SECRET (Bearer or x-cron-secret header, or ?key=) runs the Plaid key diagnosis.
  if (request.nextUrl.searchParams.get("probe") === "plaid") {
    const key = request.nextUrl.searchParams.get("key");
    const secret = process.env.CRON_SECRET ?? "";
    const viaKey = Boolean(key && secret.length >= 16 && timingSafeEqual(key, secret));
    const auth = viaKey ? { ok: true as const } : isAuthorizedCron(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await diagnosePlaidKeys());
  }
  return NextResponse.json({
    ok: true,
    supabase: isSupabaseConfigured(),
    supabase_admin: isAdminConfigured(),
    monday: isMondayConfigured(),
    monday_webhook: isMondayWebhookConfigured(),
    email: Boolean(process.env.RESEND_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
    plaid: isPlaidConfigured(),
    plaid_env: plaidEnv(),
    plaid_token_key: keySource(),
  });
}
