import type { Metadata } from "next";
import { FinanceNav } from "@/components/finance/bits";

export const metadata: Metadata = { title: { default: "Finances", template: "%s · Finances" } };

export default function FinancesLayout({ children }: LayoutProps<"/finances">) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Financial Future</h1>
          <p className="text-muted-foreground mt-1 text-sm">Current finances → goals → scenarios → projected future. Manual entry only; no bank credentials are stored.</p>
        </div>
      </div>
      <FinanceNav />
      {children}
    </div>
  );
}
