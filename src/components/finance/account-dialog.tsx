"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateInput, Field } from "@/components/app/form-fields";
import { MoneyInput, PctInput } from "./bits";
import { createAccount, deleteAccount, updateAccount } from "@/actions/finance";
import { ACCOUNT_TYPES, isLiability, type AccountType, type FinancialAccount, type FinancialDebt } from "@/lib/finance/types";

type Form = {
  name: string;
  account_type: AccountType;
  institution: string;
  balance: string;
  interest_rate: string;
  minimum_payment: string;
  actual_payment: string;
  monthly_contribution: string;
  include_in_net_worth: boolean;
  last_updated: string | null;
  notes: string;
};

export function AccountDialog({ open, onOpenChange, account, debt, defaultType }: { open: boolean; onOpenChange: (v: boolean) => void; account?: FinancialAccount; debt?: FinancialDebt | null; defaultType?: AccountType }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "Add account"}</DialogTitle>
          <DialogDescription>Balances are entered by hand. Updating a balance records a point in your net worth history.</DialogDescription>
        </DialogHeader>
        <AccountForm account={account} debt={debt} defaultType={defaultType} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ account, debt, defaultType, onClose }: { account?: FinancialAccount; debt?: FinancialDebt | null; defaultType?: AccountType; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>({
    name: account?.name ?? "",
    account_type: account?.account_type ?? defaultType ?? "checking",
    institution: account?.institution ?? "",
    balance: account ? String(account.balance) : "",
    interest_rate: account?.interest_rate != null ? String(account.interest_rate) : "",
    minimum_payment: account?.minimum_payment != null ? String(account.minimum_payment) : "",
    actual_payment: debt ? String(debt.actual_payment || "") : "",
    monthly_contribution: account?.monthly_contribution ? String(account.monthly_contribution) : "",
    include_in_net_worth: account?.include_in_net_worth ?? true,
    last_updated: account?.last_updated ?? null,
    notes: account?.notes ?? "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();
  const liability = isLiability(form.account_type);
  const investable = form.account_type === "brokerage" || form.account_type === "retirement" || form.account_type === "savings";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: form.name,
      account_type: form.account_type,
      institution: form.institution,
      balance: form.balance || 0,
      interest_rate: form.interest_rate,
      minimum_payment: liability ? form.minimum_payment : "",
      actual_payment: liability ? form.actual_payment : "",
      monthly_contribution: liability ? 0 : form.monthly_contribution || 0,
      include_in_net_worth: form.include_in_net_worth,
      last_updated: form.last_updated,
      notes: form.notes,
    };
    startTransition(async () => {
      const res = account ? await updateAccount(account.id, payload) : await createAccount(payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(account ? "Account saved" : "Account added");
      router.refresh();
      onClose();
    });
  }

  function remove() {
    if (!account) return;
    if (!confirm(`Delete “${account.name}”? Its balance history goes with it.`)) return;
    startTransition(async () => {
      const res = await deleteAccount(account.id);
      if (!res.ok) return void setError(res.error);
      toast.success("Account deleted");
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
        <Field label="Name" htmlFor="acc-name" error={fieldErrors.name} className="sm:col-span-2">
          <Input id="acc-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Chase checking" autoFocus />
        </Field>
        <Field label="Type" htmlFor="acc-type">
          <NativeSelect id="acc-type" value={form.account_type} onChange={(e) => set("account_type", e.target.value as AccountType)}>
            {(["cash", "debt", "investment", "other"] as const).map((g) => (
              <optgroup key={g} label={g === "cash" ? "Cash" : g === "debt" ? "Debt" : g === "investment" ? "Investments" : "Other"}>
                {ACCOUNT_TYPES.filter((t) => t.group === g).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Institution" htmlFor="acc-inst">
          <Input id="acc-inst" value={form.institution} onChange={(e) => set("institution", e.target.value)} placeholder="Optional" />
        </Field>
        <Field label={liability ? "Balance owed" : "Current balance"} htmlFor="acc-bal" error={fieldErrors.balance}>
          <MoneyInput id="acc-bal" value={form.balance} onChange={(v) => set("balance", v)} allowNegative={!liability} />
        </Field>
        <Field label="As of" htmlFor="acc-date" hint="Defaults to today when the balance changes.">
          <DateInput id="acc-date" value={form.last_updated} onChange={(v) => set("last_updated", v)} />
        </Field>
        <Field label={liability ? "APR" : investable ? "Expected annual growth" : "Annual rate"} htmlFor="acc-rate" hint={liability ? "Interest accrues monthly on the balance." : investable ? "Leave blank to use the return assumption in Settings." : "Optional."}>
          <PctInput id="acc-rate" value={form.interest_rate} onChange={(v) => set("interest_rate", v)} placeholder={liability ? "e.g. 6.5" : "blank = default"} />
        </Field>
        {liability ? (
          <>
            <Field label="Minimum payment / month" htmlFor="acc-min" hint="What the lender requires.">
              <MoneyInput id="acc-min" value={form.minimum_payment} onChange={(v) => set("minimum_payment", v)} />
            </Field>
            <Field label="What you actually pay / month" htmlFor="acc-act" hint="Blank = the minimum.">
              <MoneyInput id="acc-act" value={form.actual_payment} onChange={(v) => set("actual_payment", v)} />
            </Field>
          </>
        ) : (
          <Field label="Monthly contribution" htmlFor="acc-contrib" hint="Planned deposit each month (paycheck deferral, auto-transfer…).">
            <MoneyInput id="acc-contrib" value={form.monthly_contribution} onChange={(v) => set("monthly_contribution", v)} />
          </Field>
        )}
        <Field label="Notes" htmlFor="acc-notes" className="sm:col-span-2">
          <Textarea id="acc-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Switch checked={form.include_in_net_worth} onCheckedChange={(v) => set("include_in_net_worth", v)} /> Include in net worth
        </label>
      </div>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        {account ? (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={remove} disabled={pending}>
            <Trash2 /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} {account ? "Save" : "Add account"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
