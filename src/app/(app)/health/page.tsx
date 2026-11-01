import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { HealthNotReady } from "@/components/health/bits";
import { OverviewView } from "./overview-view";

export default async function HealthPage() {
  const ws = await requireWorkspace();
  const data = await getHealthData(ws.userId, ws.today, 90);
  if (data.notReady) return <HealthNotReady />;
  return <OverviewView days={data.days} workouts={data.workouts} summary={data.summary} today={ws.today} isEmpty={data.isEmpty} />;
}
