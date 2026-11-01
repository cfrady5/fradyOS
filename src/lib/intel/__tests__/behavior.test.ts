import { describe, expect, it } from "vitest";
import { ENGINE_RULES, RULES, behaviorEngine, behaviorInsights, buildConditions, evaluateBehaviors, localHour } from "../engines/behavior";
import type { BehaviorEntry, DailySummary } from "../types";
import { makeContext, makeDays } from "./fixture";

const TODAY = "2026-10-15";
const N = 100;
let seq = 0;

function log(day: string, kind: BehaviorEntry["kind"], extra: Partial<BehaviorEntry> = {}): BehaviorEntry {
  return { id: `b${seq++}`, day, at: null, kind, amount: null, unit: null, note: null, ...extra };
}

/** Caffeine at 16:30 local (EDT, -04:00) on every third calendar day; the following night's sleep is 40 minutes shorter. */
function lateCaffeineFixture() {
  const isCaffeineDay = (i: number) => i % 3 === 0 && i < N - 1;
  const days = makeDays(N, TODAY, (i, d) => {
    if (i > 0 && isCaffeineDay(i - 1)) d.sleep_total_min = (d.sleep_total_min ?? 420) - 40;
  });
  const behaviors: BehaviorEntry[] = [];
  days.forEach((d, i) => {
    if (isCaffeineDay(i)) behaviors.push(log(d.day, "caffeine", { at: `${d.day}T16:30:00-04:00`, amount: 1, unit: "cup" }));
    else if (i % 3 === 1) behaviors.push(log(d.day, "caffeine", { at: `${d.day}T08:00:00-04:00`, amount: 1, unit: "cup" }));
  });
  return { days, behaviors };
}

describe("behavior engine: status", () => {
  it("emits behavior.no_logs when nothing is logged", () => {
    const out = behaviorEngine(makeContext(makeDays(N, TODAY)));
    expect(out.length).toBe(1);
    expect(out[0].rule).toBe(RULES.noLogs);
    expect(out[0].kind).toBe("status");
    expect(out[0].severity).toBe("info");
    expect(out[0].explanation).toMatch(/caffeine/);
    expect(out[0].explanation).toMatch(/medication/);
  });
  it("lists every rule key", () => {
    const keys = ENGINE_RULES.map((r) => r.rule);
    for (const k of Object.values(RULES)) expect(keys).toContain(k);
    expect(keys.every((k) => k.startsWith("behavior."))).toBe(true);
  });
  it("reads the local hour in the context timezone", () => {
    expect(localHour("2026-10-10T16:30:00-04:00", "America/Indiana/Indianapolis")).toBe(16);
    expect(localHour("2026-10-10T20:30:00Z", "America/Indiana/Indianapolis")).toBe(16);
    expect(localHour("2026-12-10T20:30:00Z", "America/Indiana/Indianapolis")).toBe(15);
    expect(localHour(null, "UTC")).toBeNull();
    expect(localHour("nonsense", "UTC")).toBeNull();
  });
});

