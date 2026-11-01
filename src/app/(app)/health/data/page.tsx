import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { HealthNotReady } from "@/components/health/bits";
import { Suspense } from "react";
import { getIntelData } from "@/lib/data/intel";
import { isWhoopConfigured } from "@/lib/whoop/client";
import { WhoopCard } from "@/components/health/whoop-card";
import { DataView } from "./data-view";

export const metadata: Metadata = { title: "Data" };

export default async function HealthDataPage() {
  const ws = await requireWorkspace();
  const data = await getHealthData(ws.userId, ws.today, 3650);
  if (data.notReady) return <HealthNotReady />;
  const intel = await getIntelData(ws.userId, ws.today);
  return (
    <div className="flex flex-col gap-8">
      <Suspense>
        <WhoopCard status={intel.whoop} configured={isWhoopConfigured()} />
      </Suspense>
      <DataView imports={data.imports} dayCount={data.days.length} workoutCount={data.workouts.length} sleepCount={data.sleeps.length} />
    </div>
  );
}
