"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GOAL_STATUS_META, TONE_CLASS } from "@/lib/finance/model";
import type { GoalStatusKey } from "@/lib/finance/engine";

export const FINANCE_TABS: { href: string; label: string }[] = [
  { href: "/finances", label: "Overview" },
  { href: "/finances/accounts", label: "Accounts" },
  { href: "/finances/budget", label: "Budget" },
  { href: "/finances/goals", label: "Goals" },
  { href: "/finances/debt", label: "Debt" },
  { href: "/finances/scenarios", label: "Scenarios" },
  { href: "/finances/timeline", label: "Timeline" },
  { href: "/finances/insights", label: "Insights" },
];

export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Finances sections" className="-mx-1 mb-5 overflow-x-auto">
      <ul className="bg-background text-muted-foreground border-border inline-flex h-9 items-center gap-0.5 rounded-lg border p-[3px]">
        {FINANCE_TABS.map((t) => {
          const active = t.href === "/finances" ? pathname === "/finances" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} className={cn("inline-flex h-[calc(100%-1px)] items-center rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-secondary text-foreground" : "hover:text-foreground")} aria-current={active ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StatTile({ label, value, sub, tone, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warning" | "serious" | "critical" | "neutral"; className?: string }) {
  return (
    <Card className={cn("gap-1 py-4", className)}>
      <CardContent className="flex flex-col gap-0.5">
        <div className="text-subtle-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</div>
        <div className={cn("nums text-2xl font-semibold tracking-tight", tone === "critical" ? "text-destructive" : tone === "serious" ? "text-chart-serious" : tone === "good" ? "text-success" : null)}>{value}</div>
        {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
      </CardContent>
    </Card>
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

export function ToneBadge({ tone, children, className }: { tone: "good" | "warning" | "serious" | "critical" | "neutral"; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return <p className={cn("text-muted-foreground text-xs", className)}>Projections use your own numbers and the assumptions in Settings. They are not guarantees, forecasts, or financial advice.</p>;
}

export function MoneyInput({ value, onChange, id, placeholder, className, allowNegative = false, ...rest }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string; className?: string; allowNegative?: boolean } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">$</span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => onChange(e.target.value.replace(allowNegative ? /[^0-9.\-]/g : /[^0-9.]/g, ""))}
        className={cn("border-input h-9 w-full rounded-md border bg-transparent py-1 pr-3 pl-7 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] disabled:opacity-50", className)}
        {...rest}
      />
    </div>
  );
}

export function PctInput({ value, onChange, id, className, ...rest }: { value: string; onChange: (v: string) => void; id?: string; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <div className="relative">
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.\-]/g, ""))} className={cn("border-input h-9 w-full rounded-md border bg-transparent py-1 pr-7 pl-3 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] disabled:opacity-50", className)} {...rest} />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">%</span>
    </div>
  );
}