describe("late caffeine and next-night sleep", () => {
  it("produces the worded insight with a CI that excludes zero", () => {
    const { days, behaviors } = lateCaffeineFixture();
    const ctx = makeContext(days, {}, behaviors);
    const insights = behaviorInsights(ctx);
    const sleep = insights.find((i) => i.key === "caffeine_late:sleep_total_min");
    expect(sleep).toBeDefined();
    expect(sleep!.kind).toBe("caffeine");
    expect(sleep!.outcome).toBe("sleep_total_min");
    expect(sleep!.nWith).toBe(29);
    expect(sleep!.nWithout).toBeGreaterThanOrEqual(60);
    expect(sleep!.diff).toBeLessThan(-30);
    expect(sleep!.diff).toBeGreaterThan(-50);
    expect(sleep!.ci[1]).toBeLessThan(0);
    expect(sleep!.ci[0]).toBeLessThan(sleep!.ci[1]);
    expect(sleep!.period.from).toBe(days[N - 90].day);
    expect(sleep!.period.to).toBe(days[N - 2].day);
    expect(sleep!.text).toMatch(
      /^On days with caffeine logged after 3 PM, your average sleep duration was \d+ minutes shorter than on comparable days without late caffeine \(n=29 vs \d+, 95% CI \d+ to \d+ minutes, last 90 days\)\. This is an association, not a cause\.$/,
    );
    // Morning caffeine days are in the comparison group, not the condition group.
    expect(sleep!.nWith + sleep!.nWithout).toBe(89);
  });

  it("emits one correlation finding per insight with the insight in evidence", () => {
    const { days, behaviors } = lateCaffeineFixture();
    const ctx = makeContext(days, {}, behaviors);
    const out = behaviorEngine(ctx);
    expect(out.every((f) => f.kind === "correlation" && f.engine === "behavior")).toBe(true);
    const f = out.find((x) => x.rule === RULES.caffeineLate && x.metric === "sleep_total_min")!;
    expect(f).toBeDefined();
    expect(f.method).toBe("welch");
    expect(f.severity).toBe("info");
    expect(f.explanation).toMatch(/association, not a cause/);
    expect(f.explanation).not.toMatch(/—/);
    const insight = f.evidence?.insight as { key: string; ci: [number, number] };
    expect(insight.key).toBe("caffeine_late:sleep_total_min");
    expect(f.evidence?.n).toBe(89);
    expect(f.evidence?.ci).toEqual(insight.ci);
    expect(f.value).toBeLessThan(f.baseline!);
    expect(out.map((x) => x.rule)).not.toContain(RULES.noLogs);
    expect(out.filter((x) => x.rule === RULES.caffeineLate && x.metric === "sleep_total_min").length).toBe(1);
  });

  it("stays silent when the CI includes zero and when a group is too small", () => {
    const days = makeDays(N, TODAY);
    const behaviors: BehaviorEntry[] = [];
    days.forEach((d, i) => {
      if (i % 3 === 0) behaviors.push(log(d.day, "caffeine", { at: `${d.day}T16:30:00-04:00` }));
    });
    const all = evaluateBehaviors(makeContext(days, {}, behaviors));
    expect(all.length).toBeGreaterThan(0);
    const sleep = all.find((c) => c.key === "caffeine_late:sleep_total_min")!;
    expect(sleep.significant).toBe(false);
    expect(sleep.text).toBe("");
    expect(behaviorInsights(makeContext(days, {}, behaviors)).find((i) => i.key === "caffeine_late:sleep_total_min")).toBeUndefined();

    const few = behaviors.slice(0, 4);
    expect(evaluateBehaviors(makeContext(days, {}, few)).length).toBe(0);
    expect(behaviorEngine(makeContext(days, {}, few)).length).toBe(0);
  });

  it("uses same-day strain and next-day recovery", () => {
    const days = makeDays(N, TODAY, (i, d) => {
      if (i % 2 === 0) d.day_strain = (d.day_strain ?? 10) + 5;
      if (i > 0 && (i - 1) % 2 === 0) d.recovery_score = (d.recovery_score ?? 65) - 20;
    });
    const behaviors = days.filter((_, i) => i % 2 === 0).map((d) => log(d.day, "exercise", { at: `${d.day}T19:30:00-04:00` }));
    const insights = behaviorInsights(makeContext(days, {}, behaviors));
    const strain = insights.find((i) => i.key === "exercise_late:day_strain")!;
    expect(strain).toBeDefined();
    expect(strain.diff).toBeGreaterThan(3);
    expect(strain.period.to).toBe(TODAY);
    expect(strain.text).toMatch(/higher than on comparable days without late exercise/);
    const recovery = insights.find((i) => i.key === "exercise_late:recovery_score")!;
    expect(recovery).toBeDefined();
    expect(recovery.diff).toBeLessThan(-10);
    expect(recovery.text).toMatch(/points lower/);
  });
});

