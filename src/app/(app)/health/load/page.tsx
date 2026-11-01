import { eventsFor, loadIntelPage, meta } from "../_shared";
import { trainingLoad } from "@/lib/intel/engines/activity";
import { LoadView } from "./load-view";

export const metadata = meta("Load");

export default async function LoadPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <LoadView days={ctx.days} baselines={ctx.baselines} load={trainingLoad(ctx)} derived={intel.derived.filter((d) => d.key === "physiological_load")} events={eventsFor(intel, ["activity", "load"], { includeStatus: true })} today={ws.today} />;
}
