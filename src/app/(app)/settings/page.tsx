import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "./settings-view";
import type { EventTemplate, EventTemplateItem, MondayConnection, MondaySyncRun } from "@/lib/types";
import { isMondayConfigured } from "@/lib/monday/client";
import { getMondayWebhookUrl } from "@/lib/monday/webhook";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const supabase = await createClient();
  const [conns, runs, templates, items] = await Promise.all([
    supabase.from("monday_connections").select("*").eq("user_id", ws.userId),
    supabase.from("monday_sync_runs").select("*").eq("user_id", ws.userId).order("started_at", { ascending: false }).limit(12),
    supabase.from("event_templates").select("*").eq("user_id", ws.userId).order("is_default", { ascending: false }).order("name"),
    supabase.from("event_template_items").select("*").eq("user_id", ws.userId).order("sort_order"),
  ]);
  const tab = typeof sp.tab === "string" ? sp.tab : "general";
  const webhookUrl = await getMondayWebhookUrl();
  return (
    <SettingsView
      tab={tab}
      profile={ws.profile}
      workAreas={ws.workAreas}
      email={ws.email}
      monday={{
        tokenConfigured: isMondayConfigured(),
        connections: {
          events: (((conns.data ?? []) as MondayConnection[]).find((c) => c.purpose === "events") ?? null),
          social: (((conns.data ?? []) as MondayConnection[]).find((c) => c.purpose === "social") ?? null),
        },
        runs: (runs.data ?? []) as MondaySyncRun[],
        webhookUrl,
      }}
      emailConfigured={Boolean(process.env.RESEND_API_KEY)}
      adminConfigured={Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)}
      cronConfigured={Boolean(process.env.CRON_SECRET)}
      templates={(templates.data ?? []) as EventTemplate[]}
      templateItems={(items.data ?? []) as EventTemplateItem[]}
    />
  );
}
