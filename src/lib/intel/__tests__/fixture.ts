import { emptySummary, type DailySummary, type EngineContext, type RuleSettings, DEFAULT_RULE_SETTINGS } from "../types";
import { computeBaselines } from "../baselines";

/** Deterministic pseudo-random in [0,1) so fixtures are stable across runs. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A plausible healthy history ending on `today`: RHR ~52, HRV ~70, sleep ~7h, strain ~10, resp ~14.5,
 * SpO2 ~96.5, skin temp ~33.2, with a workout on two days in three. `shape(i, day)` mutates a day
 * (i = 0 is the oldest).
 */
export function makeDays(n: number, today: string, shape?: (i: number, d: DailySummary, r: () => number) => void, seed = 7): DailySummary[] {
  const r = rng(seed);
  const out: DailySummary[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(today, i - (n - 1));
    const d = emptySummary(day);
    d.provider = "whoop_export";
    d.resting_hr = Math.round(52 + (r() - 0.5) * 4);
    d.hrv_rmssd = Math.round(70 + (r() - 0.5) * 16);
    d.recovery_score = Math.round(65 + (r() - 0.5) * 30);
    d.sleep_total_min = Math.round(420 + (r() - 0.5) * 60);
    d.in_bed_min = d.sleep_total_min + 35;
    d.light_min = Math.round(d.sleep_total_min * 0.5);
    d.deep_min = Math.round(d.sleep_total_min * 0.22);
    d.rem_min = Math.round(d.sleep_total_min * 0.28);
    d.awake_min = Math.round(30 + r() * 15);
    d.sleep_efficiency = Math.round(88 + r() * 6);
    d.sleep_performance = Math.round((d.sleep_total_min / 480) * 100);
    d.sleep_consistency = Math.round(70 + r() * 20);
    d.sleep_need_min = 480;
    d.sleep_debt_min = Math.max(0, 480 - d.sleep_total_min);
    d.sleep_onset_min = Math.round(670 + (r() - 0.5) * 40);
    d.wake_min = Math.round(1110 + (r() - 0.5) * 40);
    d.resp_rate = Math.round((14.5 + (r() - 0.5) * 1.0) * 10) / 10;
    d.spo2 = Math.round((96.5 + (r() - 0.5) * 1.5) * 10) / 10;
    d.skin_temp = Math.round((33.2 + (r() - 0.5) * 0.5) * 100) / 100;
    const trained = i % 3 !== 2;
    d.day_strain = Math.round(((trained ? 12 : 7) + (r() - 0.5) * 3) * 10) / 10;
    d.energy_kcal = Math.round(1900 + d.day_strain * 90);
    d.avg_hr = Math.round(68 + r() * 8);
    d.max_hr = trained ? Math.round(160 + r() * 20) : Math.round(120 + r() * 20);
    d.workout_count = trained ? 1 : 0;
    d.workout_min = trained ? Math.round(40 + r() * 30) : null;
    d.workout_strain = trained ? Math.round((8 + r() * 6) * 10) / 10 : null;
    d.workout_avg_hr = trained ? Math.round(135 + r() * 20) : null;
    d.workout_max_hr = trained ? d.max_hr : null;
    d.workout_kcal = trained ? Math.round(400 + r() * 300) : null;
    d.nap_count = 0;
    d.completeness = 1;
    shape?.(i, d, r);
    out.push(d);
  }
  return out;
}

export function makeContext(days: DailySummary[], settings: Partial<RuleSettings> = {}, behaviors: EngineContext["behaviors"] = []): EngineContext {
  return {
    days,
    today: days[days.length - 1].day,
    baselines: computeBaselines(days),
    behaviors,
    settings: { ...DEFAULT_RULE_SETTINGS, ...settings },
    timezone: "America/Indiana/Indianapolis",
  };
}
