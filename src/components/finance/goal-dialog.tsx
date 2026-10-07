"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AreaSelect, DateInput, Field, ProjectSelect } from "@/components/app/form-fields";
import { MoneyInput } from "./bits";
import { createGoal, deleteGoal, linkGoalToProject, updateGoal } from "@/actions/finance";
import { GOAL_CATEGORIES, isLiability, type FinancialAccount, type FinancialGoal, type GoalCategory, type GoalStatus } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";

type Form = {
  name: string;
  category: GoalCategory;
  target_amount: string;
  current_amount: string;
  linked_account_id: string | null;
  target_date: string | null;
  monthly_contribution: string;
  status: GoalStatus;
  notes: string;
};

export function GoalDialog({ open, onOpenChange, goal, accounts, emergencyFundTarget }: { open: boolean; onOpenChange: (v: boolean) => void; goal?: FinancialGoal; accounts: FinancialAccount[]; emergencyFundTarget: number }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New financial goal"}</DialogTitle>
          <DialogDescription>Status is computed from your cash flow: the projection dates the goal and compares it to your target date.</DialogDescription>
        </DialogHeader>
        <GoalForm goal={goal} accounts={accounts} emergencyFundTarget={emergencyFundTarget} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ goal, accounts, emergencyFundTarget, onClose }: { goal?: FinancialGoal; accounts: FinancialAccount[]; emergencyFundTarget: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>({
    name: goal?.name ?? "",
    category: goal?.category ?? "savings",
    target_amount: goal ? String(goal.target_amount || "") : "",
    current_amount: goal ? String(goal.current_amount || "") : "",
    linked_account_id: goal?.linked_account_id ?? null,
    target_date: goal?.target_date ?? null,
    monthly_contribution: goal ? String(goal.monthly_contribution || "") : "",
    status: goal?.status ?? "active",
    notes: goal?.notes ?? "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const linked = accounts.find((a) => a.id === form.linked_account_id);
  const linkedIsDebt = linked ? isLiability(linked.account_type) : false;
  const derived = form.category === "net_worth" || form.category === "retirement" || (form.category === "debt_payoff" && !linked);
  const candidates = accounts.filter((a) => !a.is_archived && (form.category === "debt_payoff" ? isLiability(a.account_type) : !isLiability(a.account_type)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        name: form.name,
        category: form.category,
        target_amount: form.target_amount || 0,
        current_amount: linked || derived ? 0 : form.current_amount || 0,
        linked_account_id: form.linked_account_id,
        target_date: form.target_date,
        monthly_contribution: form.monthly_contribution || 0,
        status: form.status,
        notes: form.notes,
      };
      const res = goal ? await updateGoal(goal.id, payload) : await createGoal(payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(goal ? "Goal saved" : "Goal added");
      router.refresh();
      onClose();
    });
  }

  function remove() {
    if (!goal || !confirm(`Delete “${goal.name}”?`)) return;
    startTransition(async () => {
      const res = await deleteGoal(goal.id);
      if (!res.ok) return void setError(res.error);
      toast.success("Goal deleted");
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
        <Field label="Name" htmlFor="g-name" error={fieldErrors.name} className="sm:col-span-2">
          <Input id="g-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. 6-month emergency fund" autoFocus />
        </Field>
        <Field label="Category" htmlFor="g-cat">
          <NativeSelect id="g-cat" value={form.category} onChange={(e) => set("category", e.target.value as GoalCategory)}>
            {GOAL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Tracks account" htmlFor="g-acc" hint={form.category === "debt_payoff" ? "Pick the debt; progress is the balance paid down." : "Optional. Progress follows the account balance."}>
          <NativeSelect id="g-acc" value={form.linked_account_id ?? ""} onChange={(e) => set("linked_account_id", e.target.value || null)}>
            <option value="">{form.category === "net_worth" ? "Net worth (all accounts)" : form.category === "retirement" ? "All retirement accounts" : form.category === "debt_payoff" ? "All debts" : "Manual progress"}</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({fmtMoney(a.balance)})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Target amount" htmlFor="g-target" error={fieldErrors.target_amount} hint={form.category === "emergency_fund" ? `Blank = ${fmtMoney(emergencyFundTarget)} from your Settings.` : linkedIsDebt ? "Blank = the current balance." : undefined}>
          <MoneyInput id="g-target" value={form.target_amount} onChange={(v) => set("target_amount", v)} />
        </Field>
        {!linked && !derived ? (
          <Field label="Saved so far" htmlFor="g-current">
            <MoneyInput id="g-current" value={form.current_amount} onChange={(v) => set("current_amount", v)} />
          </Field>
        ) : (
          <Field label="Progress" htmlFor="g-current-ro">
            <Input id="g-current-ro" readOnly value={linked ? (linkedIsDebt ? `paid down from ${fmtMoney(linked.balance)} owed` : fmtMoney(linked.balance)) : "computed from your accounts"} className="text-text-2" />
          </Field>
        )}
        <Field label="Target date" htmlFor="g-date" hint="Without a date the goal shows a projected date instead of a status.">
          <DateInput id="g-date" value={form.target_date} onChange={(v) => set("target_date", v)} />
        </Field>
        <Field label="Monthly contribution" htmlFor="g-monthly" hint={linkedIsDebt ? "Extra paid on this debt beyond its payment." : linked ? "On top of the account's own contribution." : "Set aside from monthly cash flow."}>
          <MoneyInput id="g-monthly" value={form.monthly_contribution} onChange={(v) => set("monthly_contribution", v)} />
        </Field>
        {goal ? (
          <Field label="Status" htmlFor="g-status">
            <NativeSelect id="g-status" value={form.status} onChange={(e) => set("status", e.target.value as GoalStatus)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="g-notes" className="sm:col-span-2">
          <Textarea id="g-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>
      </div>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        {goal ? (
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
            {goal ? "Save" : "Add goal"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/** Connect a goal to the rest of FradyOS: link or create a project and add the first tasks. */
export function LinkProjectDialog({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (v: boolean) => void; goal: FinancialGoal | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Turn this goal into a project</DialogTitle>
          <DialogDescription>Creates (or links) a FradyOS project and optional tasks. The goal keeps the project&rsquo;s id, so both sides stay connected.</DialogDescription>
        </DialogHeader>
        {goal ? <LinkProjectForm goal={goal} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LinkProjectForm({ goal, onClose }: { goal: FinancialGoal; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"new" | "existing">(goal.linked_project_id ? "existing" : "new");
  const [projectId, setProjectId] = React.useState<string | null>(goal.linked_project_id);
  const [name, setName] = React.useState(`Goal: ${goal.name}`);
  const [areaId, setAreaId] = React.useState<string | null>(null);
  const [tasks, setTasks] = React.useState<string[]>(defaultTasks(goal));
  const [draft, setDraft] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await linkGoalToProject(goal.id, { project_id: mode === "existing" ? projectId : null, new_project_name: mode === "new" ? name : undefined, work_area_id: areaId, tasks: tasks.filter(Boolean).map((title) => ({ title })) });
      if (!res.ok) return void setError(res.error);
      toast.success(`Linked. ${res.data.taskIds.length} task${res.data.taskIds.length === 1 ? "" : "s"} created.`);
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
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>
          New project
        </Button>
        <Button type="button" size="sm" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>
          Existing project
        </Button>
      </div>
      {mode === "new" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project name" htmlFor="lp-name" className="sm:col-span-2">
            <Input id="lp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Work area" htmlFor="lp-area">
            <AreaSelect id="lp-area" value={areaId} onChange={setAreaId} />
          </Field>
        </div>
      ) : (
        <Field label="Project" htmlFor="lp-project">
          <ProjectSelect id="lp-project" value={projectId} onChange={setProjectId} />
        </Field>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Tasks to create</span>
        <ul className="flex flex-col gap-1">
          {tasks.map((t, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <span className="flex-1">{t}</span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove task" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (draft.trim()) setTasks([...tasks, draft.trim()]);
                setDraft("");
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (draft.trim()) setTasks([...tasks, draft.trim()]);
              setDraft("");
            }}
          >
            <Plus /> Add
          </Button>
        </div>
        <p className="text-text-2 text-xs">Tasks that already exist on the project with the same title are skipped.</p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button loading={pending} type="submit" disabled={pending || (mode === "existing" && !projectId)}>
          Link goal
        </Button>
      </DialogFooter>
    </form>
  );
}

function defaultTasks(goal: FinancialGoal): string[] {
  const monthly = goal.monthly_contribution > 0 ? fmtMoney(goal.monthly_contribution) : null;
  switch (goal.category) {
    case "emergency_fund":
      return [monthly ? `Set up automatic ${monthly}/mo transfer to savings` : "Set up an automatic monthly transfer to savings", "Move the emergency fund to a high-yield savings account"];
    case "debt_payoff":
      return ["Confirm the APR and minimum on the statement", monthly ? `Schedule ${monthly}/mo extra payment` : "Schedule the extra monthly payment"];
    case "home":
      return ["Check credit report and score", "Get a mortgage pre-approval estimate", "Open a dedicated down-payment savings account"];
    case "vehicle":
      return ["Decide budget and must-haves", "Compare financing vs paying cash"];
    case "education":
      return ["List programs and total cost", "Check employer tuition assistance"];
    case "retirement":
      return ["Confirm employer match and current contribution %", "Review fund choices and fees"];
    default:
      return [monthly ? `Automate ${monthly}/mo toward “${goal.name}”` : `Automate a monthly transfer toward “${goal.name}”`];
  }
}
