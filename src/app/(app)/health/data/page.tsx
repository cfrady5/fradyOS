import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { DataView } from "./data-view";

export const metadata: Metadata = { title: "Data" };

export default async function HealthDataPage() {
  const ws = await requireWorkspace();
  const data = await getHealthData(ws.userId, ws.today, 3650);
  return <DataView imports={data.imports} dayCount={data.days.length} workoutCount={data.workouts.length} sleepCount={data.sleeps.length} />;
}
