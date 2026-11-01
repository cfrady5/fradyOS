/**
 * FRADY Health Intelligence: the unified biometric model every engine reads.
 *
 * A DailySummary is one local day with every metric nullable. Nothing substitutes zero for a missing
 * reading; completeness is tracked separately. Engines are pure functions of history, so the same
 * data always yields the same findings for a given algorithm version.
 */

export type Provider = "whoop_api" | "whoop_export" | "noop_export" | "ble" | "manual";

export type MetricKey =
  | "recovery_score"
  | "resting_hr"
  | "hrv_rmssd"
  | "spo2"
  | "skin_temp"
  | "resp_rate"
  | "day_strain"
  | "avg_hr"
  | "max_hr"
  | "energy_kcal"
  | "steps"
  | "sleep_total_min"
  | "in_bed_min"
  | "awake_min"
  | "light_min"
  | "deep_min"
  | "rem_min"
  | "sleep_cycles"
  | "disturbances"
  | "sleep_efficiency"
  | "sleep_performance"
  | "sleep_consistency"
  | "sleep_need_min"
  | "sleep_debt_min"
  | "sleep_onset_min"
  | "wake_min"
  | "nap_min"
  | "nap_count"
  | "workout_count"
  | "workout_min"
  | "workout_strain"
  | "workout_avg_hr"
  | "workout_max_hr"
  | "workout_kcal";

export interface MetricMeta {
  label: string;
  unit: string;
  /** Which direction a higher value usually points, for wording and tones. "neutral" for timing fields. */
  better: "higher" | "lower" | "neutral";
  /** Minimum valid samples before a personalised baseline may drive an alert. */
  minSamples: number;
  group: "cardio" | "sleep" | "recovery" | "respiratory" | "temperature" | "activity";
  decimals: number;
}

