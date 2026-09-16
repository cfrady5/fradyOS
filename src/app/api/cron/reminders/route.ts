import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { generateNotificationsForUser } from "@/lib/notifications";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { todayIn, DEFAULT_TIMEZONE } from "@/lib/dates";
import type { Notification, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Scheduled reminders: generates deduplicated in-app notifications for every user and,
 * when email is configured and the user opted in, sends one digest of not-yet-emailed items.
 */
export async function GET(request: NextRequest) {
  const auth = isAuthorizedCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });

  const supabase = createAdminClient();
  const { data: profiles, error } = await supabase.from("profiles").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const emailOk = isEmailConfigured();
  const results: Record<string, unknown>[] = [];
  for (const p of (profiles ?? []) as Profile[]) {
    const today = todayIn(p.timezone || DEFAULT_TIMEZONE);
    try {
      const created = await generateNotificationsForUser(supabase, p.id, p, today);
      await supabase.from("profiles").update({ notifications_generated_at: new Date().toISOString() }).eq("id", p.id);
      let emailed = 0;
      let emailStatus: string = p.email_reminders_enabled ? (emailOk ? "sent" : "not_configured") : "disabled";
      if (p.email_reminders_enabled && emailOk) {
        const { data: pending } = await supabase.from("notifications").select("*").eq("user_id", p.id).is("read_at", null).is("emailed_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(50);
        const list = (pending ?? []) as Notification[];
        if (list.length) {
          const { data: user } = await supabase.auth.admin.getUserById(p.id);
          const to = user?.user?.email;
          if (to) {
            const lines = list.map((n) => `• ${n.title}${n.body ? ` — ${n.body}` : ""}`);
            const text = `FRADY OS reminders for ${today}\n\n${lines.join("\n")}\n\nOpen FRADY OS to act on these.`;
            await sendEmail(to, `FRADY OS: ${list.length} reminder${list.length === 1 ? "" : "s"} for ${today}`, text);
            await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", list.map((n) => n.id));
            emailed = list.length;
          } else emailStatus = "no_email_address";
        } else emailStatus = "nothing_new";
      }
      results.push({ user_id: p.id, created, emailed, email: emailStatus });
    } catch (e) {
      results.push({ user_id: p.id, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ users: results.length, results });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
