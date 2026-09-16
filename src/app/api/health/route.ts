import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isMondayConfigured } from "@/lib/monday/client";
import { isMondayWebhookConfigured } from "@/lib/monday/webhook";
import { isAdminConfigured } from "@/lib/supabase/admin";

export function GET() {
  return NextResponse.json({
    ok: true,
    supabase: isSupabaseConfigured(),
    supabase_admin: isAdminConfigured(),
    monday: isMondayConfigured(),
    monday_webhook: isMondayWebhookConfigured(),
    email: Boolean(process.env.RESEND_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
  });
}
