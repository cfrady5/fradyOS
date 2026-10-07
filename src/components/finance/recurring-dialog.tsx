"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateInput, Field } from "@/components/app/form-fields";
import { MoneyInput } from "./bits";
import { deleteRecurring, saveRecurring } from "@/actions/finance";
import { CADENCES, monthlyAmount } from "@/lib/finance/recurring";
import { RECURRING_KINDS, type BudgetCategory, type FinancialAccount, type RecurringCadence, type RecurringItem, type RecurringKind } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";

type Form = {
  name: string;
  kind: RecurringKind;
  amount: string;
  cadence: RecurringCadence;
  next_date: string | null;
  account_id: string;
  category_id: string;
  match_pattern: string;
  is_variable: boolean;
  in_projection: boolean;
  is_active: boolean;
  notes: string;
};

export function RecurringDialog({ open, onOpenChange, item, defaultKind, accounts, categories, today }: { open: boolean; onOpenChange: (v: boolean) => void; item?: RecurringItem; defaultKind?: RecurringKind; accounts: FinancialAccount[]; categories: BudgetCategory[]; today: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? "Edit recurring item" : "Add recurring item"}</DialogTitle>
          <DialogDescription>One predictable money movement. The amount is per occurrence; the monthly equivalent feeds the projection.</DialogDescription>
        </DialogHeader>
        {open ? <RecurringForm key={item?.id ?? "new"} item={item} defaultKind={defaultKind} accounts={accounts} categories={categories} today={today} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RecurringForm({ item, defaultKind, accounts, categories, today, onClose }: { item?: RecurringItem; defaultKind?: RecurringKind; accounts: FinancialAccount[]; categories: BudgetCategory[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>({
    name: item?.name ?? "",
    kind: item?.kind ?? defaultKind ?? "expense",
    amount: item ? String(item.amount) : "",
    cadence: item?.cadence ?? "monthly",
    next_date: item?.next_date ?? today,
    account_id: item?.account_id ?? "",
    category_id: item?.category_id ?? "",
    match_pattern: item?.match_pattern ?? "",
    is_variable: item?.is_variable ?? false,
    in_projection: item?.in_projection ?? true,
    is_active: item?.is_active ?? true,
    notes: item?.notes ?? "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const monthly = monthlyAmount({ amount: Number(form.amount) || 0, cadence: form.cadence });
  const kindMeta = RECURRING_KINDS.find((k) => k.value === form.kind);
  const categoryChoices = categories.filter((c) => (form.kind === "income" ? false : form.kind === "expense" ? c.kind === "expense" : form.kind === "debt" ? c.kind === "debt" : form.kind === "savings" ? c.kind === "savings" : c.kind === "investing"));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = { ...form, amount: form.amount || 0, account_id: form.account_id || null, category_id: form.category_id || null };
    startTransition(async () => {
      const res = await saveRecurring(item?.id ?? null, payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(item ? "Recurring item saved" : "Recurring item added");
      router.refresh();
      onClose();
    });
  }

  function remove() {
    if (!item) return;
    if (!confirm(`Delete “${item.name}”?`)) return;
    startTransition(async () => {
      const res = await deleteRecurring(item.id);
      if (!res.ok) return void setError(res.error);
      toast.success("Recurring item deleted");
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
        <Field label="Name" htmlFor="rec-name" error={fieldErrors.name} className="sm:col-span-2">
          <Input id="rec-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Resourcing Edge payroll" autoFocus />
        </Field>
        <Field label="Kind" htmlFor="rec-kind" hint={kindMeta?.hint}>
          <NativeSelect id="rec-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as RecurringKind)}>
            {RECURRING_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Cadence" htmlFor="rec-cadence">
          <NativeSelect id="rec-cadence" value={form.cadence} onChange={(e) => set("cadence", e.target.value as RecurringCadence)}>
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Amount per occurrence" htmlFor="rec-amount" error={fieldErrors.amount} hint={form.amount ? `${fmtMoney(monthly, { cents: true })} a month` : "Always positive; the kind says which way it flows."}>
          <MoneyInput id="rec-amount" value={form.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field label="Next date" htmlFor="rec-next" hint="Used for the upcoming list. Rolls forward automatically.">
          <DateInput id="rec-next" value={form.next_date} onChange={(v) => set("next_date", v)} />
        </Field>
        <Field label="Account" htmlFor="rec-account" hint={form.kind === "income" ? "Where it lands." : form.kind === "debt" ? "The loan or card being paid." : "Where it comes from."}>
          <NativeSelect id="rec-account" value={form.account_id} onChange={(e) => set("account_id", e.target.value)}>
            <option value="">No account</option>
            {accounts
              .filter((a) => !a.is_archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Budget category" htmlFor="rec-category">
          <NativeSelect id="rec-category" value={form.category_id} onChange={(e) => set("category_id", e.target.value)} disabled={form.kind === "income"}>
            <option value="">{form.kind === "income" ? "Income is not budgeted" : "No category"}</option>
            {categoryChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Matches bank descriptions containing" htmlFor="rec-match" hint="Case-insensitive; separate alternatives with |. Transactions that match show as this item." className="sm:col-span-2">
          <Input id="rec-match" value={form.match_pattern} onChange={(e) => set("match_pattern", e.target.value)} placeholder="e.g. earnest | EARNEST MO" />
        </Field>
        <Field label="Notes" htmlFor="rec-notes" className="sm:col-span-2">
          <Textarea id="rec-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.is_variable} onCheckedChange={(v) => set("is_variable", v)} /> Amount varies
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.in_projection} onCheckedChange={(v) => set("in_projection", v)} /> Count in projection
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} /> Active
        </label>
      </div>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        {item ? (
          <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={remove} disabled={pending}>
            <Trash2 /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button loading={pending} type="submit" disabled={pending}>
            {item ? "Save" : "Add"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
