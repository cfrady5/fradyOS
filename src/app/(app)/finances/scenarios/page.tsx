import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { ScenariosView } from "./scenarios-view";

export const metadata: Metadata = { title: "Scenarios" };

export default async function ScenariosPage({ searchParams }: PageProps<"/finances/scenarios">) {
  const sp = await searchParams;
  const data = await getFinanceData();
  const load = typeof sp.load === "string" ? sp.load : null;
  return <ScenariosView inputs={data.inputs} accounts={data.accounts} scenarios={data.scenarios} loadId={load} />;
}
