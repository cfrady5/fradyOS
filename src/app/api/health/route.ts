import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function GET() {
  return NextResponse.json({ ok: true, supabase: isSupabaseConfigured(), monday: Boolean(process.env.MONDAY_API_TOKEN), email: Boolean(process.env.RESEND_API_KEY), cron: Boolean(process.env.CRON_SECRET) });
}
