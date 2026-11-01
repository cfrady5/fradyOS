"use client";
import * as React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

export const HEALTH_TABS: { href: string; label: string }[] = [
  { href: "/health", label: "Overview" },
  { href: "/health/sleep", label: "Sleep" },
  { href: "/health/heart", label: "Heart" },
  { href: "/health/breathing", label: "Breathing" },
  { href: "/health/load", label: "Load" },
  { href: "/health/trends", label: "Trends" },
  { href: "/health/events", label: "Events" },
  { href: "/health/habits", label: "Habits" },
  { href: "/health/live", label: "Live" },
  { href: "/health/workouts", label: "Workouts" },
  { href: "/health/data", label: "Data" },
];

/** Section navigation for Health: underline tabs on a hairline, the same pattern as Finances. */
export function HealthNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Health sections" className="border-line-1 -mx-4 mb-6 border-b px-4 md:mx-0 md:px-0">
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {HEALTH_TABS.map((t) => {
          const active = t.href === "/health" ? pathname === "/health" : pathname.startsWith(t.href);
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

/** One hairline row: title, a meta line beneath, and a right-aligned figure. */
export function HealthRow({ title, meta, value, sub }: { title: React.ReactNode; meta?: React.ReactNode; value?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-2 py-2.5">
      <div className="min-w-0">
        <p className="text-text-1 truncate text-sm font-medium">{title}</p>
        {meta ? <p className="text-text-3 text-meta nums mt-0.5">{meta}</p> : null}
      </div>
      {value != null ? (
        <div className="shrink-0 text-right">
          <p className="nums text-text-1 text-sm">{value}</p>
          {sub ? <p className="text-text-3 text-meta nums">{sub}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Shown on every Health screen until migration 0011 has been applied to the Supabase project. */
export function HealthNotReady() {
  return (
    <EmptyState
      title="Health is not set up yet"
      description="The health tables are missing from the database. Run supabase/migrations/0011_health.sql in the Supabase SQL editor, then reload this page."
    />
  );
}
