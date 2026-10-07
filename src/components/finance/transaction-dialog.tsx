"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateInput, Field } from "@/components/app/form-fields";
import { MoneyInput } from "./bits";
import { addTransaction } from "@/actions/finance";
import { TRANSACTION_TYPES, isLiability, type BudgetCategory, type FinancialAccount, type TransactionType } from "@/lib/finance/types";

export function TransactionDialog({ open, onOpenChange, accounts, categories, today, defaultAccountId }: { open: boolean; onOpenChange: (v: boolean) => void; accounts: FinancialAccount[]; categories: BudgetCategory[]; today: string; defaultAccountId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>A single entry by hand. Imported and synced rows arrive on their own.</DialogDescription>
        </DialogHeader>
        {open ? <TransactionForm accounts={accounts} categories={categories} today={today} defaultAccountId={defaultAccountId} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({ accounts, categories, today, defaultAccountId, onClose }: { accounts: FinancialAccount[]; categories: BudgetCategory[]; today: string; defaultAccountId?: string | null; onClose: () => void }) {
  const router = useRouter();
  const usable = accounts.filter((a) => !a.is_archived);
  const [form, setForm] = React.useState({
    account_id: defaultAccountId && usable.some((a) => a.id === defaultAccountId) ? defaultAccountId : usable[0]?.id ?? "",
    transaction_date: today as string | null,
    description: "",
    amount: "",
    direction: "out" as "in" | "out",
    transaction_type: "expense" as TransactionType,
    category_id: "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const account = usable.find((a) => a.id === form.account_id);
  const typeMeta = TRANSACTION_TYPES.find((t) => t.value === form.transaction_type);

  function pickDirection(d: "in" | "out") {
    set("direction", d);
    if (d === "in" && (form.transaction_type === "expense" || form.transaction_type === "contribution")) set("transaction_type", account && isLiability(account.account_type) ? "payment" : "income");
    if (d === "out" && form.transaction_type === "income") set("transaction_type", "expense");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(form.amount || 0);
    startTransition(async () => {
      const res = await addTransaction({
        account_id: form.account_id,
        transaction_date: form.transaction_date ?? today,
        description: form.description,
        amount: form.direction === "out" ? -Math.abs(n) : Math.abs(n),
        transaction_type: form.transaction_type,
        category_id: form.category_id || null,
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success("Transaction added");
      router.refresh();
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Description" htmlFor="tx-desc" error={fieldErrors.description} className="sm:col-span-2">
          <Input id="tx-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Kroger" autoFocus />
        </Field>
        <Field label="Account" htmlFor="tx-account" error={fieldErrors.account_id}>
          <NativeSelect id="tx-account" value={form.account_id} onChange={(e) => set("account_id", e.target.value)}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Date" htmlFor="tx-date" error={fieldErrors.transaction_date}>
          <DateInput id="tx-date" value={form.transaction_date} onChange={(v) => set("transaction_date", v)} />
        </Field>
        <Field label="Amount" htmlFor="tx-amount" error={fieldErrors.amount}>
          <div className="flex gap-2">
            <NativeSelect aria-label="Direction" value={form.direction} onChange={(e) => pickDirection(e.target.value as "in" | "out")} className="w-24 shrink-0">
              <option value="out">Out</option>
              <option value="in">In</option>
            </NativeSelect>
            <MoneyInput id="tx-amount" value={form.amount} onChange={(v) => set("amount", v)} className="flex-1" />
          </div>
        </Field>
        <Field label="Type" htmlFor="tx-type" hint={typeMeta?.hint}>
          <NativeSelect id="tx-type" value={form.transaction_type} onChange={(e) => set("transaction_type", e.target.value as TransactionType)}>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Budget category" htmlFor="tx-cat" className="sm:col-span-2">
          <NativeSelect id="tx-cat" value={form.category_id} onChange={(e) => set("category_id", e.target.value)} disabled={form.transaction_type === "income" || form.transaction_type === "transfer"}>
            <option value="">{form.transaction_type === "income" || form.transaction_type === "transfer" ? "Not budgeted" : "No category"}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button loading={pending} type="submit" disabled={pending || !form.account_id}>
          Add
        </Button>
      </DialogFooter>
    </form>
  );
}
