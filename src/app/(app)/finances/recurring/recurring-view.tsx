"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RowList, SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { RecurringDialog } from "@/components/finance/recurring-dialog";
import { applyRecurringToProfile } from "@/actions/finance";
import { cadenceMeta, kindLabel, monthlyAmount, nextOccurrence, observe, projectionFigures, totals, upcoming } from "@/lib/finance/recurring";
import type { TransactionLite } from "@/lib/data/finance";
import type { BudgetCategory, FinancialAccount, FinancialProfile, RecurringItem, RecurringKind } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";
import { addDays, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function RecurringView({ items, accounts, categories, profile, recent, today }: { items: RecurringItem[]; accounts: FinancialAccount[]; categories: BudgetCategory[]; profile: FinancialProfile; recent: TransactionLite[]; today: string }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; item?: RecurringItem; defaultKind?: RecurringKind }>({ open: false });
  const [pending, startTransition] = React.useTransition();
  const t = totals(items);
  const figures = projectionFigures(items, accounts);
  const observations = observe(items, recent);
  const next30 = upcoming(items, today, 30);
  const next7 = next30.filter((x) => x.date <= addDays(today, 7));
  const differs = Math.abs(figures.income - profile.monthly_income) > 0.5 || Math.abs(figures.fixed - profile.fixed_expenses) > 0.5;
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const income = items.filter((i) => i.kind === "income");
  const outgoing = items.filter((i) => i.kind !== "income");

  function apply() {
    startTransition(async () => {
      const res = await applyRecurringToProfile();
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Projection now uses ${fmtMoney(res.data.income)} income and ${fmtMoney(res.data.fixed)} fixed expenses a month`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-2 max-w-2xl text-sm">Everything that repeats: pay, bills, loan payments, automatic savings. Amounts are per occurrence; totals are monthly equivalents. Transactions whose description matches an item are counted as that item.</p>
        <Button size="sm" onClick={() => setDialog({ open: true })}>
          <Plus /> Add recurring
        </Button>
      </div>

      <MetricStrip cols={4}>
        <Metric size="sm" label="Recurring income" tag="Monthly" value={fmtMoney(t.income)} muted={t.income === 0} sub={t.variableIncome ? `${fmtMoney(t.variableIncome)} of it varies` : "per month"} />
        <Metric size="sm" label="Recurring outgoing" tag="Monthly" value={fmtMoney(t.outgoing)} muted={t.outgoing === 0} sub={`${fmtMoney(t.byKind.expense)} bills · ${fmtMoney(t.byKind.debt)} debt · ${fmtMoney(t.byKind.savings + t.byKind.investing)} saved`} />
        <Metric size="sm" label="Left after recurring" tag="Monthly" value={fmtMoney(t.net)} tone={t.net < 0 ? "critical" : "neutral"} sub="before variable spending" />
        <Metric size="sm" label="Next 7 days" tag="Upcoming" value={fmtMoney(next7.filter((x) => x.item.kind !== "income").reduce((s, x) => s + x.item.amount, 0))} muted={next7.length === 0} sub={`${next7.length} item${next7.length === 1 ? "" : "s"} due · ${fmtMoney(next7.filter((x) => x.item.kind === "income").reduce((s, x) => s + x.item.amount, 0))} coming in`} />
      </MetricStrip>

      <Card>
        <CardHeader className="flex-col sm:flex-row sm:items-center">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-4" /> Projection assumptions
            </CardTitle>
            <CardDescription className="mt-1">
              Items marked “count in projection” add up to {fmtMoney(figures.income)} income and {fmtMoney(figures.fixed)} fixed expenses a month
              {figures.unmodeledDebt.length ? ` (includes ${figures.unmodeledDebt.map((i) => i.name).join(", ")}: debt payments whose account has no balance yet)` : ""}. The projection currently uses {fmtMoney(profile.monthly_income)} and {fmtMoney(profile.fixed_expenses)}; variable spending ({fmtMoney(profile.variable_expenses)}) is set on the{" "}
              <Link href="/finances/budget" className="underline underline-offset-2">
                Budget
              </Link>{" "}
              page.
            </CardDescription>
          </div>
          <Button size="sm" className="w-full shrink-0 sm:w-auto" variant={differs ? "default" : "outline"} onClick={apply} loading={pending} disabled={pending || !differs}>
            {differs ? "Use in projection" : "Projection matches"}
          </Button>
        </CardHeader>
      </Card>

      {items.length === 0 ? (
        <EmptyState variant="page" icon={<Repeat />} title="Nothing recurring yet" description="Add your paychecks, loan payments, subscriptions and automatic transfers. The Transactions page can tell you what repeats." action={<Button onClick={() => setDialog({ open: true })}><Plus /> Add recurring</Button>} />
      ) : (
        <div className="grid gap-x-10 gap-y-7 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-7">
            <RecurringTable title="Income" items={income} observations={observations} today={today} accountName={accountName} categoryName={categoryName} onEdit={(item) => setDialog({ open: true, item })} onAdd={() => setDialog({ open: true, defaultKind: "income" })} />
            <RecurringTable title="Bills, payments and transfers" items={outgoing} observations={observations} today={today} accountName={accountName} categoryName={categoryName} showKind onEdit={(item) => setDialog({ open: true, item })} onAdd={() => setDialog({ open: true, defaultKind: "expense" })} />
          </div>
          <section aria-labelledby="recurring-next">
            <SectionHeader as="h3" title={<span id="recurring-next">Next 30 days</span>} count={next30.length} />
            {next30.length === 0 ? (
              <p className="text-text-3 text-meta py-1.5">Nothing scheduled. Give items a next date to see them here.</p>
            ) : (
              <RowList>
                {next30.slice(0, 20).map((x, i) => (
                  <div key={`${x.item.id}-${x.date}-${i}`} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-text-1 truncate font-medium">{x.item.name}</div>
                      <div className="text-text-3 nums text-meta">{formatDate(x.date, "weekday", today)}</div>
                    </div>
                    <span className={cn("nums shrink-0 text-sm", x.item.kind === "income" ? "text-success" : "text-text-1")}>{x.item.kind === "income" ? "+" : "−"}{fmtMoney(x.item.amount, { cents: true })}</span>
                  </div>
                ))}
                {next30.length > 20 ? <p className="index px-2 pt-2">+{next30.length - 20} more</p> : null}
              </RowList>
            )}
          </section>
        </div>
      )}

      <RecurringDialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} item={dialog.item} defaultKind={dialog.defaultKind} accounts={accounts} categories={categories} today={today} />
    </div>
  );
}

function RecurringTable({ title, items, observations, today, accountName, categoryName, showKind, onEdit, onAdd }: { title: string; items: RecurringItem[]; observations: ReturnType<typeof observe>; today: string; accountName: Map<string, string>; categoryName: Map<string, string>; showKind?: boolean; onEdit: (item: RecurringItem) => void; onAdd: () => void }) {
  const total = items.filter((i) => i.is_active).reduce((s, i) => s + monthlyAmount(i), 0);
  return (
    <section aria-label={title}>
      <SectionHeader
        title={title}
        count={items.length}
        hint={`${fmtMoney(total)} a month across ${items.filter((i) => i.is_active).length} active`}
        action={
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Plus /> Add
          </Button>
        }
      />
      <div className="border-line-1 bg-surface-1 mt-3 rounded-lg border">
        {items.length === 0 ? (
          <p className="text-text-3 px-4 py-6 text-center text-sm">Nothing here yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                {showKind ? <TableHead className="w-28">Kind</TableHead> : null}
                <TableHead className="w-28">Every</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-32 text-right">Per month</TableHead>
                <TableHead className="w-32">Next</TableHead>
                <TableHead className="min-w-40">Seen in transactions</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const obs = observations[item.id];
                const next = nextOccurrence(item, today);
                return (
                  <TableRow key={item.id} className={cn(!item.is_active ? "opacity-60" : null)}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" className="text-text-1 focus-visible:ring-brand/40 rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2" onClick={() => onEdit(item)}>
                          {item.name}
                        </button>
                        {item.is_variable ? <Badge variant="warning">varies</Badge> : null}
                        {!item.is_active ? <Badge variant="muted">paused</Badge> : null}
                        {item.is_active && !item.in_projection ? <Badge variant="muted" title="Tracked here but not counted by “Use in projection”">not in projection</Badge> : null}
                      </div>
                      <div className="text-text-3 text-meta">
                        {[item.account_id ? accountName.get(item.account_id) : null, item.category_id ? categoryName.get(item.category_id) : null].filter(Boolean).join(" · ") || (item.notes ? item.notes.slice(0, 80) : "")}
                      </div>
                    </TableCell>
                    {showKind ? <TableCell className="text-text-3 text-meta">{kindLabel(item.kind)}</TableCell> : null}
                    <TableCell className="text-text-3 text-meta">{cadenceMeta(item.cadence).label.replace("Every ", "")}</TableCell>
                    <TableCell className="nums text-right">{fmtMoney(item.amount, { cents: true })}</TableCell>
                    <TableCell className="nums text-text-1 text-right font-medium">{fmtMoney(monthlyAmount(item), { cents: true })}</TableCell>
                    <TableCell className="text-text-3 nums text-meta">{next ? formatDate(next, "monthDay", today) : "—"}</TableCell>
                    <TableCell className="text-text-3 nums text-meta">
                      {obs ? (
                        <>
                          {obs.count}× · last {formatDate(obs.lastDate!, "monthDay", today)} · {fmtMoney(obs.lastAmount, { cents: true })}
                          {obs.count > 1 && obs.average != null && Math.abs(obs.average - item.amount) > 0.5 ? <span className="block">avg {fmtMoney(obs.average, { cents: true })}</span> : null}
                        </>
                      ) : item.match_pattern ? (
                        "not seen in 120 days"
                      ) : (
                        "no match pattern"
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-xs" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)}>
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
