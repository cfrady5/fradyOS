"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaRow, RowList, SectionHeader, SectionLink, SubHeading } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { LineChart, ProgressMeter, StackedBar } from "@/components/finance/charts";
import { Disclaimer, GoalStatusBadge, ToneBadge } from "@/components/finance/bits";
import { AssumptionsPanel } from "@/components/finance/assumptions-panel";
import type { Projection } from "@/lib/finance/engine";
import type { Insight } from "@/lib/finance/insights";
import { ACCOUNT_TYPES, isLiability, type FinancialAccount, type FinancialGoal, type FinancialProfile } from "@/lib/finance/types";
import { HORIZONS, GOAL_STATUS_META } from "@/lib/finance/model";
import { fmtMoney, fmtMonths } from "@/lib/finance/format";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const INSIGHT_LABEL: Record<Insight["tone"], string> = { good: "Good", critical: "Act", serious: "Watch", warning: "Note", neutral: "Info" };

export function OverviewView({ profile, accounts, goals, history, projection, insights, months, isEmpty }: { profile: FinancialProfile; accounts: FinancialAccount[]; goals: FinancialGoal[]; history: { date: string; netWorth: number }[]; projection: Projection; insights: Insight[]; months: number; isEmpty: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const p = projection;
  const cf = p.cashFlow;
  const active = accounts.filter((a) => !a.is_archived);

  const groups = [
    { key: "cash", label: "Cash", items: active.filter((a) => a.account_type === "checking" || a.account_type === "savings") },
    { key: "investment", label: "Investments", items: active.filter((a) => a.account_type === "brokerage" || a.account_type === "retirement") },
    { key: "debt", label: "Debts", items: active.filter((a) => isLiability(a.account_type)) },
    { key: "other", label: "Other assets", items: active.filter((a) => a.account_type === "other_asset") },
  ].filter((g) => g.items.length);

  const step = p.points.length > 130 ? 3 : 1;
  const idx = p.points.map((_, i) => i).filter((i) => i % step === 0 || i === p.points.length - 1);
  const xLabels = idx.map((i) => formatDate(p.points[i].date, "monthYear"));
  const series = [
    { id: "nw", name: "Net worth", color: "var(--chart-1)", values: idx.map((i) => p.points[i].netWorth) },
    { id: "inv", name: "Investments", color: "var(--chart-2)", values: idx.map((i) => p.points[i].investments + p.points[i].retirement) },
    { id: "cash", name: "Cash", color: "var(--chart-3)", values: idx.map((i) => p.points[i].cash) },
    { id: "debt", name: "Debt", color: "var(--chart-5)", values: idx.map((i) => p.points[i].debt) },
  ];
  const markers = [...(p.debtFreeMonth && p.debtFreeMonth > 0 ? [{ index: idx.findIndex((i) => i >= p.debtFreeMonth!), label: "Debt-free" }] : []), ...p.milestones.slice(0, 2).map((m) => ({ index: idx.findIndex((i) => i >= m.month), label: fmtMoney(m.amount, { compact: true }) }))].filter((m) => m.index >= 0);

  const topGoals = p.goals.filter((g) => g.status !== "completed").slice(0, 4);
  const shortfall = p.firstShortfallMonth != null ? p.points[p.firstShortfallMonth] : null;
  const debtSub = p.debtFreeDate && p.debtFreeMonth ? `debt-free ${formatDate(p.debtFreeDate, "monthYear")}` : p.debtFreeMonth === 0 ? "no debt" : "not cleared in this horizon";
  const efMonths = profile.emergency_fund_months;
  const efTone = p.emergencyFundMonthsCovered >= efMonths ? "neutral" : p.emergencyFundMonthsCovered >= 3 ? "warning" : "serious";

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          variant="page"
          icon={<Sparkles />}
          title="Start with three numbers and one account"
          description="Enter take-home income and monthly expenses, then add your accounts; net worth, goals, scenarios and the timeline are projected from there."
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/finances/accounts">
                  <Plus /> Add an account
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/finances/budget">Enter income &amp; expenses</Link>
              </Button>
            </div>
          }
        />
        <AssumptionsPanel profile={profile} sections={["income"]} title="Income and expenses" description="Start here. These drive the monthly cash flow that funds every goal." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The four numbers that matter most; everything else sits below them. */}
      <MetricStrip cols={4}>
        <Metric label="Net worth" tag="Current" value={fmtMoney(p.start.netWorth)} sub={`${fmtMoney(p.start.assets)} assets − ${fmtMoney(p.start.debt)} debt`} />
        <Metric label="Free cash flow / mo" tag="Current" value={fmtMoney(cf.free)} tone={cf.free < 0 ? "critical" : "neutral"} sub={`${fmtMoney(cf.income)} in · ${fmtMoney(cf.expenses)} expenses · ${fmtMoney(cf.debtPayments)} minimums`} href="/finances/budget" />
        <Metric label="Debt" tag="Current" value={fmtMoney(p.start.debt)} muted={p.start.debt === 0} sub={debtSub} href="/finances/debt" />
        {shortfall ? (
          <Metric label="Next cash shortfall" tag="Projected" value={formatDate(shortfall.date, "monthYear")} tone="critical" sub="checking goes negative at the current plan" href="/finances/budget" />
        ) : (
          <Metric label="Next cash shortfall" tag="Projected" value="None" muted sub={`no month goes negative in ${fmtMonths(months)}`} />
        )}
      </MetricStrip>

      <section aria-labelledby="fin-projected">
        <SectionHeader
          title={<span id="fin-projected">Projected net worth</span>}
          hint="month by month from today's balances, cash flow and assumptions"
          action={
            <NativeSelect className="h-8 w-32" value={String(months)} onChange={(e) => router.push(`${pathname}?h=${e.target.value}`)} aria-label="Projection horizon">
              {HORIZONS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
              {!HORIZONS.some((h) => h.value === months) ? <option value={months}>{fmtMonths(months)}</option> : null}
            </NativeSelect>
          }
        />
        <MetricStrip cols={3} className="mt-3 mb-4">
          <Metric size="sm" label={`Net worth in ${fmtMonths(months)}`} tag="Projected" value={fmtMoney(p.end.netWorth)} sub={`${fmtMoney(p.end.netWorth - p.start.netWorth, { sign: true, compact: true })} vs today`} />
          <Metric size="sm" label="Debt-free" tag="Projected" value={p.debtFreeMonth === 0 ? "Today" : p.debtFreeDate ? formatDate(p.debtFreeDate, "monthYear") : "Not in horizon"} muted={p.debtFreeMonth === 0} tone={p.debtFreeMonth === 0 || p.debtFreeDate ? "neutral" : "warning"} sub={p.debtFreeMonth ? `in ${fmtMonths(p.debtFreeMonth)}` : p.debtFreeMonth === 0 ? "no debt" : "increase payments to clear it"} href="/finances/debt" />
          <Metric size="sm" label="Unallocated / mo" tag="Current" value={fmtMoney(cf.unallocated)} muted={cf.unallocated === 0} tone={cf.unallocated < 0 ? "critical" : "neutral"} sub={cf.unallocated >= 0 ? `lands in ${profile.surplus_destination} after goals and contributions` : "contributions exceed free cash"} href="/finances/goals" />
        </MetricStrip>
        <LineChart xLabels={xLabels} series={series} markers={markers} height={240} ariaLabel="Projected net worth, investments, cash and debt" />
        {shortfall ? (
          <p className="text-meta mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="destructive">Cash shortfall</Badge>
            <span className="text-text-2">Checking goes negative in {formatDate(shortfall.date, "monthYear")} at the current plan.</span>
          </p>
        ) : null}
        <Disclaimer className="mt-3" />
      </section>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="min-w-0 lg:col-span-3" aria-labelledby="fin-allocation">
          <SectionHeader title={<span id="fin-allocation">Where each month goes</span>} hint={`take-home ${fmtMoney(cf.income)} split by what it funds first`} action={<SectionLink href="/finances/budget">Budget</SectionLink>} />
          <StackedBar
            className="mt-4"
            ariaLabel="Monthly income allocation"
            total={Math.max(cf.income, cf.expenses + cf.debtPayments + cf.extraDebt + cf.contributions + cf.goalContributions + Math.max(0, cf.unallocated))}
            segments={[
              { id: "exp", label: "Living expenses", value: cf.expenses, color: "var(--chart-4)" },
              { id: "debt", label: "Debt minimums", value: cf.debtPayments, color: "var(--chart-5)" },
              { id: "extra", label: "Extra debt", value: cf.extraDebt, color: "var(--chart-2)" },
              { id: "contrib", label: "Contributions", value: cf.contributions + cf.goalContributions, color: "var(--chart-3)" },
              { id: "free", label: "Unallocated", value: Math.max(0, cf.unallocated), color: "var(--chart-1)" },
            ]}
          />
        </section>
        <section className="min-w-0 lg:col-span-2" aria-labelledby="fin-ef">
          <SectionHeader title={<span id="fin-ef">Emergency fund</span>} hint={`${efMonths} months of expenses and minimums`} />
          <div className="mt-3">
            <Metric size="sm" label="Covered" tag="Current" value={`${p.emergencyFundMonthsCovered.toFixed(1)} mo`} tone={efTone} sub={`${fmtMoney(p.start.savings)} savings of ${fmtMoney(p.emergencyFundTarget)} target`} />
            <ProgressMeter className="mt-2" value={p.start.savings} target={p.emergencyFundTarget} tone={efTone === "neutral" ? "good" : efTone} />
          </div>
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="fin-accounts">
          <SectionHeader title={<span id="fin-accounts">Accounts</span>} count={active.length} action={<SectionLink href="/finances/accounts">Manage</SectionLink>} />
          {groups.length ? (
            groups.map((g) => {
              const total = g.items.reduce((s, a) => s + a.balance, 0);
              return (
                <React.Fragment key={g.key}>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <SubHeading count={g.items.length}>{g.label}</SubHeading>
                    <span className="nums text-text-2 text-meta font-medium">
                      {g.key === "debt" ? "−" : ""}
                      {fmtMoney(total)}
                    </span>
                  </div>
                  <RowList>
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-2 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-text-1 truncate text-sm font-medium">{a.name}</div>
                          <MetaRow>
                            <span>{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}</span>
                            {a.interest_rate != null ? <span className="nums">{a.interest_rate}%</span> : null}
                          </MetaRow>
                        </div>
                        <span className="nums text-text-1 shrink-0 text-right text-sm">{fmtMoney(a.balance)}</span>
                      </div>
                    ))}
                  </RowList>
                </React.Fragment>
              );
            })
          ) : (
            <EmptyState
              className="mt-3"
              title="No accounts yet"
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/finances/accounts">
                    <Plus /> Add account
                  </Link>
                </Button>
              }
            />
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="fin-goals">
            <SectionHeader title={<span id="fin-goals">Goals</span>} count={goals.filter((g) => g.status === "active").length} action={<SectionLink href="/finances/goals">All goals</SectionLink>} />
            {topGoals.length ? (
              <RowList>
                {topGoals.map((g) => (
                  <div key={g.id} className="flex flex-col gap-1.5 px-2 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link href="/finances/goals" className="text-text-1 min-w-0 truncate text-sm font-medium hover:underline">
                        {g.name}
                      </Link>
                      <GoalStatusBadge status={g.status} />
                    </div>
                    <ProgressMeter value={g.startAmount} target={g.targetAmount} tone={GOAL_STATUS_META[g.status].tone} />
                    <div className="text-text-3 nums text-meta flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                      <span>
                        {fmtMoney(g.startAmount)} of {fmtMoney(g.targetAmount)}
                      </span>
                      <span>
                        {g.projectedDate ? `projected ${formatDate(g.projectedDate, "monthYear")}` : "not reached in horizon"}
                        {g.targetDate ? ` · target ${formatDate(g.targetDate, "monthYear")}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </RowList>
            ) : (
              <EmptyState
                className="mt-3"
                title="No goals yet"
                description="Goals turn cash flow into dates."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/finances/goals">
                      <Plus /> Add goal
                    </Link>
                  </Button>
                }
              />
            )}
          </section>
          <section aria-labelledby="fin-insights">
            <SectionHeader title={<span id="fin-insights">Insights</span>} count={insights.length} action={<SectionLink href="/finances/insights">All insights</SectionLink>} />
            {insights.length ? (
              <RowList>
                {insights.map((i) => (
                  <Link key={i.id} href={i.href ?? "/finances/insights"} className="hover:bg-surface-hover focus-visible:ring-brand/40 flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors outline-none focus-visible:ring-2">
                    <ToneBadge tone={i.tone} className="mt-0.5 shrink-0">
                      {INSIGHT_LABEL[i.tone]}
                    </ToneBadge>
                    <span className="min-w-0 flex-1">
                      <span className="text-text-1 block text-sm font-medium">{i.title}</span>
                      <span className="text-text-3 text-meta block">{i.body}</span>
                    </span>
                  </Link>
                ))}
              </RowList>
            ) : (
              <EmptyState className="mt-3" title="Nothing to flag" description="Insights appear as the numbers change." />
            )}
          </section>
        </div>
      </div>

      {history.length >= 2 ? (
        <section aria-labelledby="fin-history">
          <SectionHeader title={<span id="fin-history">Net worth history</span>} count={history.length} hint="from the balance updates you have recorded" />
          <LineChart className={cn("mt-4")} xLabels={history.map((h) => formatDate(h.date, "monthYear"))} series={[{ id: "h", name: "Net worth", color: "var(--chart-1)", values: history.map((h) => h.netWorth) }]} height={160} ariaLabel="Net worth history" />
        </section>
      ) : null}

      <AssumptionsPanel profile={profile} />
    </div>
  );
}
