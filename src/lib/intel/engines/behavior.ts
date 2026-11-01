/**
 * Behaviour engine: compares manually logged behaviours with the biometric outcomes that follow them.
 *
 * A row's `day` is the wake day, so the night's sleep and the morning's recovery on row t reflect
 * behaviour on calendar day t-1. A behaviour on day d is therefore compared with sleep, HRV, resting
 * heart rate, recovery and respiratory rate on row d+1, and with day strain on row d. Groups are
 * compared with a Welch test; text is produced only when the 95% CI excludes zero, and it is always
 * worded as an association. Medication logs never appear in text; they only count as a confounder.
 */

import { type BehaviorEntry, type BehaviorKind, type DailySummary, type Engine, type EngineContext, type Finding, type MetricKey } from "../types";
import { mean, median, round, welch } from "../stats";
import { finding } from "../findings";

export interface BehaviorInsight {
  key: string;
  kind: BehaviorKind;
  outcome: MetricKey;
  condition: string;
  withMean: number;
  withoutMean: number;
  diff: number;
  ci: [number, number];
  nWith: number;
  nWithout: number;
  period: { from: string; to: string };
  confounders: string[];
  text: string;
}

/** Every comparison that met the sample requirement, significant or not. */
export interface BehaviorComparison extends BehaviorInsight {
  rule: string;
  significant: boolean;
  t: number;
  completeness: number;
}

export const MIN_GROUP = 5;
export const WINDOW_DAYS = 90;
export const ASSOCIATION_NOTE = "This is an association, not a cause.";

const ENGINE = "behavior" as const;

export const RULES = {
  noLogs: "behavior.no_logs",
  caffeineLate: "behavior.caffeine_late",
  alcoholAny: "behavior.alcohol_any",
  alcoholHeavy: "behavior.alcohol_heavy",
  waterHigh: "behavior.water_high",
  mealLate: "behavior.meal_late",
  exerciseLate: "behavior.exercise_late",
  bedtimeRoutine: "behavior.bedtime_routine",
  supplement: "behavior.supplement",
  stress: "behavior.stress",
  travel: "behavior.travel",
  illness: "behavior.illness",
} as const;

export const ENGINE_RULES: { rule: string; label: string; description: string }[] = [
  { rule: RULES.noLogs, label: "No behaviours logged", description: "Status: nothing has been logged yet, so no behaviour comparisons can run." },
  { rule: RULES.caffeineLate, label: "Caffeine after 3 PM", description: "Next-night sleep and next-morning recovery on days with caffeine logged after 3 PM local time." },
  { rule: RULES.alcoholAny, label: "Alcohol", description: "Outcomes on days with any alcohol logged." },
  { rule: RULES.alcoholHeavy, label: "Two or more alcohol units", description: "Outcomes on days with two or more alcohol units logged." },
  { rule: RULES.waterHigh, label: "High water intake", description: "Outcomes on days with 2000 ml or more of water, or above your median logged day." },
  { rule: RULES.mealLate, label: "Meal after 9 PM", description: "Outcomes on days with a meal logged after 9 PM local time." },
  { rule: RULES.exerciseLate, label: "Exercise after 7 PM", description: "Outcomes on days with exercise logged after 7 PM local time." },
  { rule: RULES.bedtimeRoutine, label: "Bedtime routine", description: "Outcomes on days with a bedtime routine logged." },
  { rule: RULES.supplement, label: "Supplement", description: "Outcomes on days with a supplement logged, per supplement name when the note gives one." },
  { rule: RULES.stress, label: "Stress", description: "Outcomes on days with stress logged." },
  { rule: RULES.travel, label: "Travel", description: "Outcomes on days with travel logged." },
  { rule: RULES.illness, label: "Illness", description: "Outcomes on days with illness logged." },
];

// ---------------------------------------------------------------------------------------------
// Outcomes

type UnitWord = "minutes" | "points" | "ms" | "bpm" | "br/min";

interface Outcome {
  metric: MetricKey;
  noun: string;
  unit: UnitWord;
  /** 1 when the outcome lives on the row after the behaviour day. */
  shift: 0 | 1;
  decimals: number;
}

