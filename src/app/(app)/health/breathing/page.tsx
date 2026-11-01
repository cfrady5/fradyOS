import { eventsFor, loadIntelPage, meta } from "../_shared";
import { deviationPanel } from "@/lib/intel/engines/temperature";
import { BreathingView } from "./breathing-view";

export const metadata = meta("Breathing and temperature");

export default async function BreathingPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <BreathingView days={ctx.days} baselines={ctx.baselines} panel={deviationPanel(ctx)} events={eventsFor(intel, ["respiratory", "temperature"])} today={ws.today} />;
}
