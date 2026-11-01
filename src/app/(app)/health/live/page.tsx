import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getLiveSessions } from "@/lib/data/health";
import { LiveView } from "./live-view";

export const metadata: Metadata = { title: "Live" };

export default async function HealthLivePage() {
  const ws = await requireWorkspace();
  const { sessions, notReady } = await getLiveSessions(ws.userId, 30);
  return <LiveView sessions={sessions} notReady={notReady} timezone={ws.timezone} />;
}
