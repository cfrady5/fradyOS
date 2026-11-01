import { loadIntelPage, meta } from "../_shared";
import { ALL_RULES } from "@/lib/intel/engines";
import { ANOMALY_DISCLAIMER } from "@/lib/intel/engines/anomaly";
import { EventsView } from "./events-view";

export const metadata = meta("Events");

export default async function EventsPage() {
  const { ws, intel } = await loadIntelPage();
  return <EventsView events={intel.events} rules={ALL_RULES} disabled={intel.rulesDisabled} preferences={intel.preferences} jobs={intel.jobs} disclaimer={ANOMALY_DISCLAIMER} today={ws.today} />;
}