export const OUTCOMES: Outcome[] = [
  { metric: "sleep_total_min", noun: "sleep duration", unit: "minutes", shift: 1, decimals: 0 },
  { metric: "sleep_efficiency", noun: "sleep efficiency", unit: "points", shift: 1, decimals: 0 },
  { metric: "hrv_rmssd", noun: "HRV", unit: "ms", shift: 1, decimals: 0 },
  { metric: "resting_hr", noun: "resting heart rate", unit: "bpm", shift: 1, decimals: 0 },
  { metric: "recovery_score", noun: "recovery score", unit: "points", shift: 1, decimals: 0 },
  { metric: "resp_rate", noun: "respiratory rate", unit: "br/min", shift: 1, decimals: 1 },
  { metric: "day_strain", noun: "day strain (a training performance proxy)", unit: "points", shift: 0, decimals: 1 },
];

// ---------------------------------------------------------------------------------------------
// Time helpers

/** Local hour (0..23) of an ISO timestamp in the given IANA zone; null when unparseable. */
export function localHour(at: string | null, timezone: string): number | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).formatToParts(d);
    const h = parts.find((p) => p.type === "hour");
    if (h) return Number(h.value) % 24;
  } catch {
    // invalid timezone: fall back to UTC below
  }
  return d.getUTCHours();
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function isWeekend(day: string): boolean {
  const dow = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
  return dow === 0 || dow === 6;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------------------------
// Conditions

interface Condition {
  key: string;
  rule: string;
  kind: BehaviorKind;
  /** Short label for titles. */
  label: string;
  /** "On days with <with>, ..." */
  with: string;
  /** "... than on comparable days without <without> ..." */
  without: string;
  days: Set<string>;
}

const KIND_LABEL: Record<BehaviorKind, string> = {
  caffeine: "caffeine",
  alcohol: "alcohol",
  water: "water",
  meal: "a meal",
  calories: "calories",
  protein: "protein",
  exercise: "exercise",
  bedtime_routine: "a bedtime routine",
  supplement: "a supplement",
  stress: "stress",
  travel: "travel",
  illness: "illness",
  medication: "medication",
};

function waterMl(b: BehaviorEntry): number | null {
  if (b.amount == null) return null;
  const u = (b.unit ?? "ml").toLowerCase().trim();
  if (u === "ml" || u === "milliliter" || u === "milliliters" || u === "millilitre" || u === "millilitres") return b.amount;
  if (u === "l" || u === "liter" || u === "liters" || u === "litre" || u === "litres") return b.amount * 1000;
  if (u === "oz" || u === "fl oz") return b.amount * 29.57;
  if (u === "cup" || u === "cups") return b.amount * 240;
  if (u === "glass" || u === "glasses") return b.amount * 250;
  return b.amount;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Build every condition the logs support. Medication never becomes a condition. */
export function buildConditions(behaviors: BehaviorEntry[], timezone: string): Condition[] {
  const byKind = new Map<BehaviorKind, BehaviorEntry[]>();
  for (const b of behaviors) {
    const list = byKind.get(b.kind) ?? [];
    list.push(b);
    byKind.set(b.kind, list);
  }
  const daysWhere = (kind: BehaviorKind, pred: (b: BehaviorEntry) => boolean = () => true) => new Set((byKind.get(kind) ?? []).filter(pred).map((b) => b.day));
  const sumPerDay = (kind: BehaviorKind, value: (b: BehaviorEntry) => number | null) => {
    const totals = new Map<string, number>();
    for (const b of byKind.get(kind) ?? []) {
      const v = value(b);
      if (v == null || !Number.isFinite(v)) continue;
      totals.set(b.day, (totals.get(b.day) ?? 0) + v);
    }
    return totals;
  };
  const out: Condition[] = [];

  out.push({ key: "caffeine_late", rule: RULES.caffeineLate, kind: "caffeine", label: "Caffeine after 3 PM", with: "caffeine logged after 3 PM", without: "late caffeine", days: daysWhere("caffeine", (b) => (localHour(b.at, timezone) ?? -1) >= 15) });
  out.push({ key: "alcohol_any", rule: RULES.alcoholAny, kind: "alcohol", label: "Alcohol", with: "alcohol logged", without: "alcohol", days: daysWhere("alcohol") });
  const alcoholTotals = sumPerDay("alcohol", (b) => b.amount);
  out.push({ key: "alcohol_heavy", rule: RULES.alcoholHeavy, kind: "alcohol", label: "Two or more alcohol units", with: "2 or more alcohol units logged", without: "2 or more units", days: new Set([...alcoholTotals].filter(([, v]) => v >= 2).map(([d]) => d)) });

  const waterTotals = sumPerDay("water", waterMl);
  if (waterTotals.size) {
    const totals = [...waterTotals.values()];
    const reaches2000 = totals.filter((v) => v >= 2000).length;
    if (reaches2000 >= MIN_GROUP) {
      out.push({ key: "water_high", rule: RULES.waterHigh, kind: "water", label: "Water 2000 ml or more", with: "2000 ml or more of water logged", without: "that much water", days: new Set([...waterTotals].filter(([, v]) => v >= 2000).map(([d]) => d)) });
    } else {
      const med = median(totals) ?? 0;
      out.push({ key: "water_above_median", rule: RULES.waterHigh, kind: "water", label: "Water above your median day", with: `water intake above your median logged day (${Math.round(med)} ml)`, without: "that much water", days: new Set([...waterTotals].filter(([, v]) => v > med).map(([d]) => d)) });
    }
  }

  out.push({ key: "meal_late", rule: RULES.mealLate, kind: "meal", label: "Meal after 9 PM", with: "a meal logged after 9 PM", without: "a late meal", days: daysWhere("meal", (b) => (localHour(b.at, timezone) ?? -1) >= 21) });
  out.push({ key: "exercise_late", rule: RULES.exerciseLate, kind: "exercise", label: "Exercise after 7 PM", with: "exercise logged after 7 PM", without: "late exercise", days: daysWhere("exercise", (b) => (localHour(b.at, timezone) ?? -1) >= 19) });
  out.push({ key: "bedtime_routine", rule: RULES.bedtimeRoutine, kind: "bedtime_routine", label: "Bedtime routine", with: "a bedtime routine logged", without: "a bedtime routine", days: daysWhere("bedtime_routine") });

  const supplements = byKind.get("supplement") ?? [];
  const named = new Map<string, Set<string>>();
  const unnamed = new Set<string>();
  for (const s of supplements) {
    const name = s.note?.trim();
    if (name) {
      const k = name.toLowerCase();
      const set = named.get(k) ?? new Set<string>();
      set.add(s.day);
      named.set(k, set);
    } else unnamed.add(s.day);
  }
  for (const [name, days] of named) {
    out.push({ key: `supplement_${slug(name)}`, rule: RULES.supplement, kind: "supplement", label: `Supplement: ${name}`, with: `${name} logged`, without: name, days });
  }
  if (unnamed.size) out.push({ key: "supplement", rule: RULES.supplement, kind: "supplement", label: "Supplement", with: "a supplement logged", without: "a supplement", days: unnamed });

  out.push({ key: "stress", rule: RULES.stress, kind: "stress", label: "Stress", with: "stress logged", without: "stress", days: daysWhere("stress") });
  out.push({ key: "travel", rule: RULES.travel, kind: "travel", label: "Travel", with: "travel logged", without: "travel", days: daysWhere("travel") });
  out.push({ key: "illness", rule: RULES.illness, kind: "illness", label: "Illness", with: "illness logged", without: "illness", days: daysWhere("illness") });

  return out.filter((c) => c.days.size > 0);
}

// ---------------------------------------------------------------------------------------------
// Wording

function fmtAmount(v: number, decimals: number): string {
  return String(round(Math.abs(v), decimals));
}

function directionWord(o: Outcome, diff: number): string {
  if (o.unit === "minutes") return diff < 0 ? "shorter" : "longer";
  return diff < 0 ? "lower" : "higher";
}

export function insightText(c: Pick<Condition, "with" | "without">, o: Outcome, r: { diff: number; ci: [number, number]; nWith: number; nWithout: number; spanDays: number }): string {
  const lo = Math.min(Math.abs(r.ci[0]), Math.abs(r.ci[1]));
  const hi = Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1]));
  return `On days with ${c.with}, your average ${o.noun} was ${fmtAmount(r.diff, o.decimals)} ${o.unit} ${directionWord(o, r.diff)} than on comparable days without ${c.without} (n=${r.nWith} vs ${r.nWithout}, 95% CI ${fmtAmount(lo, o.decimals)} to ${fmtAmount(hi, o.decimals)} ${o.unit}, last ${r.spanDays} days). ${ASSOCIATION_NOTE}`;
}

