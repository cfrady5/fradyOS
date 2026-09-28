import type { Metadata } from "next";
import { getFinanceData, getPlaidConnections } from "@/lib/data/finance";
import { isPlaidConfigured, plaidEnv, plaidProducts } from "@/lib/plaid/client";
import { keySource } from "@/lib/plaid/crypto";
import { AccountsView } from "./accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const data = await getFinanceData();
  const plaid = await getPlaidConnections(data.ws.userId);
  return (
    <AccountsView
      accounts={data.accounts}
      debts={data.debts}
      today={data.ws.today}
      plaid={{ status: { configured: isPlaidConfigured(), env: plaidEnv(), keySource: keySource(), products: plaidProducts() }, items: plaid.items, runs: plaid.runs }}
    />
  );
}
