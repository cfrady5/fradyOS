"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CheckSquare, Loader2, Plus, Receipt, Repeat, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/finance/bits";
import { TransactionDialog } from "@/components/finance/transaction-dialog";
import { deleteTransactions, patchTransactions } from "@/actions/finance";
import { matchRecurring } from "@/lib/finance/recurring";
import { TRANSACTION_TYPES, type BudgetCategory, type FinancialAccount, type FinancialTransaction, type RecurringItem, type TransactionType } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";
import { addMonths, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const TYPE_BADGE: Record<TransactionType, "success" | "secondary" | "default" | "muted" | "warning"> = { income: "success", expense: "secondary", payment: "default", transfer: "muted", contribution: "warning" };

export function TransactionsView({ transactions, months, month, accounts, categories, recurring, today }: { transactions: FinancialTransaction[]; months: string[]; month: string; accounts: FinancialAccount[]; categories: BudgetCategory[]; recurring: RecurringItem[]; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = React.useState("");
  const [type, setType] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const go = (m: string) => router.push(`${pathname}?m=${m.slice(0, 7)}`);

  const q = query.trim().toLowerCase();
  const visible = transactions.filter((t) => (!account || t.account_id === account) && (!type || t.transaction_type === type) && (!q || `${t.merchant_name ?? ""} ${t.description ?? ""} ${accountName.get(t.account_id) ?? ""}`.toLowerCase().includes(q)));
  const visibleIds = visible.map((t) => t.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));

  const sums = { income: 0, spending: 0, payments: 0, moved: 0 };
  for (const t of transactions) {
    if (t.pending) continue;
    if (t.transaction_type === "income" && t.amount > 0) sums.income += t.amount;
    else if (t.amount < 0) {
      if (t.transaction_type === "expense") sums.spending += -t.amount;
      else if (t.transaction_type === "payment") sums.payments += -t.amount;
      else sums.moved += -t.amount;
    }
  }
  const net = sums.income - sums.spending - sums.payments - sums.moved;

  function toggle(id: string, on?: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  function bulkPatch(patch: { category_id?: string | null; transaction_type?: TransactionType }) {
    if (!selectedVisible.length) return;
    startTransition(async () => {
      const res = await patchTransactions(selectedVisible, patch);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.updated} transaction${res.data.updated === 1 ? "" : "s"} updated`);
      router.refresh();
    });
  }
  function bulkDelete() {
    startTransition(async () => {
      const res = await deleteTransactions(selectedVisible);
      setConfirmDelete(false);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Deleted ${res.data.deleted} transaction${res.data.deleted === 1 ? "" : "s"}`);
      exitSelect();
      router.refresh();
    });
  }

  const monthOptions = Array.from(new Set([month, ...months])).sort().reverse();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Every movement across your accounts: imported statements, synced bank data and entries by hand. Assign categories here and the{" "}
          <Link href="/finances/budget" className="underline underline-offset-2">
            Budget
          </Link>{" "}
          fills in; rows that match a{" "}
          <Link href="/finances/recurring" className="underline underline-offset-2">
            recurring item
          </Link>{" "}
          are tagged.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {transactions.length ? (
            <Button variant={selecting ? "secondary" : "outline"} onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting}>
              {selecting ? <X /> : <CheckSquare />} {selecting ? "Done" : "Select"}
            </Button>
          ) : null}
          <Button onClick={() => setAdding(true)} disabled={!accounts.some((a) => !a.is_archived)}>
            <Plus /> Add transaction
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Money in" value={fmtMoney(sums.income)} sub={formatDate(month, "monthYear")} />
        <StatTile label="Spending" value={fmtMoney(sums.spending)} sub="expenses" />
        <StatTile label="Debt payments" value={fmtMoney(sums.payments)} sub="loans and cards" />
        <StatTile label="Moved" value={fmtMoney(sums.moved)} sub="transfers and savings" />
        <StatTile label="Net" value={fmtMoney(net)} sub="in minus everything out" tone={net < 0 ? "serious" : undefined} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => go(addMonths(month, -1))}>
                <ChevronLeft />
              </Button>
              <NativeSelect aria-label="Month" value={month} onChange={(e) => go(e.target.value)} className="h-8 w-40">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {formatDate(m, "monthYear")}
                  </option>
                ))}
              </NativeSelect>
              <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => go(addMonths(month, 1))} disabled={month.slice(0, 7) >= today.slice(0, 7)}>
                <ChevronRight />
              </Button>
            </div>
            <NativeSelect aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} className="h-8 w-44">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-36">
              <option value="">All types</option>
              {TRANSACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label="Search transactions" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 w-full sm:w-56" />
            <span className="text-muted-foreground ml-auto text-xs">{visible.length === transactions.length ? `${transactions.length} rows` : `${visible.length} of ${transactions.length} rows`}</span>
          </div>
          {selecting ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Checkbox id="select-all-tx" checked={visibleIds.length && selectedVisible.length === visibleIds.length ? true : selectedVisible.length ? "indeterminate" : false} onCheckedChange={(v) => setSelected(v ? new Set(visibleIds) : new Set())} />
              <label htmlFor="select-all-tx" className="cursor-pointer select-none">
                Select all {visibleIds.length}
              </label>
              <span className="text-muted-foreground text-xs">Tick rows, then set a category or type, or delete, from the bar at the bottom.</span>
            </div>
          ) : null}

          {transactions.length === 0 ? (
            <EmptyState icon={<Receipt />} title={`No transactions in ${formatDate(month, "monthYear")}`} description="Connect a bank on the Accounts page, import a statement, or add entries by hand." action={<Button onClick={() => setAdding(true)} disabled={!accounts.length}><Plus /> Add transaction</Button>} compact />
          ) : visible.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Nothing matches these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {selecting ? <TableHead className="w-8" /> : null}
                  <TableHead className="w-20">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead className="w-44">Category</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <Row key={t.id} t={t} accountName={accountName.get(t.account_id) ?? "—"} categories={categories} recurring={recurring} today={today} selecting={selecting} checked={selected.has(t.id)} onToggle={(on) => toggle(t.id, on)} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selecting && selectedVisible.length ? (
        <div className="bg-card border-border fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border p-2.5 pr-16 shadow-2xl shadow-black/50 md:inset-x-auto md:right-8 md:bottom-6 md:left-[calc(15rem+2rem)] md:pr-2.5" role="toolbar" aria-label="Bulk transaction actions">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="nums font-medium">{selectedVisible.length} selected</span>
            <NativeSelect aria-label="Set category" value="" onChange={(e) => bulkPatch({ category_id: e.target.value === "__none" ? null : e.target.value })} className="h-8 w-44" disabled={pending}>
              <option value="">Set category…</option>
              <option value="__none">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Set type" value="" onChange={(e) => e.target.value && bulkPatch({ transaction_type: e.target.value as TransactionType })} className="h-8 w-36" disabled={pending}>
              <option value="">Set type…</option>
              {TRANSACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedVisible.length} transaction{selectedVisible.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>Budget actuals that came from these rows disappear with them. Synced rows come back on the next bank sync.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={bulkDelete} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete {selectedVisible.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransactionDialog open={adding} onOpenChange={setAdding} accounts={accounts} categories={categories} today={today} defaultAccountId={account || null} />
    </div>
  );
}

function Row({ t, accountName, categories, recurring, today, selecting, checked, onToggle }: { t: FinancialTransaction; accountName: string; categories: BudgetCategory[]; recurring: RecurringItem[]; today: string; selecting: boolean; checked: boolean; onToggle: (on: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const label = t.merchant_name?.trim() || t.description?.trim() || "—";
  const detail = t.description && t.merchant_name && t.description.trim() !== t.merchant_name.trim() ? t.description.replace(/\s+/g, " ").trim() : null;
  const hit = matchRecurring(`${t.merchant_name ?? ""} ${t.description ?? ""}`, recurring);
  const budgetable = t.transaction_type !== "income" && t.transaction_type !== "transfer";
  function setCategory(v: string) {
    startTransition(async () => {
      const res = await patchTransactions([t.id], { category_id: v || null });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }
  return (
    <TableRow data-state={checked ? "selected" : undefined} className={cn(t.pending ? "opacity-60" : null)}>
      {selecting ? (
        <TableCell>
          <Checkbox aria-label={`Select ${label}`} checked={checked} onCheckedChange={(v) => onToggle(Boolean(v))} />
        </TableCell>
      ) : null}
      <TableCell className="text-muted-foreground nums text-xs whitespace-nowrap">{formatDate(t.transaction_date, "short", today)}</TableCell>
      <TableCell className="max-w-[18rem] md:max-w-md">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{label}</span>
          {hit ? (
            <Badge variant="outline" className="gap-1" title={`Matches recurring item “${hit.name}”`}>
              <Repeat /> {hit.name}
            </Badge>
          ) : null}
          {t.pending ? <Badge variant="muted">pending</Badge> : null}
        </div>
        <div className="text-muted-foreground truncate text-xs" title={detail ?? undefined}>
          {accountName}
          {detail ? ` · ${detail}` : ""}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={TYPE_BADGE[t.transaction_type]}>{TRANSACTION_TYPES.find((x) => x.value === t.transaction_type)?.label ?? t.transaction_type}</Badge>
      </TableCell>
      <TableCell>
        {budgetable ? (
          <div className="flex items-center gap-1">
            <NativeSelect aria-label={`Category for ${label}`} value={t.category_id ?? ""} onChange={(e) => setCategory(e.target.value)} className="h-8 text-xs" disabled={pending}>
              <option value="">{t.transaction_type === "payment" ? "Card payment (not budgeted)" : "Uncategorized"}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {pending ? <Loader2 className="text-muted-foreground size-3.5 animate-spin" /> : null}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">{t.transaction_type === "income" ? "Income" : "Transfer"}</span>
        )}
      </TableCell>
      <TableCell className={cn("nums text-right whitespace-nowrap", t.amount > 0 ? "text-success" : null)}>{fmtMoney(t.amount, { cents: true, sign: true })}</TableCell>
    </TableRow>
  );
}
