import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getCalendarItems } from "@/lib/data/calendar";
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek, isDateOnly } from "@/lib/dates";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const view = (typeof sp.view === "string" && ["month", "week", "agenda"].includes(sp.view) ? sp.view : "month") as "month" | "week" | "agenda";
  const date = typeof sp.date === "string" && isDateOnly(sp.date) ? sp.date : ws.today;
  const wso = ws.profile.week_starts_on;
  let from: string;
  let to: string;
  if (view === "month") {
    from = startOfWeek(startOfMonth(date), wso);
    to = endOfWeek(endOfMonth(date), wso);
  } else if (view === "week") {
    from = startOfWeek(date, wso);
    to = endOfWeek(date, wso);
  } else {
    from = date;
    to = addDays(date, 30);
  }
  const items = await getCalendarItems(ws.userId, from, to);
  const preset = typeof sp.preset === "string" ? sp.preset : null;
  const types = typeof sp.types === "string" ? sp.types : null;
  return <CalendarView items={items} view={view} date={date} from={from} to={to} preset={preset} types={types} />;
}
