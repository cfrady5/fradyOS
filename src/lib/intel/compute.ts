import type { HealthDayRow, HealthSleepRow, HealthWorkoutRow } from "@/lib/data/health";
import { ALGORITHM_VERSION, DEFAULT_RULE_SETTINGS, type Baseline, type BehaviorEntry, type DailySummary, type DerivedScore, type EngineContext, type Finding, type MetricKey, type RuleSettings } from "./types";
import { buildDailySummaries, fillCalendar } from "./summaries";
import { computeBaselines } from "./baselines";
import { runEngines, SCORES } from "./engines";
import { rankInsights, type Insight } from "./insights";

export interface ComputeInput {
  days: HealthDayRow[];
  sleeps: HealthSleepRow[];
  workouts: HealthWorkoutRow[];
  derivedDays?: Partial<DailySummary>[];
  behaviors: BehaviorEntry[];
  today: string;
  timezone: string;
  settings?: Partial<RuleSettings>;
  /** Days of derived-score history to compute (each day re-runs the score with that day as "today"). */
  scoreHistoryDays?: number;
}

export interface CorrelationRow {
  key: string;
  xLabel: string;
  yLabel: string;
  lagDays: number;
  method: string;
  n: number;
  r: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  diff: number | null;
  diffCiLow: number | null;
  diffCiHigh: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  detail: Record<string, unknown>;
}

export interface ComputeResult {
  version: string;
  summaries: DailySummary[];
  calendar: DailySummary[];
  baselines: Record<MetricKey, Baseline>;
  findings: Finding[];
  engineErrors: { engine: string; message: string }[];
  derived: DerivedScore[];
  correlations: CorrelationRow[];
  insights: Insight[];
  context: EngineContext;
}

/** The whole intelligence layer as one pure function of the data. */
export function computeIntelligence(input: ComputeInput): ComputeResult {
  const summaries = buildDailySummaries({ days: input.days, sleeps: input.sleeps, workouts: input.workouts, derivedDays: input.derivedDays, timezone: input.timezone });
  const calendar = fillCalendar(summaries, input.today, 180);
  const settings: RuleSettings = { ...DEFAULT_RULE_SETTINGS, ...input.settings, disabled: input.settings?.disabled ?? new Set() };
  const baselines = computeBaselines(calendar);
  const ctx: EngineContext = { days: calendar, today: input.today, baselines, behaviors: input.behaviors, settings, timezone: input.timezone };

  const empty = calendar.length === 0;
  const { findings, errors } = empty ? { findings: [], errors: [] } : runEngines(ctx);

  const derived: DerivedScore[] = [];
  if (!empty) {
    const history = Math.min(input.scoreHistoryDays ?? 90, calendar.length);
    for (const s of SCORES) {
      if (!s.history) {
        derived.push(safeScore(() => s.fn(ctx), s.key, input.today));
        continue;
      }
      for (let i = calendar.length - history; i < calendar.length; i++) {
        const day = calendar[i].day;
        const slice = calendar.slice(0, i + 1);
        const sub: EngineContext = { ...ctx, days: slice, today: day, baselines: i === calendar.length - 1 ? baselines : computeBaselines(slice) };
        derived.push(safeScore(() => s.fn(sub, day), s.key, day));
      }
    }
  }

  const correlations: CorrelationRow[] = findings
    .filter((f) => f.kind === "correlation")
    .map((f) => {
      const e = (f.evidence ?? {}) as Record<string, unknown>;
      const ci = Array.isArray(e.ci) ? (e.ci as number[]) : null;
      const diffCi = Array.isArray(e.diffCi) ? (e.diffCi as number[]) : null;
      return {
        key: f.rule,
        xLabel: String(e.x ?? f.title),
        yLabel: String(e.y ?? f.metric ?? ""),
        lagDays: typeof e.lag === "number" ? e.lag : 0,
        method: f.method,
        n: typeof e.n === "number" ? e.n : 0,
        r: typeof e.r === "number" ? e.r : null,
        ciLow: ci ? ci[0] : null,
        ciHigh: ci ? ci[1] : null,
        diff: typeof e.diff === "number" ? e.diff : null,
        diffCiLow: diffCi ? diffCi[0] : null,
        diffCiHigh: diffCi ? diffCi[1] : null,
        periodStart: typeof e.from === "string" ? e.from : (calendar[0]?.day ?? null),
        periodEnd: typeof e.to === "string" ? e.to : input.today,
        detail: e,
      };
    });

  const insights = empty ? [] : rankInsights(findings, derived, baselines, input.today);
  return { version: ALGORITHM_VERSION, summaries, calendar, baselines, findings, engineErrors: errors, derived, correlations, insights, context: ctx };
}

function safeScore(fn: () => DerivedScore, key: DerivedScore["key"], day: string): DerivedScore {
  try {
    return fn();
  } catch (e) {
    return { key, day, value: null, version: "error", factors: [], completeness: 0, note: `Score failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
