import { eventsFor, loadIntelPage, meta } from "../_shared";
import { HeartView } from "./heart-view";

export const metadata = meta("Heart");

export default async function HeartPage() {
  const { ws, intel, ctx } = await loadIntelPage();
  return <HeartView days={ctx.days} baselines={ctx.baselines} events={eventsFor(intel, ["cardio", "recovery"])} correlations={intel.correlations.filter((c) => /^(cardio|recovery)\./.test(c.key))} today={ws.today} />;
}
