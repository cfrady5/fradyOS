import type { Engine, EngineContext, EngineKey, DerivedScore } from "../types";
import { cardioEngine, ENGINE_RULES as CARDIO_RULES } from "./cardio";
import { recoveryEngine, readinessScore, ENGINE_RULES as RECOVERY_RULES } from "./recovery";
import { sleepEngine, sleepQualityIndex, ENGINE_RULES as SLEEP_RULES } from "./sleep";
import { respiratoryEngine, ENGINE_RULES as RESPIRATORY_RULES } from "./respiratory";
import { temperatureEngine, ENGINE_RULES as TEMPERATURE_RULES } from "./temperature";
import { activityEngine, ENGINE_RULES as ACTIVITY_RULES } from "./activity";
import { loadEngine, physiologicalLoad, ENGINE_RULES as LOAD_RULES } from "./load";
import { longtermEngine, healthTrend, ENGINE_RULES as LONGTERM_RULES } from "./longterm";
import { anomalyEngine, ENGINE_RULES as ANOMALY_RULES } from "./anomaly";
import { behaviorEngine, ENGINE_RULES as BEHAVIOR_RULES } from "./behavior";

export const ENGINES: Record<EngineKey, Engine> = {
  cardio: cardioEngine,
  recovery: recoveryEngine,
  sleep: sleepEngine,
  respiratory: respiratoryEngine,
  temperature: temperatureEngine,
  activity: activityEngine,
  load: loadEngine,
  longterm: longtermEngine,
  anomaly: anomalyEngine,
  behavior: behaviorEngine,
};

export const ENGINE_LABELS: Record<EngineKey, string> = {
  cardio: "Cardiovascular",
  recovery: "Recovery and readiness",
  sleep: "Sleep",
  respiratory: "Respiratory and oxygen",
  temperature: "Temperature",
  activity: "Activity and movement",
  load: "Physiological load",
  longterm: "Long-term trends",
  anomaly: "Anomaly detection",
  behavior: "Behaviour and habits",
};

const tag = (rules: { rule: string; label: string; description: string }[], engine: EngineKey) => rules.map((r) => ({ ...r, engine }));

export const ALL_RULES = [
  ...tag(CARDIO_RULES, "cardio"),
  ...tag(RECOVERY_RULES, "recovery"),
  ...tag(SLEEP_RULES, "sleep"),
  ...tag(RESPIRATORY_RULES, "respiratory"),
  ...tag(TEMPERATURE_RULES, "temperature"),
  ...tag(ACTIVITY_RULES, "activity"),
  ...tag(LOAD_RULES, "load"),
  ...tag(LONGTERM_RULES, "longterm"),
  ...tag(ANOMALY_RULES, "anomaly"),
  ...tag(BEHAVIOR_RULES, "behavior"),
];

/** Runs every engine, isolating failures so one rule cannot take the others down. */
export function runEngines(ctx: EngineContext): { findings: ReturnType<Engine>; errors: { engine: EngineKey; message: string }[] } {
  const findings: ReturnType<Engine> = [];
  const errors: { engine: EngineKey; message: string }[] = [];
  for (const [key, engine] of Object.entries(ENGINES) as [EngineKey, Engine][]) {
    try {
      for (const f of engine(ctx)) if (!ctx.settings.disabled.has(f.rule)) findings.push(f);
    } catch (e) {
      errors.push({ engine: key, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { findings, errors };
}

export const SCORES: { key: DerivedScore["key"]; fn: (ctx: EngineContext, day?: string) => DerivedScore; history: boolean }[] = [
  { key: "readiness", fn: readinessScore, history: true },
  { key: "sleep_quality_index", fn: sleepQualityIndex, history: true },
  { key: "physiological_load", fn: physiologicalLoad, history: true },
  { key: "health_trend", fn: healthTrend, history: false },
];
