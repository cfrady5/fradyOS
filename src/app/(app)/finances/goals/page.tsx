import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { runProjection, suggestAllocation, withAllocation } from "@/lib/finance/engine";
import { GoalsView } from "./goals-view";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage() {
  const data = await getFinanceData();
  const projection = runProjection(data.inputs);
  // Money available for goals = what is unallocated today + what goals already take.
  const available = Math.max(0, projection.cashFlow.unallocated + projection.cashFlow.goalContributions);
  const allocation = suggestAllocation(data.inputs, available);
  const withSuggested = runProjection(withAllocation(data.inputs, allocation));
  return <GoalsView goals={data.goals} accounts={data.accounts} projection={projection} allocation={allocation} suggestedProjection={withSuggested} available={available} linkedProjects={data.linkedProjects} />;
}
