"use client";

import * as React from "react";
import { Plus, Pencil, Landmark, CheckSquare, X, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkDeleteAccounts, bulkSetAccountsInNetWorth } from "@/actions/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/app/items";
import { StatTile } from "@/components/finance/bits";
import { AccountDialog } from "@/components/finance/account-dialog";
import { PlaidConnections, type PlaidStatus } from "@/components/finance/plaid-connections";
import { Badge } from "@/components/ui/badge";
import type { PlaidItem, PlaidSyncRun } from "@/lib/finance/types";
import { timeAgo } from "@/lib/dates";
import { ACCOUNT_TYPES, isLiability, type AccountType, type FinancialAccount, type FinancialDebt } from "@/lib/finance/types";
import { fmtMoney, fmtPct } from "@/lib/finance/format";
import { formatDate, diffDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function AccountsView({ accounts, debts, today, plaid }: { accounts: FinancialAccount[]; debts: FinancialDebt[]; today: string; plaid: { status: PlaidStatus; items: PlaidItem[]; runs: PlaidSyncRun[] } }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; account?: FinancialAccount; defaultType?: AccountType }>({ open: false });
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [bulkPending, startBulk] = React.useTransition();
  const debtByAccount = new Map(debts.map((d) => [d.account_id, d]));
  const active = accounts.filter((a) => !a.is_archived);
  const visibleIds = active.map((a) => a.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const selectedAccounts = active.filter((a) => selected.has(a.id));
  const selectedLinked = selectedAccounts.filter((a) => a.external_provider === "plaid" && a.plaid_item_id).length;
  const selectedTotal = selectedAccounts.reduce((s, a) => s + (isLiability(a.account_type) ? -a.balance : a.balance), 0);

  function toggleSelect(id: string, on?: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function setMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  function setNetWorth(include: boolean) {
    if (!selectedVisible.length) return;
    startBulk(async () => {
      const res = await bulkSetAccountsInNetWorth(selectedVisible, include);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.updated} account${res.data.updated === 1 ? "" : "s"} ${include ? "included in" : "excluded from"} net worth`);
      router.refresh();
    });
  }
  function deleteSelected() {
    startBulk(async () => {
      const res = await bulkDeleteAccounts(selectedVisible);
      setConfirmDelete(false);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Deleted ${res.data.deleted} account${res.data.deleted === 1 ? "" : "s"}${res.data.skippedLinked ? ` · ${res.data.skippedLinked} still linked to a bank were kept` : ""}`);
      exitSelect();
      router.refresh();
    });
  }
  const accountCounts: Record<string, number> = {};
  for (const a of active) if (a.plaid_item_id) accountCounts[a.plaid_item_id] = (accountCounts[a.plaid_item_id] ?? 0) + 1;
  const assets = active.filter((a) => !isLiability(a.account_type) && a.include_in_net_worth).reduce((s, a) => s + a.balance, 0);
  const liabilities = active.filter((a) => isLiability(a.account_type) && a.include_in_net_worth).reduce((s, a) => s + a.balance, 0);
  const groups: { key: string; label: string; defaultType: AccountType; items: FinancialAccount[] }[] = [
    { key: "cash", label: "Cash", defaultType: "checking", items: active.filter((a) => ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.group === "cash") },
    { key: "investment", label: "Investments", defaultType: "brokerage", items: active.filter((a) => ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.group === "investment") },
    { key: "debt", label: "Debts", defaultType: "credit_card", items: active.filter((a) => ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.group === "debt") },
    { key: "other", label: "Other assets", defaultType: "other_asset", items: active.filter((a) => ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.group === "other") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PlaidConnections status={plaid.status} items={plaid.items} runs={plaid.runs} accountCounts={accountCounts} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">Connected accounts update on every sync; manual accounts are entered by hand and flagged when older than 45 days.</p>
        <div className="flex flex-wrap items-center gap-2">
          {active.length ? (
            <Button variant={selecting ? "secondary" : "outline"} onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting}>
              {selecting ? <X /> : <CheckSquare />} {selecting ? "Done" : "Select"}
            </Button>
          ) : null}
          <Button onClick={() => setDialog({ open: true })}>
            <Plus /> Add manual account
          </Button>
        </div>
      </div>
      {selecting ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Checkbox id="select-all-accounts" checked={selectedVisible.length === visibleIds.length ? true : selectedVisible.length ? "indeterminate" : false} onCheckedChange={(v) => setSelected(v ? new Set(visibleIds) : new Set())} />
          <label htmlFor="select-all-accounts" className="cursor-pointer select-none">
            Select all {visibleIds.length}
          </label>
          <span className="text-muted-foreground text-xs">Tick accounts, then use the bar at the bottom. Accounts still synced from a connected bank cannot be deleted until the bank is removed.</span>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Assets" value={fmtMoney(assets)} />
        <StatTile label="Liabilities" value={fmtMoney(liabilities)} />
        <StatTile label="Net worth" value={fmtMoney(assets - liabilities)} />
      </div>
      {active.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No accounts yet" description="Add checking, savings, investments and every debt. Net worth, the debt plan and projections all read from here." action={<Button onClick={() => setDialog({ open: true })}><Plus /> Add account</Button>} />
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <SectionHeader
              title={
                selecting && g.items.length ? (
                  <span className="inline-flex items-center gap-2">
                    <Checkbox aria-label={`Select all ${g.label.toLowerCase()}`} checked={g.items.every((a) => selected.has(a.id)) ? true : g.items.some((a) => selected.has(a.id)) ? "indeterminate" : false} onCheckedChange={(v) => setMany(g.items.map((a) => a.id), Boolean(v))} />
                    {g.label}
                  </span>
                ) : (
                  g.label
                )
              }
              count={g.items.length}
              hint={g.items.length ? `${g.key === "debt" ? "−" : ""}${fmtMoney(g.items.reduce((s, a) => s + a.balance, 0))}` : undefined}
              action={
                <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, defaultType: g.defaultType })}>
                  <Plus /> Add
                </Button>
              }
            />
            {g.items.length ? (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {g.items.map((a) => {
                    const d = debtByAccount.get(a.id);
                    const live = a.external_provider === "plaid";
                    const stale = !live && diffDays(a.last_updated, today) > 45;
                    return (
                      <li key={a.id} className={cn("flex items-center gap-3 px-4 py-2.5", selecting && selected.has(a.id) && "bg-primary/8")}>
                        {selecting ? <Checkbox aria-label={`Select ${a.name}`} checked={selected.has(a.id)} onCheckedChange={(v) => toggleSelect(a.id, Boolean(v))} /> : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-medium">{a.name}</span>
                            <span className="text-muted-foreground text-xs">{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}{a.institution ? ` · ${a.institution}` : ""}</span>
                            {!a.include_in_net_worth ? <span className="text-muted-foreground text-xs">(excluded)</span> : null}
                            {live ? <Badge variant={a.sync_error ? "warning" : "success"}>{a.sync_error ? "Sync issue" : "Live"}</Badge> : null}
                          </div>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums">
                            {a.interest_rate != null ? <span>{fmtPct(a.interest_rate, 2)} {isLiability(a.account_type) ? "APR" : "/yr"}</span> : null}
                            {isLiability(a.account_type) ? <span>min {fmtMoney(a.minimum_payment ?? 0)} · paying {fmtMoney(d?.actual_payment || a.minimum_payment || 0)}</span> : a.monthly_contribution ? <span>+{fmtMoney(a.monthly_contribution)}/mo</span> : null}
                            {live ? (
                              <span className={cn(a.sync_error ? "text-chart-serious" : null)}>{a.sync_error ?? (a.last_synced_at ? `synced ${timeAgo(a.last_synced_at)}` : "not synced yet")}{a.available_balance != null && Math.abs(a.available_balance - a.balance) > 0.005 ? ` · ${fmtMoney(a.available_balance)} available` : ""}</span>
                            ) : (
                              <span className={cn(stale ? "text-chart-serious" : null)}>as of {formatDate(a.last_updated, "medium", today)}{stale ? " · stale" : ""}</span>
                            )}
                          </div>
                        </div>
                        <span className={cn("text-sm font-semibold tabular-nums", isLiability(a.account_type) ? "text-destructive" : null)}>{fmtMoney(a.balance)}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => setDialog({ open: true, account: a })}>
                          <Pencil />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : (
              <EmptyState compact title={`No ${g.label.toLowerCase()} yet`} />
            )}
          </section>
        ))
      )}
      {selecting ? (
        <div className="bg-card border-border fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border p-2.5 pr-16 shadow-2xl shadow-black/50 md:inset-x-auto md:right-8 md:bottom-6 md:left-[calc(15rem+2rem)] md:pr-2.5" role="toolbar" aria-label="Bulk account actions">
          <span className="nums px-1 text-sm font-semibold">{selectedVisible.length} selected</span>
          {selectedVisible.length ? <span className="text-muted-foreground nums text-xs">{fmtMoney(selectedTotal, { sign: true })} of net worth</span> : null}
          <Button variant="outline" size="sm" disabled={!selectedVisible.length || bulkPending} onClick={() => setNetWorth(true)}>
            <Eye /> Include in net worth
          </Button>
          <Button variant="outline" size="sm" disabled={!selectedVisible.length || bulkPending} onClick={() => setNetWorth(false)}>
            <EyeOff /> Exclude
          </Button>
          <Button variant="destructive" size="sm" disabled={!selectedVisible.length || bulkPending} onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={exitSelect}>
            Cancel
          </Button>
        </div>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedVisible.length} account{selectedVisible.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Balance history, debt details and synced transactions for these accounts are deleted with them. Goals that tracked one of them keep their progress number but lose the link.
              {selectedLinked ? ` ${selectedLinked} of them ${selectedLinked === 1 ? "is" : "are"} still synced from a connected bank and will be kept; remove that bank connection first to delete ${selectedLinked === 1 ? "it" : "them"}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={bulkPending}>
              Keep them
            </Button>
            <Button variant="destructive" onClick={deleteSelected} disabled={bulkPending || selectedVisible.length === selectedLinked}>
              {bulkPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete {selectedVisible.length - selectedLinked}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccountDialog key={dialog.account?.id ?? dialog.defaultType ?? "new"} open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} account={dialog.account} debt={dialog.account ? debtByAccount.get(dialog.account.id) : null} defaultType={dialog.defaultType} />
    </div>
  );
}
