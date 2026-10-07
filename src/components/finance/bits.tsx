"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { fieldClassName } from "@/components/ui/input";
import { Metric, type MetricTone } from "@/components/app/metric";
import { GOAL_STATUS_META, TONE_CLASS } from "@/lib/finance/model";
import type { GoalStatusKey } from "@/lib/finance/engine";

export const FINANCE_TABS: { href: string; label: string }[] = [
  { href: "/finances", label: "Overview" },
  { href: "/finances/accounts", label: "Accounts" },
  { href: "/finances/transactions", label: "Transactions" },
  { href: "/finances/budget", label: "Budget" },
  { href: "/finances/recurring", label: "Recurring" },
  { href: "/finances/goals", label: "Goals" },
  { href: "/finances/debt", label: "Debt" },
  { href: "/finances/scenarios", label: "Scenarios" },
  { href: "/finances/timeline", label: "Timeline" },
  { href: "/finances/insights", label: "Insights" },
];

/**
 * Section navigation for Finances: underline tabs on a hairline. Distinct from the segmented
 * view switch (Tabs) so "which page" and "which view of this page" never look alike.
 */
export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Finances sections" className="border-line-1 -mx-4 mb-6 border-b px-4 md:mx-0 md:px-0">
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {FINANCE_TABS.map((t) => {
          const active = t.href === "/finances" ? pathname === "/finances" : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="shrink-0">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-brand/40 relative flex h-9 items-center rounded-t-sm px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                  "after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
                  active ? "text-text-1 after:bg-brand" : "text-text-3 hover:text-text-1 after:bg-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bordered metric tile. Thin wrapper over `Metric` kept for the finance views' existing call sites. */
export function StatTile({ label, value, sub, tone, tag, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: MetricTone; tag?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border-line-1 bg-surface-1 rounded-lg border px-4 py-3", className)}>
      <Metric label={label} value={value} sub={sub} tone={tone} tag={tag} />
    </div>
  );
}

export function GoalStatusBadge({ status, className }: { status: GoalStatusKey; className?: string }) {
  const meta = GOAL_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[meta.tone], className)} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}

export function ToneBadge({ tone, children, className }: { tone: MetricTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return <p className={cn("text-text-3 text-meta", className)}>Projections use your own numbers and the assumptions in Settings. They are not guarantees, forecasts, or financial advice.</p>;
}

export function MoneyInput({ value, onChange, id, placeholder, className, allowNegative = false, ...rest }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string; className?: string; allowNegative?: boolean } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="text-text-3 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">$</span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => onChange(e.target.value.replace(allowNegative ? /[^0-9.\-]/g : /[^0-9.]/g, ""))}
        className={cn(fieldClassName, "nums h-9 w-full py-1 pr-3 pl-7", className)}
        {...rest}
      />
    </div>
  );
}

export function PctInput({ value, onChange, id, className, ...rest }: { value: string; onChange: (v: string) => void; id?: string; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <div className="relative">
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.\-]/g, ""))} className={cn(fieldClassName, "nums h-9 w-full py-1 pr-7 pl-3", className)} {...rest} />
      <span className="text-text-3 pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">%</span>
    </div>
  );
}
