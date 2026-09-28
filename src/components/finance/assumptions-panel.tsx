"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/app/form-fields";
import { MoneyInput, PctInput } from "./bits";
import { saveFinancialProfile } from "@/actions/finance";
import { DEBT_STRATEGIES, type FinancialProfile } from "@/lib/finance/types";

type Form = Record<"monthly_income" | "income_growth_pct" | "fixed_expenses" | "variable_expenses" | "investment_return_pct" | "savings_apy_pct" | "emergency_fund_months" | "extra_debt_payment", string> & { surplus_destination: FinancialProfile["surplus_destination"]; debt_strategy: FinancialProfile["debt_strategy"] };

function toForm(p: FinancialProfile): Form {
  return {
    monthly_income: String(p.monthly_income || ""),
    income_growth_pct: String(p.income_growth_pct),
    fixed_expenses: String(p.fixed_expenses || ""),
    variable_expenses: String(p.variable_expenses || ""),
    investment_return_pct: String(p.investment_return_pct),
    savings_apy_pct: String(p.savings_apy_pct),
    emergency_fund_months: String(p.emergency_fund_months),
    extra_debt_payment: String(p.extra_debt_payment || ""),
    surplus_destination: p.surplus_destination,
    debt_strategy: p.debt_strategy,
  };
}

/** Editable model assumptions. `sections` picks which groups to show; everything saves to the same profile row. */
export function AssumptionsPanel({ profile, sections = ["income", "growth", "debt"], title = "Assumptions", description, compact = false }: { profile: FinancialProfile; sections?: ("income" | "growth" | "debt")[]; title?: string; description?: string; compact?: boolean }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(() => toForm(profile));
  const [pending, startTransition] = React.useTransition();
  const [prev, setPrev] = React.useState(profile);
  if (prev !== profile) {
    setPrev(profile);
    setForm(toForm(profile));
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(profile));

  function save() {
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      if (sections.includes("income")) Object.assign(payload, { monthly_income: form.monthly_income || 0, fixed_expenses: form.fixed_expenses || 0, variable_expenses: form.variable_expenses || 0, income_growth_pct: form.income_growth_pct || 0 });
      if (sections.includes("growth")) Object.assign(payload, { investment_return_pct: form.investment_return_pct || 0, savings_apy_pct: form.savings_apy_pct || 0, emergency_fund_months: form.emergency_fund_months || 0, surplus_destination: form.surplus_destination });
      if (sections.includes("debt")) Object.assign(payload, { debt_strategy: form.debt_strategy, extra_debt_payment: form.extra_debt_payment || 0 });
      const res = await saveFinancialProfile(payload);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Assumptions saved. Projections updated.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{description ?? "Every projection on these pages is computed from these numbers. Change them any time."}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sections.includes("income") ? (
          <div className={compact ? "grid grid-cols-2 gap-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
            <Field label="Take-home income / month" htmlFor="a-income">
              <MoneyInput id="a-income" value={form.monthly_income} onChange={(v) => set("monthly_income", v)} />
            </Field>
            <Field label="Fixed expenses / month" htmlFor="a-fixed" hint="Rent, insurance, subscriptions. Not debt payments.">
              <MoneyInput id="a-fixed" value={form.fixed_expenses} onChange={(v) => set("fixed_expenses", v)} />
            </Field>
            <Field label="Variable expenses / month" htmlFor="a-var" hint="Food, fuel, fun.">
              <MoneyInput id="a-var" value={form.variable_expenses} onChange={(v) => set("variable_expenses", v)} />
            </Field>
            <Field label="Annual raise" htmlFor="a-growth">
              <PctInput id="a-growth" value={form.income_growth_pct} onChange={(v) => set("income_growth_pct", v)} />
            </Field>
          </div>
        ) : null}
        {sections.includes("growth") ? (
          <div className={compact ? "grid grid-cols-2 gap-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
            <Field label="Investment return / year" htmlFor="a-ret" hint="Applied to brokerage and retirement accounts without their own rate.">
              <PctInput id="a-ret" value={form.investment_return_pct} onChange={(v) => set("investment_return_pct", v)} />
            </Field>
            <Field label="Savings yield / year" htmlFor="a-apy">
              <PctInput id="a-apy" value={form.savings_apy_pct} onChange={(v) => set("savings_apy_pct", v)} />
            </Field>
            <Field label="Emergency fund target (months)" htmlFor="a-ef">
              <input id="a-ef" inputMode="decimal" value={form.emergency_fund_months} onChange={(e) => set("emergency_fund_months", e.target.value.replace(/[^0-9.]/g, ""))} className="border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]" />
            </Field>
            <Field label="Leftover cash goes to" htmlFor="a-dest">
              <NativeSelect id="a-dest" value={form.surplus_destination} onChange={(e) => set("surplus_destination", e.target.value as Form["surplus_destination"])}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="investing">Brokerage</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}
        {sections.includes("debt") ? (
          <div className={compact ? "grid grid-cols-2 gap-3" : "grid gap-3 sm:grid-cols-2"}>
            <Field label="Debt payoff strategy" htmlFor="a-strat" hint={DEBT_STRATEGIES.find((s) => s.value === form.debt_strategy)?.hint}>
              <NativeSelect id="a-strat" value={form.debt_strategy} onChange={(e) => set("debt_strategy", e.target.value as Form["debt_strategy"])}>
                {DEBT_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Extra toward debt / month" htmlFor="a-extra" hint="Beyond minimums, allocated by the strategy.">
              <MoneyInput id="a-extra" value={form.extra_debt_payment} onChange={(v) => set("extra_debt_payment", v)} />
            </Field>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(toForm(profile))} disabled={pending}>
              Reset
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save assumptions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
