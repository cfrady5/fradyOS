import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getCompletedData } from "@/lib/data/completed";
import { endOfWeek, startOfWeek, startOfMonth, endOfMonth, addDays } from "@/lib/dates";
import { CompletedView } from "./completed-view";

export const metadata: Metadata = { title: "Completed" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : null;
}

export default async function CompletedPage({ searchParams }: PageProps<"/completed">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const range = str(sp.range) ?? "week";
  const wso = ws.profile.week_starts_on;
  let from: string;
  let to: string;
  if (range === "custom" && str(sp.from) && str(sp.to)) {
    from = str(sp.from)!;
    to = str(sp.to)!;
  } else if (range === "lastweek") {
    from = startOfWeek(addDays(ws.today, -7), wso);
    to = endOfWeek(addDays(ws.today, -7), wso);
  } else if (range === "month") {
    from = startOfMonth(ws.today);
    to = endOfMonth(ws.today);
  } else if (range === "30") {
    from = addDays(ws.today, -29);
    to = ws.today;
  } else {
    from = startOfWeek(ws.today, wso);
    to = endOfWeek(ws.today, wso);
  }
  const area = str(sp.area);
  const project = str(sp.project);
  const data = await getCompletedData(ws.userId, ws.today, ws.timezone, wso, { from, to, area, project });
  return <CompletedView data={data} range={range} from={from} to={to} area={area} project={project} />;
}
