import type { Metadata } from "next";
import { getFinanceData, getRecurring, getTransactionMonths, getTransactionsMonth } from "@/lib/data/finance";
import { startOfMonth } from "@/lib/dates";
import { TransactionsView } from "./transactions-view";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: PageProps<"/finances/transactions">) {
  const sp = await searchParams;
  const data = await getFinanceData();
  const months = await getTransactionMonths(data.ws.userId);
  const requested = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : null;
  const month = requested ?? months[0] ?? startOfMonth(data.ws.today);
  const [transactions, recurring] = await Promise.all([getTransactionsMonth(data.ws.userId, month), getRecurring(data.ws.userId)]);
  return <TransactionsView transactions={transactions} months={months} month={month} accounts={data.accounts} categories={data.categories} recurring={recurring} today={data.ws.today} />;
}
