"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Archive, Check, Loader2, Landmark } from "lucide-react";
import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssumptionsPanel } from "@/components/finance/assumptions-panel";
import { MoneyInput } from "@/components/finance/bits";
import { archiveBudgetCategory, saveBudgetActual, saveBudgetCategory, saveFinancialProfile } from "@/actions/finance";
import type { BudgetLive } from "@/lib/data/finance";
import { averageCashFlow } from "@/lib/plaid/mapping";
import { Badge } from "@/components/ui/badge";
import type { BudgetActual, BudgetCategory, BudgetKind, FinancialProfile } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";
import { addMonths, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function BudgetView({ profile, categories, actuals, month, today, live }: { profile: FinancialProfile; categories: BudgetCategory[]; actuals: BudgetActual[]; month: string; today: string; live: BudgetLive }) {
  const router = useRouter();
  const pathname = usePathname();
  const actualByCat = new Map(actuals.map((a) => [a.category_id, a]));
  const effectiveActual = (c: BudgetCategory) => actualByCat.get(c.id)?.actual ?? live.actualsByCategory[c.id] ?? null;
  const totalBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalActual = categories.reduce((s, c) => s + (effectiveActual(c) ?? 0), 0) + (live.uncategorized ?? 0);
  const expenseBudget = categories.filter((c) => c.kind === "expense").reduce((s, c) => s + c.budgeted, 0);
  const go = (m: string) => router.push(`${pathname}?m=${m.slice(0, 7)}`);

  return (
    <div className="flex flex-col gap-7">
      <MetricStrip cols={3}>
        <Metric label="Take-home income" tag="Assumed" value={fmtMoney(profile.monthly_income)} muted={profile.monthly_income === 0} sub="per month, drives the projection" />
        <Metric label="Expenses in projection" tag="Assumed" value={fmtMoney(profile.fixed_expenses + profile.variable_expenses)} muted={profile.fixed_expenses + profile.variable_expenses === 0} sub={expenseBudget && Math.abs(expenseBudget - (profile.fixed_expenses + profile.variable_expenses)) > 1 ? `category budget totals ${fmtMoney(expenseBudget)}` : "matches category budget"} />
        <Metric label={`Spent in ${formatDate(month, "monthYear")}`} tag="Actual" value={fmtMoney(totalActual)} muted={totalActual === 0} sub={`of ${fmtMoney(totalBudget)} budgeted`} tone={totalBudget > 0 && totalActual > totalBudget ? "serious" : "neutral"} />
      </MetricStrip>

      <AssumptionsPanel profile={profile} sections={["income"]} title="Income and expenses" description="These monthly totals drive the projection. The category budget below is a detail view; it does not change the projection unless you copy the totals up here. The Recurring page can fill income and fixed expenses from your paychecks and bills." />

      {live.hasTransactions ? <LiveCashFlow live={live} today={today} profile={profile} /> : null}

      <section aria-labelledby="budget-month">
        <SectionHeader
          title={<span id="budget-month">Monthly budget</span>}
          hint={live.hasTransactions ? "actuals fill in from categorized transactions; type a value to override" : "type an actual and press Enter or click ✓ to save"}
          action={
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => go(addMonths(month, -1))}>
                <ChevronLeft />
              </Button>
              <span className="nums w-32 text-center text-sm font-medium">{formatDate(month, "monthYear")}</span>
              <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => go(addMonths(month, 1))} disabled={month.slice(0, 7) >= today.slice(0, 7)}>
                <ChevronRight />
              </Button>
            </div>
          }
        />
        <div className="border-line-1 bg-surface-1 mt-3 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="w-28">Kind</TableHead>
                <TableHead className="w-36 text-right">Budgeted</TableHead>
                <TableHead className="w-44 text-right">Actual</TableHead>
                <TableHead className="w-28 text-right">Left</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <CategoryRow key={c.id} category={c} actual={actualByCat.get(c.id)} liveActual={live.actualsByCategory[c.id]} month={month} />
              ))}
              {live.uncategorized > 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="text-text-3 text-meta" colSpan={3}>
                    Spending with no category yet ·{" "}
                    <Link href={`/finances/transactions?m=${month.slice(0, 7)}`} className="underline underline-offset-2">
                      categorize
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-2 nums text-meta text-right">{fmtMoney(live.uncategorized)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              ) : null}
              {live.uncategorizedPayments > 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="text-text-3 text-meta" colSpan={3}>Credit card payments (not budgeted; the purchases behind them are)</TableCell>
                  <TableCell className="text-text-2 nums text-meta text-right">{fmtMoney(live.uncategorizedPayments)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              ) : null}
              <NewCategoryRow />
            </TableBody>
          </Table>
        </div>
        <div className="text-text-2 nums mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-text-3">Budgeted</span> {fmtMoney(totalBudget)}
          </span>
          <span>
            <span className="text-text-3">Actual</span> {fmtMoney(totalActual)}
          </span>
          <span className={cn(totalBudget - totalActual < 0 ? "text-danger" : "text-text-1")}>
            <span className="text-text-3">Left</span> {fmtMoney(totalBudget - totalActual)}
          </span>
        </div>
      </section>
    </div>
  );
}

