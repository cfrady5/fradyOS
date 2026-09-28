"use client";

import * as React from "react";
import { Plus, Pencil, Landmark } from "lucide-react";
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
  const [dialog, setDialog] = React.useState<{ open: boolean; account?: FinancialAccount; defaultType?: AccountType }>({ open: false });
  const debtByAccount = new Map(debts.map((d) => [d.account_id, d]));
  const active = accounts.filter((a) => !a.is_archived);
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
        <Button onClick={() => setDialog({ open: true })}>
          <Plus /> Add manual account
        </Button>
      </div>
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
              title={g.label}
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
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{a.name}</span>
                            <span className="text-muted-foreground text-xs">{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label}{a.institution ? ` · ${a.institution}` : ""}</span>
                            {!a.include_in_net_worth ? <span className="text-muted-foreground text-xs">(excluded)</span> : null}
                            {live ? <Badge variant={a.sync_error ? "warning" : "success"}>{a.sync_error ? "Sync issue" : "Live"}</Badge> : null}
                          </div>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums">
                            {a.interest_rate != null ? <span>{fmtPct(a.interest_rate, 2)} {isLiability(a.account_type) ? "APR" : "/yr"}</span> : null}
                            {isLiability(a.account_type) ? <span>min {fmtMoney(a.minimum_payment ?? 0)} · paying {fmtMoney(d?.actual_payment || a.minimum_payment || 0)}</span> : a.monthly_contribution ? <span>+{fmtMoney(a.monthly_contribution)}/mo</span> : null}
                            {live ? (
                              <span className={cn(a.sync_error ? "text-[#9a3f1a] dark:text-[#f3a582]" : null)}>{a.sync_error ?? (a.last_synced_at ? `synced ${timeAgo(a.last_synced_at)}` : "not synced yet")}{a.available_balance != null && Math.abs(a.available_balance - a.balance) > 0.005 ? ` · ${fmtMoney(a.available_balance)} available` : ""}</span>
                            ) : (
                              <span className={cn(stale ? "text-[#9a3f1a] dark:text-[#f3a582]" : null)}>as of {formatDate(a.last_updated, "medium", today)}{stale ? " · stale" : ""}</span>
                            )}
                          </div>
                        </div>
                        <span className={cn("text-sm font-semibold tabular-nums", isLiability(a.account_type) ? "text-[#a52a2a] dark:text-[#f08080]" : null)}>{fmtMoney(a.balance)}</span>
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
      <AccountDialog key={dialog.account?.id ?? dialog.defaultType ?? "new"} open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} account={dialog.account} debt={dialog.account ? debtByAccount.get(dialog.account.id) : null} defaultType={dialog.defaultType} />
    </div>
  );
}
