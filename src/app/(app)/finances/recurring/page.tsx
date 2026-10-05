import type { Metadata } from "next";
import { getFinanceData, getRecentTransactions, getRecurring } from "@/lib/data/finance";
import { RecurringView } from "./recurring-view";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const data = await getFinanceData();
  const [items, recent] = await Promise.all([getRecurring(data.ws.userId), getRecentTransactions(data.ws.userId, data.ws.today)]);
  return <RecurringView items={items} accounts={data.accounts} categories={data.categories} profile={data.profile} recent={recent} today={data.ws.today} />;
}
