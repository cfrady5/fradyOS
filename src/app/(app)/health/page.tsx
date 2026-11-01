import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { getIntelData } from "@/lib/data/intel";
import { createClient } from "@/lib/supabase/server";
import { runHealthIntelligence } from "@/lib/intel/pipeline";
import { HealthNotReady } from "@/components/health/bits";
import { OverviewView } from "./overview-view";

export default async function HealthPage() {
  const ws = await requireWorkspace();
  const health = await getHealthData(ws.userId, ws.today, 90);
  if (health.notReady) return <HealthNotReady />;
  let intel = await getIntelData(ws.userId, ws.today);
  // First visit after data arrives: compute once so the page is never blank when there is data to read.
  if (!intel.notReady && !intel.hasRun && !health.isEmpty) {
    const supabase = await createClient();
    const out = await runHealthIntelligence(supabase, ws.userId, { kind: "recompute", today: ws.today, timezone: ws.timezone });
    if (out.ok) intel = await getIntelData(ws.userId, ws.today);
  }
  return <OverviewView intel={intel} healthEmpty={health.isEmpty} today={ws.today} />;
}
