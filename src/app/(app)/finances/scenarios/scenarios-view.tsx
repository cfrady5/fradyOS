"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Star, Trash2, Save, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RowList, SectionHeader } from "@/components/app/items";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/app/form-fields";
import { LineChart } from "@/components/finance/charts";
import { Disclaimer, GoalStatusBadge, MoneyInput, PctInput } from "@/components/finance/bits";
import { createScenario, deleteScenario, updateScenario } from "@/actions/finance";
import { runProjection, summarize, type ModelInputs, type ScenarioSummary } from "@/lib/finance/engine";
import { SCENARIO_PRESETS, describeChange, type ScenarioPreset } from "@/lib/finance/presets";
import { isLiability, type FinancialAccount, type FinancialScenario, type ScenarioChange } from "@/lib/finance/types";
import { HORIZONS, SCENARIO_PALETTE } from "@/lib/finance/model";
import { fmtMoney, fmtMonths } from "@/lib/finance/format";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function ScenariosView({ inputs, accounts, scenarios, loadId }: { inputs: ModelInputs; accounts: FinancialAccount[]; scenarios: FinancialScenario[]; loadId: string | null }) {
  const router = useRouter();
  const loaded = loadId ? scenarios.find((s) => s.id === loadId) : undefined;
  const [name, setName] = React.useState(loaded?.name ?? "");
  const [editingId, setEditingId] = React.useState<string | null>(loaded?.id ?? null);
  const [changes, setChanges] = React.useState<ScenarioChange[]>(loaded?.assumptions.changes ?? []);
  const [compareIds, setCompareIds] = React.useState<string[]>([]);
  const [months, setMonths] = React.useState(inputs.months);
  const [pending, startTransition] = React.useTransition();
  const [presetId, setPresetId] = React.useState<string>(SCENARIO_PRESETS[0].id);
  const preset = SCENARIO_PRESETS.find((p) => p.id === presetId)!;

  const base = React.useMemo(() => ({ ...inputs, months }), [inputs, months]);
  const results = React.useMemo(() => {
    const out: ScenarioSummary[] = [summarize("Baseline", runProjection(base))];
    if (changes.length) out.push(summarize(name.trim() || "This scenario", runProjection({ ...base, changes: [...base.changes, ...changes] })));
    for (const id of compareIds) {
      const s = scenarios.find((x) => x.id === id);
      if (s && s.id !== editingId) out.push(summarize(s.name, runProjection({ ...base, changes: [...base.changes, ...s.assumptions.changes] })));
    }
    return out;
  }, [base, changes, compareIds, scenarios, name, editingId]);

  const n = results[0].projection.points.length;
  const step = n > 130 ? 3 : 1;
  const idx = Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0 || i === n - 1);
  const xLabels = idx.map((i) => formatDate(results[0].projection.points[i].date, "monthYear"));
  const series = results.map((r, k) => ({ id: `${k}-${r.name}`, name: r.name, color: SCENARIO_PALETTE[k % SCENARIO_PALETTE.length], values: idx.map((i) => r.projection.points[i].netWorth) }));

  function addFromPreset(values: Record<string, number | string>) {
    const built = preset.build(values);
    if (!built.length) return void toast.error("Pick an account for this preset first");
    setChanges((c) => [...c, ...built]);
  }

  function save() {
    if (!name.trim()) return void toast.error("Name the scenario first");
    startTransition(async () => {
      const res = editingId ? await updateScenario(editingId, { name, changes }) : await createScenario({ name, changes });
      if (!res.ok) return void toast.error(res.error);
      toast.success(editingId ? "Scenario updated" : "Scenario saved");
      if (!editingId) setEditingId(res.data.id);
      router.refresh();
    });
  }
  function load(s: FinancialScenario) {
    setName(s.name);
    setEditingId(s.id);
    setChanges(s.assumptions.changes);
    setCompareIds((ids) => ids.filter((x) => x !== s.id));
  }
  function reset() {
    setName("");
    setEditingId(null);
    setChanges([]);
  }
  function toggleFavorite(s: FinancialScenario) {
    startTransition(async () => {
      const res = await updateScenario(s.id, { is_favorite: !s.is_favorite });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }
  function remove(s: FinancialScenario) {
    if (!confirm(`Delete scenario “${s.name}”?`)) return;
    startTransition(async () => {
      const res = await deleteScenario(s.id);
      if (!res.ok) return void toast.error(res.error);
      if (editingId === s.id) reset();
      setCompareIds((ids) => ids.filter((x) => x !== s.id));
      router.refresh();
    });
  }

  const rows: { label: string; get: (r: ScenarioSummary) => string; better?: (a: number, b: number) => boolean; num?: (r: ScenarioSummary) => number | null }[] = [
    { label: "Monthly cash flow", get: (r) => fmtMoney(r.monthlyCashFlow), num: (r) => r.monthlyCashFlow, better: (a, b) => a > b },
    { label: "Net worth · 1 yr", get: (r) => fmtMoney(r.netWorth1y), num: (r) => r.netWorth1y, better: (a, b) => a > b },
    { label: "Net worth · 3 yr", get: (r) => fmtMoney(r.netWorth3y), num: (r) => r.netWorth3y, better: (a, b) => a > b },
    { label: "Net worth · 5 yr", get: (r) => fmtMoney(r.netWorth5y), num: (r) => r.netWorth5y, better: (a, b) => a > b },
    { label: `Net worth · ${fmtMonths(months)}`, get: (r) => fmtMoney(r.netWorthEnd), num: (r) => r.netWorthEnd, better: (a, b) => a > b },
    { label: "Debt-free", get: (r) => (r.debtFreeMonth === 0 ? "No debt" : r.debtFreeDate ? formatDate(r.debtFreeDate, "monthYear") : "Not in horizon"), num: (r) => r.debtFreeMonth, better: (a, b) => a < b },
    { label: "Total interest", get: (r) => fmtMoney(r.totalInterest), num: (r) => r.totalInterest, better: (a, b) => a < b },
    { label: "Emergency fund done", get: (r) => (r.emergencyFundDate ? formatDate(r.emergencyFundDate, "monthYear") : results[0].projection.goals.some((g) => g.category === "emergency_fund") ? "Not in horizon" : "No EF goal"), num: (r) => r.emergencyFundMonth, better: (a, b) => a < b },
    { label: `Investments · ${fmtMonths(months)}`, get: (r) => fmtMoney(r.investmentsEnd), num: (r) => r.investmentsEnd, better: (a, b) => a > b },
    { label: "First cash shortfall", get: (r) => (r.firstShortfallMonth != null ? formatDate(r.projection.points[r.firstShortfallMonth].date, "monthYear") : "None"), num: (r) => (r.firstShortfallMonth == null ? Number.MAX_SAFE_INTEGER : r.firstShortfallMonth), better: (a, b) => a > b },
  ];

  return (
    <div className="flex flex-col gap-7">
      <div className="grid gap-x-6 gap-y-7 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Build a scenario</CardTitle>
              <CardDescription className="mt-1">Stack changes on top of today&rsquo;s plan. Months count from now (1 = next month).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Scenario name" htmlFor="sc-name">
              <Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Move downtown + raise" />
            </Field>
            <Field label="Preset" htmlFor="sc-preset" hint={preset.description}>
              <NativeSelect id="sc-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {(["Housing", "Career", "Education", "Debt", "Investing", "Life"] as const).map((g) => (
                  <optgroup key={g} label={g}>
                    {SCENARIO_PRESETS.filter((p) => p.group === g).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
            <PresetFields key={preset.id} preset={preset} accounts={accounts} onAdd={addFromPreset} />
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow">Changes in this scenario</span>
              {changes.length ? (
                <ul className="hairline-rows border-line-1 rounded-md border">
                  {changes.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                      <span className="text-text-1 flex-1">{describeChange(c)}</span>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove change" onClick={() => setChanges(changes.filter((_, j) => j !== i))}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-3 text-meta">No changes yet. Add one from a preset above.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={save} loading={pending} disabled={pending || !changes.length}>
                {pending ? null : <Save />} {editingId ? "Update scenario" : "Save scenario"}
              </Button>
              {changes.length || editingId ? (
                <Button size="sm" variant="ghost" onClick={reset}>
                  Clear
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
          <Card>
            <CardHeader className="flex-col sm:flex-row sm:items-center">
              <div>
                <CardTitle>Side by side</CardTitle>
                <CardDescription className="mt-1">Baseline is today&rsquo;s plan. Best value in each row is highlighted.</CardDescription>
              </div>
              <NativeSelect className="w-28" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Horizon">
                {HORIZONS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </NativeSelect>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <LineChart xLabels={xLabels} series={series} height={200} ariaLabel="Net worth by scenario" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    {results.map((r, k) => (
                      <TableHead key={k} className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: SCENARIO_PALETTE[k % SCENARIO_PALETTE.length] }} /> {r.name}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const nums = results.map((r) => row.num?.(r) ?? null);
                    let bestIdx = -1;
                    if (row.better && results.length > 1) {
                      nums.forEach((v, i) => {
                        if (v == null) return;
                        if (bestIdx < 0 || row.better!(v, nums[bestIdx]!)) bestIdx = i;
                      });
                      if (nums.every((v) => v === nums[0])) bestIdx = -1;
                    }
                    return (
                      <TableRow key={row.label}>
                        <TableCell className="text-text-3 text-meta">{row.label}</TableCell>
                        {results.map((r, k) => (
                          <TableCell key={k} className={cn("nums text-right", k === bestIdx ? "text-text-1 font-semibold" : "text-text-2")}>
                            {row.get(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                  {results[0].goals.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="text-text-3 text-meta">Goal · {g.name}</TableCell>
                      {results.map((r, k) => {
                        const gg = r.goals.find((x) => x.id === g.id);
                        return (
                          <TableCell key={k} className="text-right text-xs nums">
                            <span className="inline-flex items-center gap-1.5">
                              {gg?.projectedDate ? formatDate(gg.projectedDate, "monthYear") : "—"} {gg ? <GoalStatusBadge status={gg.status} /> : null}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Disclaimer />
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-labelledby="scenarios-saved">
        <SectionHeader title={<span id="scenarios-saved">Saved scenarios</span>} count={scenarios.length} hint="load one to edit, or tick it to add it to the comparison" />
        {scenarios.length ? (
          <RowList>
            {scenarios.map((s) => (
              <div key={s.id} className="hover:bg-surface-hover flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors">
                <Checkbox aria-label={`Compare ${s.name}`} checked={compareIds.includes(s.id)} disabled={editingId === s.id} onCheckedChange={(v) => setCompareIds((ids) => (v ? [...ids, s.id] : ids.filter((x) => x !== s.id)))} />
                <button type="button" className="focus-visible:ring-brand/40 min-w-0 flex-1 rounded-sm text-left outline-none hover:underline focus-visible:ring-2" onClick={() => load(s)}>
                  <span className="text-text-1 font-medium">{s.name}</span>
                  <span className="text-text-3 text-meta ml-2">{s.assumptions.changes.length} change{s.assumptions.changes.length === 1 ? "" : "s"}{editingId === s.id ? " · editing" : ""}</span>
                </button>
                <Button variant="ghost" size="icon-xs" aria-label={s.is_favorite ? `Unfavorite ${s.name}` : `Favorite ${s.name}`} onClick={() => toggleFavorite(s)}>
                  <Star className={cn(s.is_favorite ? "fill-current text-warning" : null)} />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </RowList>
        ) : (
          <p className="text-text-3 text-meta flex items-center gap-2 py-1.5">
            <FlaskConical className="size-4" /> Nothing saved yet. Build a scenario and save it to compare later.
          </p>
        )}
      </section>
    </div>
  );
}

function PresetFields({ preset, accounts, onAdd }: { preset: ScenarioPreset; accounts: FinancialAccount[]; onAdd: (v: Record<string, number | string>) => void }) {
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(preset.fields.map((f) => [f.key, String(f.default)])));
  const debts = accounts.filter((a) => !a.is_archived && isLiability(a.account_type));
  const assets = accounts.filter((a) => !a.is_archived && !isLiability(a.account_type));
  return (
    <div className="border-line-1 bg-surface-0/50 flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {preset.fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`pf-${f.key}`} hint={f.hint}>
            {f.kind === "money" ? (
              <MoneyInput id={`pf-${f.key}`} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} allowNegative />
            ) : f.kind === "pct" ? (
              <PctInput id={`pf-${f.key}`} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
            ) : f.kind === "months" ? (
              <Input id={`pf-${f.key}`} inputMode="numeric" value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value.replace(/[^0-9]/g, "") })} />
            ) : (
              <NativeSelect id={`pf-${f.key}`} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                <option value="">{f.kind === "account_debt" ? (preset.id === "extra_debt" ? "Follow strategy" : "Choose a debt…") : "Default (surplus destination / checking)"}</option>
                {(f.kind === "account_debt" ? debts : assets).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({fmtMoney(a.balance)})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(Object.fromEntries(preset.fields.map((f) => [f.key, f.kind === "account_debt" || f.kind === "account_asset" ? values[f.key] : Number(values[f.key] || 0)])))}>
        <Plus /> Add to scenario
      </Button>
    </div>
  );
}
