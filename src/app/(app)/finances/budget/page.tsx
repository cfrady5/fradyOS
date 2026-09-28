import type { Metadata } from "next";
import { getBudgetMonth, getFinanceData } from "@/lib/data/finance";
import { startOfMonth } from "@/lib/dates";
import { BudgetView } from "./budget-view";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: PageProps<"/finances/budget">) {
  const sp = await searchParams;
  const data = await getFinanceData();
  const m = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : startOfMonth(data.ws.today);
  const actuals = await getBudgetMonth(data.ws.userId, m);
  return <BudgetView profile={data.profile} categories={data.categories} actuals={actuals} month={m} today={data.ws.today} />;
}