// ---------------------------------------------------------------------------------------------
// Evaluation

function share(days: string[], pred: (d: string) => boolean): number {
  return days.length ? days.filter(pred).length / days.length : 0;
}

function confoundersFor(c: Condition, withDays: string[], withoutDays: string[], behaviors: BehaviorEntry[], rowByDay: Map<string, DailySummary>): string[] {
  const out: string[] = [];
  const kindsByDay = new Map<string, Set<BehaviorKind>>();
  for (const b of behaviors) {
    const set = kindsByDay.get(b.day) ?? new Set<BehaviorKind>();
    set.add(b.kind);
    kindsByDay.set(b.day, set);
  }
  const kinds = [...new Set(behaviors.map((b) => b.kind))].filter((k) => k !== c.kind);
  for (const k of kinds) {
    const s = share(withDays, (d) => kindsByDay.get(d)?.has(k) === true);
    if (s > 0.5) out.push(`${KIND_LABEL[k]} logged on ${Math.round(s * 100)}% of these days`);
  }
  const wkWith = share(withDays, isWeekend);
  const wkWithout = share(withoutDays, isWeekend);
  if (Math.abs(wkWith - wkWithout) > 0.2) out.push(`weekend share ${Math.round(wkWith * 100)}% vs ${Math.round(wkWithout * 100)}% on comparison days`);
  const trained = (d: string) => (rowByDay.get(d)?.workout_count ?? 0) > 0;
  const woWith = share(withDays, trained);
  const woWithout = share(withoutDays, trained);
  if (Math.abs(woWith - woWithout) > 0.2) out.push(`workouts on ${Math.round(woWith * 100)}% of these days vs ${Math.round(woWithout * 100)}% of comparison days`);
  return out;
}

