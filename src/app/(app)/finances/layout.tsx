import type { Metadata } from "next";
import { PageHeader } from "@/components/app/items";
import { NAV_GROUPS } from "@/components/app/nav";
import { FinanceNav } from "@/components/finance/bits";

export const metadata: Metadata = { title: { default: "Finances", template: "%s · Finances" } };

const MONEY = NAV_GROUPS.find((g) => g.key === "money");

export default function FinancesLayout({ children }: LayoutProps<"/finances">) {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Finances"
        description="Current finances → goals → scenarios → projected future. Bank logins are never stored."
        eyebrow={
          <>
            {MONEY?.index ? <span className="index">{MONEY.index}</span> : null}
            <span>{MONEY?.label ?? "Money"}</span>
          </>
        }
        className="mb-4 md:mb-4"
      />
      <FinanceNav />
      {children}
    </div>
  );
}
