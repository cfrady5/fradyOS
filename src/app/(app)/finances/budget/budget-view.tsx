"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Archive, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssumptionsPanel } from "@/components/finance/assumptions-panel";
import { MoneyInput, StatTile } from "@/components/finance/bits";
import { archiveBudgetCategory, saveBudgetActual, saveBudgetCategory } from "@/actions/finance";
import type { BudgetActual, BudgetCategory, BudgetKind, FinancialProfile } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";
import { addMonths, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function BudgetView({ profile, categories, actuals, month, today }: { profile: FinancialProfile; categories: BudgetCategory[]; actuals: BudgetActual[]; month: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const actualByCat = new Map(actuals.map((a) => [a.category_id, a]));
  const totalBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalActual = categories.reduce((s, c) => s + (actualByCat.get(c.id)?.actual ?? 0), 0);
  const expenseBudget = categories.filter((c) => c.kind === "expense").reduce((s, c) => s + c.budgeted, 0);
  const go = (m: string) => router.push(`${pathname}?m=${m.slice(0, 7)}`);

  return (
    <div className="flex flex-col gap-6">
      <AssumptionsPanel profile={profile} sections={["income"]} title="Income and expenses" description="These monthly totals drive the projection. The category budget below is a detail view; it does not change the projection unless you copy the totals up here." />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Take-home income" value={fmtMoney(profile.monthly_income)} sub="per month" />
        <StatTile label="Expenses in projection" value={fmtMoney(profile.fixed_expenses + profile.variable_expenses)} sub={expenseBudget && Math.abs(expenseBudget - (profile.fixed_expenses + profile.variable_expenses)) > 1 ? `Category budget totals ${fmtMoney(expenseBudget)}` : "Matches category budget"} />
        <StatTile label={`Spent in ${formatDate(month, "monthYear")}`} value={fmtMoney(totalActual)} sub={`of ${fmtMoney(totalBudget)} budgeted`} tone={totalBudget > 0 && totalActual > totalBudget ? "serious" : undefined} />
      </div>

      <Card>
        <CardHeader className="items-center">
          <div>
            <CardTitle>Monthly budget</CardTitle>
            <CardDescription className="mt-1">Budgeted vs actual per category. Type an actual and press Enter or click ✓ to save.</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => go(addMonths(month, -1))}>
              <ChevronLeft />
            </Button>
            <span className="w-32 text-center text-sm font-medium tabular-nums">{formatDate(month, "monthYear")}</span>
            <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => go(addMonths(month, 1))} disabled={month.slice(0, 7) >= today.slice(0, 7)}>
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
                <CategoryRow key={c.id} category={c} actual={actualByCat.get(c.id)} month={month} />
              ))}
              <NewCategoryRow />
            </TableBody>
          </Table>
          <div className="text-muted-foreground mt-3 flex justify-end gap-6 text-sm tabular-nums">
            <span>Budgeted {fmtMoney(totalBudget)}</span>
            <span>Actual {fmtMoney(totalActual)}</span>
            <span className={cn(totalBudget - totalActual < 0 ? "text-[#a52a2a] dark:text-[#f08080]" : null)}>Left {fmtMoney(totalBudget - totalActual)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const KINDS: { value: BudgetKind; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "debt", label: "Debt" },
  { value: "savings", label: "Savings" },
  { value: "investing", label: "Investing" },
];

function CategoryRow({ category, actual, month }: { category: BudgetCategory; actual?: BudgetActual; month: string }) {
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
  const left = category.budgeted - (actual?.actual ?? 0);
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
      <TableCell className="font-medium">{category.name}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{KINDS.find((k) => k.value === category.kind)?.label}</TableCell>
      <TableCell>
        <MoneyInput aria-label={`${category.name} budget`} value={budget} onChange={setBudget} onBlur={saveBudget} onKeyDown={(e) => e.key === "Enter" && saveBudget()} className="h-8 text-right" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <MoneyInput aria-label={`${category.name} actual`} value={spent} onChange={setSpent} onKeyDown={(e) => e.key === "Enter" && saveSpent()} className="h-8 text-right" />
          <Button variant={spentDirty ? "default" : "ghost"} size="icon-xs" aria-label="Save actual" onClick={saveSpent} disabled={pending || !spentDirty}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
        </div>
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", left < 0 ? "text-[#a52a2a] dark:text-[#f08080]" : "text-muted-foreground")}>{actual ? fmtMoney(left) : "—"}</TableCell>
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
