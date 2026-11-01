import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { OverviewView } from "./overview-view";

export default async function HealthPage() {
  const ws = await requireWorkspace();
  const data = await getHealthData(ws.userId, ws.today, 90);
  return <OverviewView days={data.days} workouts={data.workouts} summary={data.summary} today={ws.today} isEmpty={data.isEmpty} />;
}