describe("conditions and confounders", () => {
  it("builds the expected conditions, including per-name supplements and water fallback", () => {
    const b: BehaviorEntry[] = [
      log("2026-10-01", "caffeine", { at: "2026-10-01T15:05:00-04:00" }),
      log("2026-10-01", "caffeine", { at: "2026-10-01T14:59:00-04:00" }),
      log("2026-10-02", "alcohol", { amount: 1 }),
      log("2026-10-03", "alcohol", { amount: 2 }),
      log("2026-10-03", "meal", { at: "2026-10-03T21:15:00-04:00" }),
      log("2026-10-03", "exercise", { at: "2026-10-03T18:00:00-04:00" }),
      log("2026-10-04", "supplement", { note: "Magnesium" }),
      log("2026-10-05", "supplement", { note: "magnesium " }),
      log("2026-10-05", "supplement"),
      log("2026-10-06", "water", { amount: 1.5, unit: "l" }),
      log("2026-10-07", "water", { amount: 500, unit: "ml" }),
      log("2026-10-08", "medication", { note: "private" }),
      log("2026-10-09", "stress"),
    ];
    const conds = buildConditions(b, "America/Indiana/Indianapolis");
    const byKey = Object.fromEntries(conds.map((c) => [c.key, c]));
    expect([...byKey.caffeine_late.days]).toEqual(["2026-10-01"]);
    expect([...byKey.alcohol_any.days].sort()).toEqual(["2026-10-02", "2026-10-03"]);
    expect([...byKey.alcohol_heavy.days]).toEqual(["2026-10-03"]);
    expect([...byKey.meal_late.days]).toEqual(["2026-10-03"]);
    expect(byKey.exercise_late).toBeUndefined();
    expect([...byKey.supplement_magnesium.days].sort()).toEqual(["2026-10-04", "2026-10-05"]);
    expect([...byKey.supplement.days]).toEqual(["2026-10-05"]);
    expect([...byKey.water_above_median.days]).toEqual(["2026-10-06"]);
    expect([...byKey.stress.days]).toEqual(["2026-10-09"]);
    expect(conds.some((c) => c.kind === "medication")).toBe(false);
  });

  it("never words medication but counts it as a confounder", () => {
    const { days, behaviors } = lateCaffeineFixture();
    const caffeineDays = new Set(behaviors.filter((b) => (b.at ?? "").includes("16:30")).map((b) => b.day));
    const withMeds = behaviors.concat([...caffeineDays].map((d) => log(d, "medication", { note: "ibuprofen" })));
    const ctx = makeContext(days, {}, withMeds);
    const out = behaviorEngine(ctx);
    expect(out.some((f) => /ibuprofen/i.test(JSON.stringify(f)))).toBe(false);
    const f = out.find((x) => x.rule === RULES.caffeineLate && x.metric === "sleep_total_min")!;
    const insight = f.evidence?.insight as { confounders: string[] };
    expect(insight.confounders.some((c) => /^medication logged on 100%/.test(c))).toBe(true);
    expect(f.explanation).toMatch(/Possible confounders: medication logged on 100% of these days/);
  });

  it("flags weekend and workout imbalance as confounders", () => {
    const days: DailySummary[] = makeDays(N, TODAY, (i, d) => {
      const weekend = [0, 6].includes(new Date(Date.parse(`${d.day}T00:00:00Z`)).getUTCDay());
      d.workout_count = weekend ? 1 : 0;
      if (i > 0) {
        const prev = new Date(Date.parse(`${d.day}T00:00:00Z`) - 86_400_000).getUTCDay();
        if ([0, 6].includes(prev)) d.sleep_total_min = (d.sleep_total_min ?? 420) + 60;
      }
    });
    const behaviors = days.filter((d) => [0, 6].includes(new Date(Date.parse(`${d.day}T00:00:00Z`)).getUTCDay())).map((d) => log(d.day, "alcohol", { amount: 1 }));
    const sleep = behaviorInsights(makeContext(days, {}, behaviors)).find((i) => i.key === "alcohol_any:sleep_total_min")!;
    expect(sleep).toBeDefined();
    expect(sleep.confounders.some((c) => c.startsWith("weekend share"))).toBe(true);
    expect(sleep.confounders.some((c) => c.startsWith("workouts on"))).toBe(true);
  });
});
