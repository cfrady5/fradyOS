import { eventsFor, loadIntelPage, meta } from "../_shared";
import { behaviorInsights } from "@/lib/intel/engines/behavior";
import { HabitsView } from "./habits-view";

export const metadata = meta("Habits");

export default async function HabitsPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <HabitsView behaviors={intel.behaviors} insights={behaviorInsights(ctx)} events={eventsFor(intel, ["behavior"])} today={ws.today} timezone={ws.timezone} />;
}
