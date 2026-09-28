import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { runProjection } from "@/lib/finance/engine";
import { TimelineView, type TimelineEntry } from "./timeline-view";
import { addMonths } from "@/lib/dates";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinePage() {
  const data = await getFinanceData(360);
  const p = runProjection(data.inputs);
  const entries: TimelineEntry[] = [];
  for (const g of p.goals) {
    if (g.status === "completed") continue;
    entries.push({ id: `goal:${g.id}`, kind: "goal", title: g.name, date: g.projectedDate ?? g.targetDate, projectedDate: g.projectedDate, targetDate: g.targetDate, amount: g.targetAmount, status: g.status, href: "/finances/goals" });
  }
  for (const d of p.debts) {
    if (d.startBalance > 0 && d.payoffDate) entries.push({ id: `debt:${d.accountId}`, kind: "debt", title: `${d.name} paid off`, date: d.payoffDate, projectedDate: d.payoffDate, targetDate: null, amount: d.startBalance, href: "/finances/debt" });
  }
  if (p.debtFreeMonth && p.debtFreeDate && p.debts.filter((d) => d.startBalance > 0).length > 1) entries.push({ id: "debtfree", kind: "debt", title: "Debt-free", date: p.debtFreeDate, projectedDate: p.debtFreeDate, targetDate: null, amount: null, href: "/finances/debt" });
  for (const m of p.milestones.slice(0, 4)) entries.push({ id: `nw:${m.amount}`, kind: "net_worth", title: `Net worth ${m.amount >= 1_000_000 ? `$${m.amount / 1_000_000}M` : `$${m.amount / 1000}k`}`, date: m.date, projectedDate: m.date, targetDate: null, amount: m.amount, href: "/finances" });
  for (const m of data.milestones) {
    entries.push({ id: `ms:${m.id}`, kind: "milestone", title: m.title, date: m.target_date ?? m.projected_date, projectedDate: m.projected_date, targetDate: m.target_date, amount: m.amount, done: m.is_done, milestone: m, eventName: m.linked_event_id ? data.upcomingEvents.find((e) => e.id === m.linked_event_id)?.name ?? null : null, href: "/finances/timeline" });
  }
  const horizonEnd = addMonths(data.ws.today, 360);
  const sorted = entries.filter((e) => e.date && e.date <= horizonEnd).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  const undated = entries.filter((e) => !e.date);
  return <TimelineView entries={[...sorted, ...undated]} today={data.ws.today} milestones={data.milestones} goals={data.goals} events={data.upcomingEvents} />;
}
