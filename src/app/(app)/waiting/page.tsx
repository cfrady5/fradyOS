import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { listTasks } from "@/lib/data/tasks";
import { WaitingView } from "./waiting-view";

export const metadata: Metadata = { title: "Waiting On" };

export default async function WaitingPage({ searchParams }: PageProps<"/waiting">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const area = typeof sp.area === "string" && sp.area ? sp.area : null;
  const showReceived = sp.received === "1";
  const tasks = await listTasks(ws.userId, { today: ws.today, status: "waiting", area, limit: 500 });
  const received = showReceived
    ? (await listTasks(ws.userId, { today: ws.today, status: "all", includeCompleted: true, area, limit: 500 })).filter((t) => t.waiting_received_at).sort((a, b) => (a.waiting_received_at! > b.waiting_received_at! ? -1 : 1)).slice(0, 50)
    : [];
  return <WaitingView tasks={tasks} received={received} area={area} showReceived={showReceived} />;
}
