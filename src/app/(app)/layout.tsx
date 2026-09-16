import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/data/workspace";
import { listProjectOptions } from "@/lib/data/tasks";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/app-shell";
import { WorkspaceProvider } from "@/components/app/workspace-provider";
import type { Notification } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");

  const supabase = await createClient();
  const [projects, notifications] = await Promise.all([
    listProjectOptions(ws.userId),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", ws.userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <WorkspaceProvider
      value={{
        userId: ws.userId,
        email: ws.email,
        displayName: ws.profile.display_name,
        timezone: ws.timezone,
        today: ws.today,
        weekStartsOn: ws.profile.week_starts_on,
        workAreas: ws.workAreas.filter((a) => !a.is_archived),
        projects,
      }}
    >
      <AppShell unreadNotifications={(notifications.data ?? []) as Notification[]}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
