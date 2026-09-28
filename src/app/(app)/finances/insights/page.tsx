import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { runProjection } from "@/lib/finance/engine";
import { computeInsights } from "@/lib/finance/insights";
import { InsightsView } from "./insights-view";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const data = await getFinanceData();
  const projection = runProjection(data.inputs);
  const insights = computeInsights(data.inputs, projection);
  return <InsightsView insights={insights} inputs={data.inputs} accounts={data.accounts} goals={data.goals} />;
}
