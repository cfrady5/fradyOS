import { getFinanceData } from "@/lib/data/finance";
import { runProjection } from "@/lib/finance/engine";
import { computeInsights } from "@/lib/finance/insights";
import { DEFAULT_HORIZON_MONTHS } from "@/lib/finance/model";
import { OverviewView } from "./overview-view";

export default async function FinancesOverviewPage({ searchParams }: PageProps<"/finances">) {
  const sp = await searchParams;
  const h = typeof sp.h === "string" ? parseInt(sp.h, 10) : NaN;
  const months = Number.isFinite(h) && h >= 1 && h <= 600 ? h : DEFAULT_HORIZON_MONTHS;
  const data = await getFinanceData(months);
  const projection = runProjection(data.inputs);
  const insights = computeInsights(data.inputs, projection).slice(0, 4);
  return <OverviewView profile={data.profile} accounts={data.accounts} goals={data.goals} history={data.history} projection={projection} insights={insights} months={months} isEmpty={data.isEmpty} />;
}
