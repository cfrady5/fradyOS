import type { Metadata } from "next";
import { getFinanceData } from "@/lib/data/finance";
import { compareDebtStrategies, runProjection } from "@/lib/finance/engine";
import type { DebtStrategy } from "@/lib/finance/types";
import { DebtView } from "./debt-view";

export const metadata: Metadata = { title: "Debt" };

const STRATEGIES: DebtStrategy[] = ["minimum", "avalanche", "snowball", "custom"];

export default async function DebtPage() {
  const data = await getFinanceData(360);
  const projection = runProjection(data.inputs);
  const comparison = compareDebtStrategies(data.inputs);
  const curves = Object.fromEntries(STRATEGIES.map((s) => [s, runProjection({ ...data.inputs, profile: { ...data.inputs.profile, debtStrategy: s } }).points.map((p) => p.debt)])) as Record<DebtStrategy, number[]>;
  return <DebtView profile={data.profile} accounts={data.accounts} debts={data.debts} projection={projection} comparison={comparison} curves={curves} />;
}