/** Every condition x outcome comparison with at least MIN_GROUP days in each group. */
export function evaluateBehaviors(ctx: EngineContext): BehaviorComparison[] {
  const out: BehaviorComparison[] = [];
  if (!ctx.behaviors.length || !ctx.days.length) return out;
  const today = ctx.today;
  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const logDays = ctx.behaviors.map((b) => b.day).sort();
  const from = logDays[0] > windowStart ? logDays[0] : windowStart;
  const inWindow = ctx.behaviors.filter((b) => b.day >= from && b.day <= today);
  if (!inWindow.length) return out;
  const index = new Map<string, number>();
  ctx.days.forEach((d, i) => index.set(d.day, i));
  const rowByDay = new Map(ctx.days.map((d) => [d.day, d] as const));
  const calendar = ctx.days.map((d) => d.day).filter((d) => d >= from && d <= today);
  const conditions = buildConditions(inWindow, ctx.timezone);

  for (const c of conditions) {
    for (const o of OUTCOMES) {
      const outcomeOf = (day: string): number | null => {
        const i = index.get(day);
        if (i == null) return null;
        const row = ctx.days[i + o.shift];
        if (!row || !row.scored) return null;
        const v = row[o.metric];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      };
      const withDays: string[] = [];
      const withoutDays: string[] = [];
      const withVals: number[] = [];
      const withoutVals: number[] = [];
      let eligible = 0;
      for (const day of calendar) {
        if (o.shift === 1 && day === today) continue;
        eligible++;
        const v = outcomeOf(day);
        if (v == null) continue;
        if (c.days.has(day)) {
          withDays.push(day);
          withVals.push(v);
        } else {
          withoutDays.push(day);
          withoutVals.push(v);
        }
      }
      if (withVals.length < MIN_GROUP || withoutVals.length < MIN_GROUP) continue;
      const w = welch(withVals, withoutVals);
      if (!w) continue;
      const significant = w.ci[0] > 0 || w.ci[1] < 0;
      const to = o.shift === 1 ? addDays(today, -1) : today;
      // The lookback window, as worded in the text; `period.to` is the last day evidence exists for.
      const spanDays = daysBetween(from, today);
      const base: BehaviorInsight = {
        key: `${c.key}:${o.metric}`,
        kind: c.kind,
        outcome: o.metric,
        condition: c.with,
        withMean: round(mean(withVals), 3)!,
        withoutMean: round(mean(withoutVals), 3)!,
        diff: round(w.diff, 3)!,
        ci: [round(w.ci[0], 3)!, round(w.ci[1], 3)!],
        nWith: w.nA,
        nWithout: w.nB,
        period: { from, to },
        confounders: confoundersFor(c, withDays, withoutDays, inWindow, rowByDay),
        text: significant ? insightText(c, o, { diff: w.diff, ci: w.ci, nWith: w.nA, nWithout: w.nB, spanDays }) : "",
      };
      out.push({ ...base, rule: c.rule, significant, t: round(w.t, 3)!, completeness: eligible ? (withVals.length + withoutVals.length) / eligible : 0 });
    }
  }
  return out;
}

