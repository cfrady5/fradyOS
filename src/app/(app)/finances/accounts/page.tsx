import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { AccountsView } from "./accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const data = await getFinanceData();
  return <AccountsView accounts={data.accounts} debts={data.debts} today={data.ws.today} />;
}
