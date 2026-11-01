import { eventsFor, loadIntelPage, meta } from "../_shared";
import { SleepView } from "./sleep-view";

export const metadata = meta("Sleep");

export default async function SleepPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <SleepView days={ctx.days} baselines={ctx.baselines} derived={intel.derived.filter((d) => d.key === "sleep_quality_index")} events={eventsFor(intel, ["sleep"])} today={ws.today} />;
}
