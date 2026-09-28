"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart } from "@/components/finance/charts";
import { Disclaimer, StatTile } from "@/components/finance/bits";
import { AssumptionsPanel } from "@/components/finance/assumptions-panel";
import { setDebtOrder } from "@/actions/finance";
import type { Projection, StrategyComparison } from "@/lib/finance/engine";
import { DEBT_STRATEGIES, isLiability, type DebtStrategy, type FinancialAccount, type FinancialDebt, type FinancialProfile } from "@/lib/finance/types";
import { fmtMoney, fmtMonths, fmtPct } from "@/lib/finance/format";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function DebtView({ profile, accounts, debts, projection, comparison, curves }: { profile: FinancialProfile; accounts: FinancialAccount[]; debts: FinancialDebt[]; projection: Projection; comparison: StrategyComparison[]; curves: Record<DebtStrategy, number[]> }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const open = projection.debts.filter((d) => d.startBalance > 0);
  const totalDebt = open.reduce((s, d) => s + d.startBalance, 0);
  const totalMin = open.reduce((s, d) => s + d.monthlyPayment, 0);
  const weightedApr = totalDebt > 0 ? open.reduce((s, d) => s + d.rate * d.startBalance, 0) / totalDebt : 0;
  const current = comparison.find((c) => c.strategy === profile.debt_strategy)!;
  const debtByAccount = new Map(debts.map((d) => [d.account_id, d]));
  const customOrder = [...open].sort((a, b) => (debtByAccount.get(a.accountId)?.custom_order ?? 0) - (debtByAccount.get(b.accountId)?.custom_order ?? 0));

  const last = Math.max(0, ...Object.values(curves).map((c) => c.findIndex((v) => v <= 0)).map((i, _, arr) => (i < 0 ? Math.max(...arr.filter((x) => x >= 0), 60) : i)));
  const horizon = Math.min(curves.minimum.length - 1, Math.max(12, last + 2));
  const step = horizon > 130 ? 3 : 1;
  const idx = Array.from({ length: horizon + 1 }, (_, i) => i).filter((i) => i % step === 0 || i === horizon);
  const xLabels = idx.map((i) => formatDate(projection.points[i].date, "monthYear"));
  const series = (["minimum", "avalanche", "snowball", "custom"] as DebtStrategy[]).map((s, k) => ({ id: s, name: DEBT_STRATEGIES.find((d) => d.value === s)!.label, color: `var(--chart-${k + 1})`, values: idx.map((i) => curves[s][i]), dashed: s !== profile.debt_strategy }));

  function moveCustom(accountId: string, dir: -1 | 1) {
    const ids = customOrder.map((d) => d.accountId);
    const i = ids.indexOf(accountId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    startTransition(async () => {
      const res = await setDebtOrder(ids);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  if (!accounts.some((a) => isLiability(a.account_type) && !a.is_archived)) {
    return <EmptyState icon={<CreditCard />} title="No debts recorded" description="Add credit cards and loans as accounts. The debt plan, payoff date and interest math all come from there." action={<Button asChild><Link href="/finances/accounts"><Plus /> Add a debt</Link></Button>} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total debt" value={fmtMoney(totalDebt)} sub={`${open.length} balance${open.length === 1 ? "" : "s"} · ${fmtPct(weightedApr)} weighted APR`} />
        <StatTile label="Monthly payments" value={fmtMoney(totalMin + projection.cashFlow.extraDebt)} sub={`${fmtMoney(totalMin)} required + ${fmtMoney(projection.cashFlow.extraDebt)} extra`} />
        <StatTile label="Debt-free" value={projection.debtFreeDate ? formatDate(projection.debtFreeDate, "monthYear") : "Not in 30 yrs"} tone={projection.debtFreeDate ? undefined : "critical"} sub={projection.debtFreeMonth != null ? `${fmtMonths(projection.debtFreeMonth)} with ${DEBT_STRATEGIES.find((s) => s.value === profile.debt_strategy)?.label.toLowerCase()}` : "Increase payments to clear it"} />
        <StatTile label="Interest on the way" value={fmtMoney(projection.totalInterest)} sub={current.interestSavedVsMinimum > 0 ? `${fmtMoney(current.interestSavedVsMinimum)} less than minimums only` : "At minimum payments"} />
      </div>

      <AssumptionsPanel profile={profile} sections={["debt"]} title="Payoff plan" description="Pick the strategy and how much extra goes toward debt each month. Freed-up payments roll into the next debt automatically." compact />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Strategy comparison</CardTitle>
            <CardDescription className="mt-1">Same balances, same extra payment ({fmtMoney(profile.extra_debt_payment)}/mo); only the order changes.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Debt-free</TableHead>
                <TableHead className="text-right">Total interest</TableHead>
                <TableHead className="text-right">vs minimums</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.map((c) => (
                <TableRow key={c.strategy} className={cn(c.strategy === profile.debt_strategy ? "bg-muted/40" : null)}>
                  <TableCell className="font-medium">
                    {DEBT_STRATEGIES.find((s) => s.value === c.strategy)?.label}
                    {c.strategy === profile.debt_strategy ? <span className="text-muted-foreground ml-2 text-xs">current</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.debtFreeDate ? `${formatDate(c.debtFreeDate, "monthYear")} (${fmtMonths(c.debtFreeMonth)})` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(c.totalInterest)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.strategy === "minimum" ? "—" : `${c.interestSavedVsMinimum >= 0 ? "saves" : "costs"} ${fmtMoney(Math.abs(c.interestSavedVsMinimum))}${c.monthsSavedVsMinimum != null ? ` · ${fmtMonths(Math.abs(c.monthsSavedVsMinimum))} ${c.monthsSavedVsMinimum >= 0 ? "sooner" : "later"}` : ""}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LineChart xLabels={xLabels} series={series} height={200} ariaLabel="Total debt over time by strategy" />
          <Disclaimer />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Each debt</CardTitle>
            <CardDescription className="mt-1">Payoff dates under the current plan. Edit balances, APR and payments on Accounts.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/finances/accounts">Accounts</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {profile.debt_strategy === "custom" ? <TableHead className="w-16">Order</TableHead> : null}
                <TableHead>Debt</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">APR</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">Paid off</TableHead>
                <TableHead className="text-right">Interest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(profile.debt_strategy === "custom" ? customOrder : [...open].sort((a, b) => (a.payoffMonth ?? 9999) - (b.payoffMonth ?? 9999))).map((d, i) => (
                <TableRow key={d.accountId}>
                  {profile.debt_strategy === "custom" ? (
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <span className="w-4 text-xs tabular-nums">{i + 1}</span>
                        <Button variant="ghost" size="icon-xs" aria-label="Move up" onClick={() => moveCustom(d.accountId, -1)} disabled={pending || i === 0}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-xs" aria-label="Move down" onClick={() => moveCustom(d.accountId, 1)} disabled={pending || i === customOrder.length - 1}>
                          <ArrowDown />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(d.startBalance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(d.rate, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.monthlyPayment > 0 ? fmtMoney(d.monthlyPayment) : <span className="text-[#9a3f1a] dark:text-[#f3a582]">none set</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.payoffDate ? formatDate(d.payoffDate, "monthYear") : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(d.totalInterest)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
