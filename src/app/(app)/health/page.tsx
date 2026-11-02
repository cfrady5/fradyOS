import { requireWorkspace } from "@/lib/data/workspace";
import { getHealthData } from "@/lib/data/health";
import { getIntelData } from "@/lib/data/intel";
import { createClient } from "@/lib/supabase/server";
import { runHealthIntelligence } from "@/lib/intel/pipeline";
import { getStrapData } from "@/lib/data/strap";
import { deriveAndStore } from "@/lib/strap/ingest";
import { HealthNotReady } from "@/components/health/bits";
import { OverviewView } from "./overview-view";

export default async function HealthPage() {
  const ws = await requireWorkspace();
  let health = await getHealthData(ws.userId, ws.today, 90);
  if (health.notReady) return <HealthNotReady />;
  const strap = await getStrapData(ws.userId, ws.today, ws.timezone);
  // Minutes are arriving from the strap but no day has been derived yet (the first recorder pull may still be
  // running): derive the last few days now so the page reflects what has been collected so far.
  if (health.isEmpty && strap.totalMinutes > 0) {
    const supabase = await createClient();
    const fromDay = new Date(Date.parse(ws.today) - 3 * 86_400_000).toISOString().slice(0, 10);
    await deriveAndStore(supabase, ws.userId, { fromDay, toDay: ws.today, today: ws.today, timezone: ws.timezone, maxHr: strap.devices[0]?.max_hr ?? null }).catch(() => undefined);
    health = await getHealthData(ws.userId, ws.today, 90);
  }
  let intel = await getIntelData(ws.userId, ws.today);
  // First visit after data arrives: compute once so the page is never blank when there is data to read.
  if (!intel.notReady && !intel.hasRun && !health.isEmpty) {
    const supabase = await createClient();
    const out = await runHealthIntelligence(supabase, ws.userId, { kind: "recompute", today: ws.today, timezone: ws.timezone });
    if (out.ok) intel = await getIntelData(ws.userId, ws.today);
  }
  return <OverviewView intel={intel} healthEmpty={health.isEmpty} today={ws.today} strapMinutes={strap.totalMinutes} strapToday={strap.coverage.at(-1)?.minutes ?? 0} />;
}