export const METRICS: Record<MetricKey, MetricMeta> = {
  recovery_score: { label: "Recovery", unit: "%", better: "higher", minSamples: 14, group: "recovery", decimals: 0 },
  resting_hr: { label: "Resting heart rate", unit: "bpm", better: "lower", minSamples: 14, group: "cardio", decimals: 0 },
  hrv_rmssd: { label: "HRV", unit: "ms", better: "higher", minSamples: 14, group: "cardio", decimals: 0 },
  spo2: { label: "Blood oxygen", unit: "%", better: "higher", minSamples: 14, group: "respiratory", decimals: 1 },
  skin_temp: { label: "Skin temperature", unit: "°C", better: "neutral", minSamples: 14, group: "temperature", decimals: 2 },
  resp_rate: { label: "Respiratory rate", unit: "br/min", better: "neutral", minSamples: 14, group: "respiratory", decimals: 1 },
  day_strain: { label: "Day strain", unit: "", better: "neutral", minSamples: 7, group: "activity", decimals: 1 },
  avg_hr: { label: "Average heart rate", unit: "bpm", better: "neutral", minSamples: 14, group: "cardio", decimals: 0 },
  max_hr: { label: "Max heart rate", unit: "bpm", better: "neutral", minSamples: 14, group: "cardio", decimals: 0 },
  energy_kcal: { label: "Energy", unit: "kcal", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
  steps: { label: "Steps", unit: "", better: "higher", minSamples: 7, group: "activity", decimals: 0 },
  sleep_total_min: { label: "Sleep", unit: "min", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  in_bed_min: { label: "Time in bed", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  awake_min: { label: "Awake", unit: "min", better: "lower", minSamples: 7, group: "sleep", decimals: 0 },
  light_min: { label: "Light sleep", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  deep_min: { label: "Deep sleep", unit: "min", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  rem_min: { label: "REM sleep", unit: "min", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_cycles: { label: "Sleep cycles", unit: "", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  disturbances: { label: "Disturbances", unit: "", better: "lower", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_efficiency: { label: "Sleep efficiency", unit: "%", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_performance: { label: "Sleep performance", unit: "%", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_consistency: { label: "Sleep consistency", unit: "%", better: "higher", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_need_min: { label: "Sleep need", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_debt_min: { label: "Sleep debt", unit: "min", better: "lower", minSamples: 7, group: "sleep", decimals: 0 },
  sleep_onset_min: { label: "Bedtime", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  wake_min: { label: "Wake time", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  nap_min: { label: "Nap", unit: "min", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  nap_count: { label: "Naps", unit: "", better: "neutral", minSamples: 7, group: "sleep", decimals: 0 },
  workout_count: { label: "Workouts", unit: "", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
  workout_min: { label: "Workout time", unit: "min", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
  workout_strain: { label: "Workout strain", unit: "", better: "neutral", minSamples: 7, group: "activity", decimals: 1 },
  workout_avg_hr: { label: "Workout avg HR", unit: "bpm", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
  workout_max_hr: { label: "Workout max HR", unit: "bpm", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
  workout_kcal: { label: "Workout energy", unit: "kcal", better: "neutral", minSamples: 7, group: "activity", decimals: 0 },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export type MetricValues = Record<MetricKey, number | null>;

export interface DailySummary extends MetricValues {
  /** Local calendar day (YYYY-MM-DD) in the user's timezone. */
  day: string;
  /** Provider that supplied the day's recovery/sleep record; null when only workouts exist. */
  provider: Provider | null;
  /** Share of core metrics present (0..1). Core: recovery, rhr, hrv, sleep total, strain, resp rate. */
  completeness: number;
  /** False when the provider marked the day's recovery or sleep as unscored or pending. */
  scored: boolean;
}

export const CORE_METRICS: MetricKey[] = ["recovery_score", "resting_hr", "hrv_rmssd", "sleep_total_min", "day_strain", "resp_rate"];

export function emptyValues(): MetricValues {
  const out = {} as MetricValues;
  for (const k of METRIC_KEYS) out[k] = null;
  return out;
}

export function emptySummary(day: string): DailySummary {
  return { ...emptyValues(), day, provider: null, completeness: 0, scored: true };
}

/** Personal baseline for one metric as of a day. All windows use valid samples only. */
export interface Baseline {
  metric: MetricKey;
  asOf: string;
  version: number;
  n: number;
  /** Most recent valid value on or before asOf. */
  last: number | null;
  lastDay: string | null;
  mean7: number | null;
  mean14: number | null;
  mean30: number | null;
  mean60: number | null;
  median90: number | null;
  sd90: number | null;
  mad90: number | null;
  p25: number | null;
  p75: number | null;
  /** Percentile rank of `last` within the 90-day history, 0..100. */
  percentile: number | null;
  /** Ordinary least-squares slope per day over 30 and 90 days. */
  slope30: number | null;
  slope90: number | null;
  /** Exponentially weighted moving average, alpha 0.2. */
  ewma: number | null;
  /** 7-day mean versus 30-day mean, in percent. */
  rateOfChange: number | null;
  /** True once minSamples valid readings exist, so personalised alerts may fire. */
  ready: boolean;
}

export type EngineKey = "cardio" | "sleep" | "recovery" | "respiratory" | "temperature" | "activity" | "load" | "longterm" | "anomaly" | "behavior";

export type Severity = "info" | "low" | "moderate" | "high";

export type FindingKind = "deviation" | "trend" | "pattern" | "correlation" | "status";

/** One detection. Everything a reader needs to check the claim is on the object. */
export interface Finding {
  /** Stable key, e.g. "cardio.rhr_elevated". */
  rule: string;
  engine: EngineKey;
  kind: FindingKind;
  metric: MetricKey | null;
  /** Day the finding applies to. */
  day: string;
  severity: Severity;
  title: string;
  value: number | null;
  baseline: number | null;
  delta: number | null;
  deltaPct: number | null;
  method: string;
  /** Share of the samples the rule wanted that were present (0..1). */
  completeness: number;
  explanation: string;
  nextStep: string;
  evidence?: Record<string, unknown>;
}

export interface BehaviorEntry {
  id: string;
  day: string;
  at: string | null;
  kind: BehaviorKind;
  amount: number | null;
  unit: string | null;
  note: string | null;
}

export type BehaviorKind =
  | "caffeine"
  | "alcohol"
  | "water"
  | "meal"
  | "calories"
  | "protein"
  | "exercise"
  | "bedtime_routine"
  | "supplement"
  | "stress"
  | "travel"
  | "illness"
  | "medication";

export interface RuleSettings {
  /** Personal robust-z threshold that marks a deviation as moderate; high is 1.5x this. */
  zModerate: number;
  /** Consecutive-day counts. */
  persistDays: number;
  /** Rules switched off by the user. */
  disabled: Set<string>;
}

export const DEFAULT_RULE_SETTINGS: RuleSettings = { zModerate: 2, persistDays: 3, disabled: new Set() };

export interface EngineContext {
  /** Ascending by day, ending on or before `today`. Includes days with no data only when needed by a rule. */
  days: DailySummary[];
  today: string;
  baselines: Record<MetricKey, Baseline>;
  behaviors: BehaviorEntry[];
  settings: RuleSettings;
  timezone: string;
}

export type Engine = (ctx: EngineContext) => Finding[];

/** Composite scores FRADY computes itself. Formula versions are stored with every row. */
export type DerivedKey = "sleep_quality_index" | "readiness" | "physiological_load" | "health_trend";

export interface DerivedScore {
  key: DerivedKey;
  day: string;
  value: number | null;
  version: string;
  /** Each factor's contribution and the input it came from, for the transparency panel. */
  factors: { key: string; label: string; weight: number; score: number | null; detail: string }[];
  completeness: number;
  note: string;
}

export const ALGORITHM_VERSION = "2026.11.1";
