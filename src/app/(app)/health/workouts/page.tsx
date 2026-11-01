import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { HealthNotReady } from "@/components/health/bits";
import { WorkoutsView } from "./workouts-view";

export const metadata: Metadata = { title: "Workouts" };

export default async function HealthWorkoutsPage() {
  const ws = await requireWorkspace();
  const data = await getHealthData(ws.userId, ws.today, 365);
  if (data.notReady) return <HealthNotReady />;
  return <WorkoutsView workouts={data.workouts} today={ws.today} />;
}