const KINDS: { value: BudgetKind; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "debt", label: "Debt" },
  { value: "savings", label: "Savings" },
  { value: "investing", label: "Investing" },
];

function CategoryRow({ category, actual, liveActual, month }: { category: BudgetCategory; actual?: BudgetActual; liveActual?: number; month: string }) {
  const router = useRouter();
  const [budget, setBudget] = React.useState(String(category.budgeted || ""));
  const [spent, setSpent] = React.useState(actual ? String(actual.actual) : "");
  const [pending, startTransition] = React.useTransition();
  const [prev, setPrev] = React.useState({ category, actual });
  if (prev.category !== category || prev.actual !== actual) {
    setPrev({ category, actual });
    setBudget(String(category.budgeted || ""));
    setSpent(actual ? String(actual.actual) : "");
  }
  const effective = actual?.actual ?? liveActual ?? null;
  const left = category.budgeted - (effective ?? 0);
  const budgetDirty = Number(budget || 0) !== category.budgeted;
  const spentDirty = (spent === "" ? null : Number(spent)) !== (actual ? actual.actual : null);

  function saveBudget() {
    if (!budgetDirty) return;
    startTransition(async () => {
      const res = await saveBudgetCategory(category.id, { budgeted: budget || 0 });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }
  function saveSpent() {
    if (!spentDirty) return;
    startTransition(async () => {
      const res = await saveBudgetActual({ category_id: category.id, month, actual: spent || 0 });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }
  function archive() {
    if (!confirm(`Archive “${category.name}”?`)) return;
    startTransition(async () => {
      const res = await archiveBudgetCategory(category.id);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell className="text-text-1 font-medium">{category.name}</TableCell>
      <TableCell className="text-text-3 text-meta">{KINDS.find((k) => k.value === category.kind)?.label}</TableCell>
      <TableCell>
        <MoneyInput aria-label={`${category.name} budget`} value={budget} onChange={setBudget} onBlur={saveBudget} onKeyDown={(e) => e.key === "Enter" && saveBudget()} className="h-8 text-right" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <MoneyInput aria-label={`${category.name} actual`} value={spent} onChange={setSpent} onKeyDown={(e) => e.key === "Enter" && saveSpent()} className="h-8 text-right" placeholder={liveActual != null ? String(Math.round(liveActual)) : "0"} title={liveActual != null && !actual ? "From synced transactions" : undefined} />
          <Button variant={spentDirty ? "default" : "ghost"} size="icon-xs" aria-label="Save actual" onClick={saveSpent} disabled={pending || !spentDirty}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
        </div>
      </TableCell>
      <TableCell className={cn("nums text-right", left < 0 ? "text-danger" : "text-text-2")}>
        {effective != null ? fmtMoney(left) : "—"}
        {!actual && liveActual != null ? <span className="index ml-1">auto</span> : null}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon-xs" aria-label={`Archive ${category.name}`} onClick={archive} disabled={pending}>
          <Archive />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function NewCategoryRow() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<BudgetKind>("expense");
  const [budget, setBudget] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  function add() {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await saveBudgetCategory(null, { name, kind, budgeted: budget || 0 });
      if (!res.ok) return void toast.error(res.error);
      setName("");
      setBudget("");
      router.refresh();
    });
  }
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell>
        <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className="h-8" />
      </TableCell>
      <TableCell>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as BudgetKind)} className="h-8" aria-label="Kind">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </NativeSelect>
      </TableCell>
      <TableCell>
        <MoneyInput aria-label="New category budget" value={budget} onChange={setBudget} onKeyDown={(e) => e.key === "Enter" && add()} className="h-8 text-right" />
      </TableCell>
      <TableCell colSpan={3}>
        <Button variant="outline" size="sm" onClick={add} disabled={pending || !name.trim()}>
          <Plus /> Add category
        </Button>
      </TableCell>
    </TableRow>
  );
}

function LiveCashFlow({ live, today, profile }: { live: BudgetLive; today: string; profile: FinancialProfile }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const currentMonth = today.slice(0, 7);
  const complete = live.months.filter((m) => m.month.slice(0, 7) < currentMonth);
  const basis = (complete.length ? complete : live.months).slice(-3);
  const avg = averageCashFlow(basis);
  const differs = Math.abs(avg.income - profile.monthly_income) > 1 || Math.abs(avg.fixed - profile.fixed_expenses) > 1 || Math.abs(avg.variable - profile.variable_expenses) > 1;
  function apply() {
    startTransition(async () => {
      const res = await saveFinancialProfile({ monthly_income: avg.income, fixed_expenses: avg.fixed, variable_expenses: avg.variable });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Assumptions now match your real cash flow");
      router.refresh();
    });
  }
  return (
    <Card>
      <CardHeader className="flex-col sm:flex-row sm:items-center">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Landmark className="size-4" /> Real cash flow from your bank <Badge variant="success">Live</Badge>
          </CardTitle>
          <CardDescription className="mt-1">From imported and synced transactions. Income = rows typed as income. Spending excludes transfers and debt payments; fixed = rent and utilities, variable = everything else. Months with only part of the picture (a card statement but no bank export, or the reverse) read low.</CardDescription>
        </div>
        <Button size="sm" className="w-full shrink-0 sm:w-auto" onClick={apply} loading={pending} disabled={pending || !basis.length || !differs}>
          {differs ? `Use ${basis.length}-month average in assumptions` : "Assumptions already match"}
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Income</TableHead>
              <TableHead className="text-right">Spending</TableHead>
              <TableHead className="text-right">Fixed</TableHead>
              <TableHead className="text-right">Variable</TableHead>
              <TableHead className="text-right">Loan payments</TableHead>
              <TableHead className="text-right">Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {live.months.map((m) => (
              <TableRow key={m.month} className={cn(m.month.slice(0, 7) === currentMonth ? "text-text-2" : null)}>
                <TableCell className="font-medium">
                  {formatDate(m.month, "monthYear")}
                  {m.month.slice(0, 7) === currentMonth ? <span className="index ml-1">so far</span> : null}
                </TableCell>
                <TableCell className="text-right nums">{fmtMoney(m.income)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(m.spending)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(m.fixed)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(m.variable)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(m.loanPayments)}</TableCell>
                <TableCell className={cn("text-right nums", m.income - m.spending - m.loanPayments < 0 ? "text-danger" : null)}>{fmtMoney(m.income - m.spending - m.loanPayments)}</TableCell>
              </TableRow>
            ))}
            {basis.length ? (
              <TableRow className="bg-surface-2 text-text-1 font-medium">
                <TableCell>Average ({basis.length} mo)</TableCell>
                <TableCell className="text-right nums">{fmtMoney(avg.income)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(avg.spending)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(avg.fixed)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(avg.variable)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(basis.reduce((s, m) => s + m.loanPayments, 0) / basis.length)}</TableCell>
                <TableCell className="text-right nums">{fmtMoney(avg.income - avg.spending - basis.reduce((s, m) => s + m.loanPayments, 0) / basis.length)}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