/** Only the comparisons whose 95% CI excludes zero, each with worded text. */
export function behaviorInsights(ctx: EngineContext): BehaviorInsight[] {
  return evaluateBehaviors(ctx).filter((c) => c.significant).map(toInsight);
}

function toInsight(c: BehaviorComparison): BehaviorInsight {
  return {
    key: c.key,
    kind: c.kind,
    outcome: c.outcome,
    condition: c.condition,
    withMean: c.withMean,
    withoutMean: c.withoutMean,
    diff: c.diff,
    ci: c.ci,
    nWith: c.nWith,
    nWithout: c.nWithout,
    period: c.period,
    confounders: c.confounders,
    text: c.text,
  };
}

const LOGGABLE = "caffeine, alcohol, water, meals, calories, protein, exercise timing, bedtime routine, supplements, stress, travel, illness and medication";

export const behaviorEngine: Engine = (ctx) => {
  const out: Finding[] = [];
  const emit = (f: Finding) => {
    if (!ctx.settings.disabled.has(f.rule)) out.push(f);
  };
  if (!ctx.behaviors.length) {
    emit(
      finding({
        rule: RULES.noLogs,
        engine: ENGINE,
        kind: "status",
        metric: null,
        day: ctx.today,
        severity: "info",
        title: "No behaviours logged yet",
        method: "status",
        completeness: 0,
        explanation: `Nothing has been logged, so there is nothing to compare your sleep and recovery against. You can log ${LOGGABLE}. Each behaviour on a day is compared with the following night's sleep and the next morning's recovery, and with that day's strain.`,
        nextStep: `Log the behaviours you suspect matter for a few weeks. Comparisons start once a behaviour has at least ${MIN_GROUP} days with it and ${MIN_GROUP} without.`,
        evidence: { minGroup: MIN_GROUP, windowDays: WINDOW_DAYS },
      }),
    );
    return out;
  }
  for (const c of evaluateBehaviors(ctx)) {
    if (!c.significant) continue;
    const o = OUTCOMES.find((x) => x.metric === c.outcome)!;
    const insight = toInsight(c);
    const confounders = insight.confounders.length ? ` Possible confounders: ${insight.confounders.join("; ")}.` : "";
    emit(
      finding({
        rule: c.rule,
        engine: ENGINE,
        kind: "correlation",
        metric: c.outcome,
        day: insight.period.to,
        severity: "info",
        title: `${conditionLabel(c)} and ${o.noun.replace(/ \(.*\)$/, "")}`,
        value: insight.withMean,
        baseline: insight.withoutMean,
        method: "welch",
        completeness: c.completeness,
        explanation: `${insight.text}${confounders}`,
        nextStep: "Keep logging so the comparison sharpens, and weigh the listed confounders before changing anything.",
        evidence: { insight, n: insight.nWith + insight.nWithout, r: null, ci: insight.ci, t: c.t, shiftDays: o.shift, method: "welch" },
      }),
    );
  }
  return out;
};

function conditionLabel(c: BehaviorComparison): string {
  const s = c.condition.replace(/ logged.*$/, "").replace(/^a /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default behaviorEngine;
