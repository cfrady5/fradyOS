import { eventsFor, loadIntelPage, meta } from "../_shared";
import { longTermSeries } from "@/lib/intel/engines/longterm";
import { TrendsView } from "./trends-view";

export const metadata = meta("Trends");

export default async function TrendsPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <TrendsView series={longTermSeries(ctx)} trend={intel.derived.filter((d) => d.key === "health_trend").at(-1) ?? null} events={eventsFor(intel, ["longterm"], { includeStatus: true })} today={ws.today} />;
}
