"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ArrowRight, Landmark, PiggyBank, TrendingUp, CreditCard, Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/app/items";
import { LineChart, ProgressMeter, StackedBar } from "@/components/finance/charts";
import { Disclaimer, GoalStatusBadge, StatTile, ToneBadge } from "@/components/finance/bits";
import { AssumptionsPanel } from "@/components/finance/assumptions-panel";
import type { Projection } from "@/lib/finance/engine";
import type { Insight } from "@/lib/finance/insights";
import { ACCOUNT_TYPES, isLiability, type FinancialAccount, type FinancialGoal, type FinancialProfile } from "@/lib/finance/types";
import { HORIZONS, GOAL_STATUS_META } from "@/lib/finance/model";
import { fmtMoney, fmtMonths } from "@/lib/finance/format";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function OverviewView({ profile, accounts, goals, history, projection, insights, months, isEmpty }: { profile: FinancialProfile; accounts: FinancialAccount[]; goals: FinancialGoal[]; history: { date: string; netWorth: number }[]; projection: Projection; insights: Insight[]; months: number; isEmpty: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const p = projection;
  const cf = p.cashFlow;
  const active = accounts.filter((a) => !a.is_archived);

  const groups = [
    { key: "cash", label: "Cash", icon: Landmark, items: active.filter((a) => a.account_type === "checking" || a.account_type === "savings") },
    { key: "investment", label: "Investments", icon: TrendingUp, items: active.filter((a) => a.account_type === "brokerage" || a.account_type === "retirement") },
    { key: "debt", label: "Debts", icon: CreditCard, items: active.filter((a) => isLiability(a.account_type)) },
    { key: "other", label: "Other assets", icon: PiggyBank, items: active.filter((a) => a.account_type === "other_asset") },
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

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Sparkles />}
          title="Start with three numbers and one account"
          description="Enter take-home income and monthly expenses, then add the accounts you have. Everything else — net worth, goal status, scenarios and the timeline — is projected from that."
          action={
            <div className="flex flex-wrap justify-center gap-2">
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
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Net worth today" value={fmtMoney(p.start.netWorth)} sub={`${fmtMoney(p.start.assets)} assets − ${fmtMoney(p.start.debt)} debt`} />
        <StatTile label="Free cash flow / month" value={fmtMoney(cf.free)} tone={cf.free < 0 ? "critical" : undefined} sub={`${fmtMoney(cf.income)} in · ${fmtMoney(cf.expenses)} expenses · ${fmtMoney(cf.debtPayments)} debt minimums`} />
        <StatTile label="Unallocated / month" value={fmtMoney(cf.unallocated)} tone={cf.unallocated < 0 ? "critical" : undefined} sub={cf.unallocated >= 0 ? `Lands in ${profile.surplus_destination} after goals and contributions` : "Contributions exceed free cash"} />
        <StatTile label={`Net worth in ${fmtMonths(months)}`} value={fmtMoney(p.end.netWorth)} sub={p.debtFreeDate && p.debtFreeMonth ? `Debt-free ${formatDate(p.debtFreeDate, "monthYear")}` : p.debtFreeMonth === 0 ? "No debt" : "Debt not cleared in this horizon"} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Projected net worth</CardTitle>
            <CardDescription className="mt-1">Month by month from today&rsquo;s balances, cash flow and assumptions.</CardDescription>
          </div>
          <NativeSelect className="w-32" value={String(months)} onChange={(e) => router.push(`${pathname}?h=${e.target.value}`)} aria-label="Projection horizon">
            {HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
            {!HORIZONS.some((h) => h.value === months) ? <option value={months}>{fmtMonths(months)}</option> : null}
          </NativeSelect>
        </CardHeader>
        <CardContent>
          <LineChart xLabels={xLabels} series={series} markers={markers} height={240} ariaLabel="Projected net worth, investments, cash and debt" />
          {p.firstShortfallMonth != null ? (
            <p className="mt-2 text-xs">
              <ToneBadge tone="critical">Cash shortfall</ToneBadge> <span className="text-muted-foreground">Checking goes negative in {formatDate(p.points[p.firstShortfallMonth].date, "monthYear")} at the current plan.</span>
            </p>
          ) : null}
          <Disclaimer className="mt-2" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Where each month goes</CardTitle>
              <CardDescription className="mt-1">Take-home {fmtMoney(cf.income)} split by what it funds first.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/finances/budget">
                Budget <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <StackedBar
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
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Emergency fund</CardTitle>
              <CardDescription className="mt-1">{profile.emergency_fund_months} months of expenses and minimums = {fmtMoney(p.emergencyFundTarget)}.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-semibold tabular-nums">{p.emergencyFundMonthsCovered.toFixed(1)} mo</span>
              <span className="text-muted-foreground text-xs">savings {fmtMoney(p.start.savings)}</span>
            </div>
            <ProgressMeter value={p.start.savings} target={p.emergencyFundTarget} tone={p.emergencyFundMonthsCovered >= profile.emergency_fund_months ? "good" : p.emergencyFundMonthsCovered >= 3 ? "warning" : "serious"} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader
            title="Accounts"
            count={active.length}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/finances/accounts">
                  Manage <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <Card key={g.key} className="gap-2 py-3">
                <CardHeader className="items-center">
                  <CardTitle className="flex items-center gap-2">
                    <g.icon className="text-muted-foreground size-4" /> {g.label}
                  </CardTitle>
                  <span className={cn("text-sm font-semibold tabular-nums", g.key === "debt" ? "text-[#a52a2a] dark:text-[#f08080]" : null)}>{g.key === "debt" ? "−" : ""}{fmtMoney(g.items.reduce((s, a) => s + a.balance, 0))}</span>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y text-sm">
                    {g.items.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">
                          {a.name}
                          <span className="text-muted-foreground ml-2 text-xs">{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}{a.interest_rate != null ? ` · ${a.interest_rate}%` : ""}</span>
                        </span>
                        <span className="tabular-nums">{fmtMoney(a.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
            {!groups.length ? (
              <EmptyState compact title="No accounts yet" action={<Button asChild size="sm"><Link href="/finances/accounts"><Plus /> Add account</Link></Button>} />
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader
              title="Goals"
              count={goals.filter((g) => g.status === "active").length}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/finances/goals">
                    All goals <ArrowRight />
                  </Link>
                </Button>
              }
            />
            {topGoals.length ? (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {topGoals.map((g) => (
                    <li key={g.id} className="flex flex-col gap-1.5 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{g.name}</span>
                        <GoalStatusBadge status={g.status} />
                      </div>
                      <ProgressMeter value={g.startAmount} target={g.targetAmount} tone={GOAL_STATUS_META[g.status].tone} />
                      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                        <span>
                          {fmtMoney(g.startAmount)} of {fmtMoney(g.targetAmount)}
                        </span>
                        <span>{g.projectedDate ? `Projected ${formatDate(g.projectedDate, "monthYear")}` : "Not reached in horizon"}{g.targetDate ? ` · target ${formatDate(g.targetDate, "monthYear")}` : ""}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState compact title="No goals yet" description="Goals turn cash flow into dates." action={<Button asChild size="sm"><Link href="/finances/goals"><Plus /> Add goal</Link></Button>} />
            )}
          </div>
          <div>
            <SectionHeader
              title="Insights"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/finances/insights">
                    All insights <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <ul className="flex flex-col gap-2">
              {insights.map((i) => (
                <li key={i.id}>
                  <Link href={i.href ?? "/finances/insights"} className="hover:bg-muted/60 flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm transition-colors">
                    <span className="flex items-center gap-2">
                      <ToneBadge tone={i.tone}>{i.tone === "good" ? "Good" : i.tone === "critical" ? "Act" : i.tone === "serious" ? "Watch" : i.tone === "warning" ? "Note" : "Info"}</ToneBadge>
                      <span className="font-medium">{i.title}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">{i.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {history.length >= 2 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Net worth history</CardTitle>
              <CardDescription className="mt-1">From balance updates you have recorded. Updating a balance on Accounts adds a point.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <LineChart xLabels={history.map((h) => formatDate(h.date, "monthYear"))} series={[{ id: "h", name: "Net worth", color: "var(--chart-1)", values: history.map((h) => h.netWorth) }]} height={160} />
          </CardContent>
        </Card>
      ) : null}

      <AssumptionsPanel profile={profile} />
    </div>
  );
}
