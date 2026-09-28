"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Bot, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/app/form-fields";
import { Disclaimer, MoneyInput, PctInput, ToneBadge } from "@/components/finance/bits";
import type { Insight } from "@/lib/finance/insights";
import { COPILOT_QUESTIONS, type CopilotAnswer } from "@/lib/finance/copilot";
import type { ModelInputs } from "@/lib/finance/engine";
import { isLiability, type FinancialAccount, type FinancialGoal } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";

export function InsightsView({ insights, inputs, accounts, goals }: { insights: Insight[]; inputs: ModelInputs; accounts: FinancialAccount[]; goals: FinancialGoal[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-3 lg:col-span-2">
        <h2 className="text-sm font-semibold">What the numbers say</h2>
        {insights.length === 0 ? <p className="text-muted-foreground text-sm">Add income, expenses and accounts to generate insights.</p> : null}
        <ul className="flex flex-col gap-2">
          {insights.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <ToneBadge tone={i.tone} className="mt-0.5">
                  {i.tone === "good" ? "Good" : i.tone === "critical" ? "Act" : i.tone === "serious" ? "Watch" : i.tone === "warning" ? "Note" : "Info"}
                </ToneBadge>
                <span className="font-medium">{i.title}</span>
              </div>
              <p className="text-muted-foreground text-xs">{i.body}</p>
              {i.href ? (
                <Link href={i.href} className="text-primary inline-flex items-center gap-1 text-xs hover:underline">
                  Open <ArrowRight className="size-3" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        <Disclaimer />
      </div>
      <div className="lg:col-span-3">
        <Copilot inputs={inputs} accounts={accounts} goals={goals} />
      </div>
    </div>
  );
}

function Copilot({ inputs, accounts, goals }: { inputs: ModelInputs; accounts: FinancialAccount[]; goals: FinancialGoal[] }) {
  const [qid, setQid] = React.useState(COPILOT_QUESTIONS[0].id);
  const q = COPILOT_QUESTIONS.find((x) => x.id === qid)!;
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [answer, setAnswer] = React.useState<{ qid: string; a: CopilotAnswer } | null>(null);
  const debts = accounts.filter((a) => !a.is_archived && isLiability(a.account_type));

  function valueFor(key: string, def: number | string) {
    return values[`${qid}:${key}`] ?? String(def);
  }
  function run() {
    const v = Object.fromEntries(q.fields.map((f) => [f.key, f.kind === "account_debt" || f.kind === "goal" ? valueFor(f.key, f.default) : Number(valueFor(f.key, f.default) || 0)]));
    setAnswer({ qid, a: q.answer(inputs, v) });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" /> Financial Copilot
          </CardTitle>
          <CardDescription className="mt-1">Calculator mode: every answer is run through the projection engine with your own numbers. Projections, assumptions and general education are always labeled separately.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field label="Question" htmlFor="cp-q" hint={q.prompt}>
          <NativeSelect id="cp-q" value={qid} onChange={(e) => setQid(e.target.value)}>
            {COPILOT_QUESTIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {q.fields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`cp-${f.key}`}>
              {f.kind === "money" ? (
                <MoneyInput id={`cp-${f.key}`} value={valueFor(f.key, f.default)} onChange={(v) => setValues({ ...values, [`${qid}:${f.key}`]: v })} />
              ) : f.kind === "pct" ? (
                <PctInput id={`cp-${f.key}`} value={valueFor(f.key, f.default)} onChange={(v) => setValues({ ...values, [`${qid}:${f.key}`]: v })} />
              ) : f.kind === "months" ? (
                <Input id={`cp-${f.key}`} inputMode="numeric" value={valueFor(f.key, f.default)} onChange={(e) => setValues({ ...values, [`${qid}:${f.key}`]: e.target.value.replace(/[^0-9]/g, "") })} />
              ) : f.kind === "account_debt" ? (
                <NativeSelect id={`cp-${f.key}`} value={valueFor(f.key, f.default)} onChange={(e) => setValues({ ...values, [`${qid}:${f.key}`]: e.target.value })}>
                  <option value="">Highest-APR debt</option>
                  {debts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({fmtMoney(a.balance)})
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <NativeSelect id={`cp-${f.key}`} value={valueFor(f.key, f.default)} onChange={(e) => setValues({ ...values, [`${qid}:${f.key}`]: e.target.value })}>
                  <option value="">First dated goal</option>
                  {goals.filter((g) => g.status === "active").map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ))}
        </div>
        <div>
          <Button onClick={run}>
            <Calculator /> Calculate
          </Button>
        </div>
        {answer && answer.qid === qid ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <p className="text-sm font-semibold">{answer.a.headline}</p>
            {answer.a.projection.length ? (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wide">Projection</h3>
                <ul className="list-disc space-y-0.5 pl-4 text-sm">
                  {answer.a.projection.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {answer.a.assumptions.length ? (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wide">Assumptions</h3>
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                  {answer.a.assumptions.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {answer.a.education.length ? (
              <section>
                <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wide">General education</h3>
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                  {answer.a.education.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="text-muted-foreground text-xs">Not a guarantee or personalized investment advice. Change the assumptions on the Overview page to see how sensitive the answer is.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
