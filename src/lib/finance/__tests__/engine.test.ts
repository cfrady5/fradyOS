import { describe, it, expect } from "vitest";
import {
  runProjection,
  compareDebtStrategies,
  suggestAllocation,
  runScenario,
  monthIndexOf,
  requiredContribution,
  monthsToPayoff,
  type ModelInputs,
  type ModelAccount,
  type ModelGoal,
} from "../engine";

const TODAY = "2026-09-28";

function acc(partial: Partial<ModelAccount> & Pick<ModelAccount, "id" | "type" | "balance">): ModelAccount {
  return { name: partial.id, rate: null, minimumPayment: null, actualPayment: 0, contribution: 0, includeInNetWorth: true, customOrder: 0, ...partial };
}
function goal(partial: Partial<ModelGoal> & Pick<ModelGoal, "id" | "category" | "targetAmount">): ModelGoal {
  return { name: partial.id, currentAmount: 0, linkedAccountId: null, targetDate: null, priority: 0, monthlyContribution: 0, status: "active", ...partial };
}
function inputs(over: Partial<ModelInputs> = {}): ModelInputs {
  return {
    today: TODAY,
    months: 120,
    profile: { monthlyIncome: 5000, incomeGrowthPct: 0, fixedExpenses: 2000, variableExpenses: 1000, investmentReturnPct: 0, savingsApyPct: 0, emergencyFundMonths: 6, surplusDestination: "checking", debtStrategy: "avalanche", extraDebtPayment: 0 },
    accounts: [acc({ id: "chk", type: "checking", balance: 1000 })],
    goals: [],
    changes: [],
    ...over,
  };
}

describe("runProjection basics", () => {
  it("accumulates surplus into the destination account with no growth", () => {
    const p = runProjection(inputs({ months: 12 }));
    expect(p.points).toHaveLength(13);
    expect(p.start.netWorth).toBe(1000);
    // 5000 - 3000 = 2000/month × 12
    expect(p.end.netWorth).toBe(25000);
    expect(p.cashFlow.free).toBe(2000);
    expect(p.cashFlow.unallocated).toBe(2000);
    expect(p.cashFlow.savingsRatePct).toBe(40);
  });

  it("applies yearly income growth from month 13", () => {
    const p = runProjection(inputs({ months: 24, profile: { ...inputs().profile, incomeGrowthPct: 10 } }));
    expect(p.points[12].income).toBe(5000);
    expect(p.points[13].income).toBe(5500);
  });

  it("grows investments at the profile return and savings at the APY", () => {
    const p = runProjection(
      inputs({
        months: 12,
        profile: { ...inputs().profile, investmentReturnPct: 12, savingsApyPct: 6, monthlyIncome: 3000 },
        accounts: [acc({ id: "chk", type: "checking", balance: 0 }), acc({ id: "sav", type: "savings", balance: 1200 }), acc({ id: "brk", type: "brokerage", balance: 1000 })],
      }),
    );
    // 1% per month on brokerage → 1000 × 1.01^12
    expect(p.end.investments).toBeCloseTo(1000 * Math.pow(1.01, 12), 0);
    expect(p.end.savings).toBeCloseTo(1200 * Math.pow(1.005, 12), 0);
  });

  it("flags shortfall months when expenses exceed income", () => {
    const p = runProjection(inputs({ months: 3, profile: { ...inputs().profile, monthlyIncome: 2000 } }));
    // 1000 start − 1000/month: month 1 → 0, month 2 → −1000
    expect(p.firstShortfallMonth).toBe(2);
    expect(p.shortfallMonths).toEqual([2, 3]);
  });

  it("creates a synthetic cash account when there is no checking account", () => {
    const p = runProjection(inputs({ months: 1, accounts: [] }));
    expect(p.end.checking).toBe(2000);
    expect(p.end.netWorth).toBe(2000);
  });
});

describe("debts", () => {
  const card = acc({ id: "card", type: "credit_card", balance: 3000, rate: 24, minimumPayment: 100 });
  const loan = acc({ id: "loan", type: "student_loan", balance: 10000, rate: 5, minimumPayment: 150 });

  it("accrues interest and pays minimums; avalanche extra goes to the highest APR first", () => {
    const p = runProjection(inputs({ months: 1, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), card, loan], profile: { ...inputs().profile, extraDebtPayment: 500 } }));
    const c = p.debts.find((d) => d.accountId === "card")!;
    const l = p.debts.find((d) => d.accountId === "loan")!;
    // card: 3000 + 60 interest − 100 min − 500 extra = 2460
    expect(c.endBalance).toBeCloseTo(2460, 2);
    expect(c.totalInterest).toBeCloseTo(60, 2);
    // loan: 10000 + 41.67 − 150
    expect(l.endBalance).toBeCloseTo(9891.67, 2);
    expect(p.cashFlow.debtPayments).toBe(250);
    expect(p.cashFlow.extraDebt).toBe(500);
    expect(p.end.debt).toBeCloseTo(2460 + 9891.67, 1);
  });

  it("snowball targets the smallest balance and rolls freed payments forward", () => {
    const p = runProjection(inputs({ months: 120, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), card, loan], profile: { ...inputs().profile, debtStrategy: "snowball", extraDebtPayment: 300 } }));
    const c = p.debts.find((d) => d.accountId === "card")!;
    const l = p.debts.find((d) => d.accountId === "loan")!;
    expect(c.payoffMonth).not.toBeNull();
    expect(l.payoffMonth).not.toBeNull();
    expect(c.payoffMonth!).toBeLessThan(l.payoffMonth!);
    expect(p.debtFreeMonth).toBe(l.payoffMonth);
    expect(p.debtFreeDate).toBe(l.payoffDate);
    // After the card is gone, its $100 minimum plus the $300 extra all hit the loan.
    const after = p.points[c.payoffMonth! + 1];
    expect(after.debtPayments).toBeCloseTo(550, 0);
  });

  it("minimum-only strategy never rolls freed payments", () => {
    const p = runProjection(inputs({ months: 120, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), card, loan], profile: { ...inputs().profile, debtStrategy: "minimum" } }));
    const c = p.debts.find((d) => d.accountId === "card")!;
    const after = p.points[c.payoffMonth! + 1];
    expect(after.debtPayments).toBeCloseTo(150, 0);
  });

  it("compareDebtStrategies shows avalanche saving interest vs minimum", () => {
    const cmp = compareDebtStrategies(inputs({ accounts: [acc({ id: "chk", type: "checking", balance: 0 }), card, loan] }), 400);
    const min = cmp.find((c) => c.strategy === "minimum")!;
    const av = cmp.find((c) => c.strategy === "avalanche")!;
    const sn = cmp.find((c) => c.strategy === "snowball")!;
    expect(min.interestSavedVsMinimum).toBe(0);
    expect(av.totalInterest).toBeLessThan(min.totalInterest);
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
    expect(av.debtFreeMonth!).toBeLessThan(min.debtFreeMonth!);
    expect(av.monthsSavedVsMinimum).toBe(min.debtFreeMonth! - av.debtFreeMonth!);
  });

  it("uses a 2% / $25 default minimum for credit cards without one", () => {
    const p = runProjection(inputs({ months: 1, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), acc({ id: "cc", type: "credit_card", balance: 500, rate: 0 })] }));
    expect(p.cashFlow.debtPayments).toBe(25);
  });

  it("payoff_now change clears a debt from savings then checking", () => {
    const p = runProjection(
      inputs({
        months: 2,
        accounts: [acc({ id: "chk", type: "checking", balance: 500 }), acc({ id: "sav", type: "savings", balance: 2000 }), acc({ id: "card", type: "credit_card", balance: 2500, rate: 0, minimumPayment: 50 })],
        changes: [{ kind: "payoff_now", label: "Pay off card", accountId: "card", month: 1 }],
      }),
    );
    expect(p.points[1].debt).toBe(0);
    expect(p.points[1].savings).toBe(0);
    // 500 + 2000 surplus − 50 min − 450 remainder of payoff
    expect(p.points[1].checking).toBe(2000);
    expect(p.debts[0].payoffMonth).toBe(1);
  });
});

describe("goals", () => {
  it("projects completion for an unlinked savings goal and rates it against the target date", () => {
    const g = goal({ id: "trip", category: "travel", targetAmount: 3000, currentAmount: 600, monthlyContribution: 400, targetDate: "2027-05-15" });
    const p = runProjection(inputs({ months: 24, goals: [g] }));
    const r = p.goals[0];
    // needs 2400 more at 400/mo → month 6
    expect(r.projectedMonth).toBe(6);
    expect(r.targetMonth).toBe(monthIndexOf(TODAY, "2027-05-15"));
    expect(r.status).toBe("on_track");
    expect(r.requiredMonthly).toBeCloseTo(2400 / r.targetMonth!, 2);
    // Earmarked goal cash counts toward net worth and is not spent twice.
    expect(p.points[1].earmarked).toBe(1000);
    expect(p.points[1].surplus).toBe(1600);
    expect(p.points[1].netWorth).toBe(1000 + 1000 + 1600);
  });

  it("marks goals ahead / slightly behind / significantly behind by month difference", () => {
    const base = inputs({ months: 60 });
    const ahead = runProjection({ ...base, goals: [goal({ id: "a", category: "savings", targetAmount: 1200, monthlyContribution: 400, targetDate: "2027-09-28" })] }).goals[0];
    expect(ahead.projectedMonth).toBe(3);
    expect(ahead.status).toBe("ahead");
    const slightly = runProjection({ ...base, goals: [goal({ id: "b", category: "savings", targetAmount: 1200, monthlyContribution: 100, targetDate: "2027-07-28" })] }).goals[0];
    expect(slightly.projectedMonth).toBe(12);
    expect(slightly.monthsDiff).toBe(2);
    expect(slightly.status).toBe("slightly_behind");
    const way = runProjection({ ...base, goals: [goal({ id: "c", category: "savings", targetAmount: 12000, monthlyContribution: 100, targetDate: "2027-03-28" })] }).goals[0];
    expect(way.status).toBe("significantly_behind");
    const never = runProjection({ ...base, goals: [goal({ id: "d", category: "savings", targetAmount: 12000, monthlyContribution: 0, targetDate: "2027-03-28" })] }).goals[0];
    expect(never.projectedMonth).toBeNull();
    expect(never.status).toBe("significantly_behind");
    const stalled = runProjection({ ...base, goals: [goal({ id: "e", category: "savings", targetAmount: 12000 })] }).goals[0];
    expect(stalled.status).toBe("stalled");
    const done = runProjection({ ...base, goals: [goal({ id: "f", category: "savings", targetAmount: 100, currentAmount: 100 })] }).goals[0];
    expect(done.status).toBe("completed");
  });

  it("tracks a linked savings account and a linked debt payoff", () => {
    const sav = acc({ id: "sav", type: "savings", balance: 4000, contribution: 500 });
    const loan = acc({ id: "loan", type: "auto_loan", balance: 6000, rate: 0, minimumPayment: 500 });
    const p = runProjection(
      inputs({
        months: 36,
        accounts: [acc({ id: "chk", type: "checking", balance: 0 }), sav, loan],
        goals: [goal({ id: "ef", category: "emergency_fund", targetAmount: 6000, linkedAccountId: "sav" }), goal({ id: "car", category: "debt_payoff", targetAmount: 0, linkedAccountId: "loan", monthlyContribution: 500 })],
      }),
    );
    const ef = p.goals.find((g) => g.id === "ef")!;
    expect(ef.startAmount).toBe(4000);
    expect(ef.projectedMonth).toBe(4);
    const car = p.goals.find((g) => g.id === "car")!;
    expect(car.targetAmount).toBe(6000);
    // 500 minimum + 500 goal contribution = 1000/mo → 6 months
    expect(car.projectedMonth).toBe(6);
    expect(p.debtFreeMonth).toBe(6);
  });

  it("defaults the emergency fund target from expenses × months", () => {
    const p = runProjection(inputs({ months: 1, goals: [goal({ id: "ef", category: "emergency_fund", targetAmount: 0 })] }));
    expect(p.emergencyFundTarget).toBe(18000);
    expect(p.goals[0].targetAmount).toBe(18000);
  });

  it("suggestAllocation funds goals in priority order and splits leftovers across undated goals", () => {
    const g1 = goal({ id: "g1", category: "home", targetAmount: 12000, targetDate: "2027-09-28", priority: 0 });
    const g2 = goal({ id: "g2", category: "vehicle", targetAmount: 6000, targetDate: "2027-09-28", priority: 1 });
    const g3 = goal({ id: "g3", category: "travel", targetAmount: 5000, priority: 2 });
    const lines = suggestAllocation(inputs({ goals: [g1, g2, g3] }), 1500);
    expect(lines.map((l) => l.goalId)).toEqual(["g1", "g2", "g3"]);
    expect(lines[0].suggestedMonthly).toBe(1000);
    expect(lines[0].fullyFunded).toBe(true);
    expect(lines[1].suggestedMonthly).toBe(500);
    expect(lines[1].requiredMonthly).toBe(500);
    expect(lines[2].suggestedMonthly).toBe(0);
    // Reordering priorities changes who gets funded first.
    const flipped = suggestAllocation(inputs({ goals: [{ ...g1, priority: 2 }, { ...g2, priority: 0 }, { ...g3, priority: 1 }] }), 1200);
    expect(flipped[0].goalId).toBe("g2");
    expect(flipped[0].suggestedMonthly).toBe(500);
    expect(flipped[1].goalId).toBe("g3");
    expect(flipped[2].goalId).toBe("g1");
    expect(flipped[2].suggestedMonthly).toBe(700);
    expect(flipped[2].fullyFunded).toBe(false);
  });
});

describe("scenarios", () => {
  it("income and expense changes shift the projection relative to the baseline", () => {
    const base = inputs({ months: 24 });
    const baseline = runScenario(base, "Baseline", []);
    const raise = runScenario(base, "Raise", [{ kind: "income", label: "Raise", amountMonthly: 1000, startMonth: 1 }]);
    const rent = runScenario(base, "Rent", [{ kind: "expense", label: "Rent", amountMonthly: 800, startMonth: 7, endMonth: 12 }]);
    expect(raise.netWorth1y - baseline.netWorth1y).toBe(12000);
    expect(rent.netWorth1y - baseline.netWorth1y).toBe(-4800);
    expect(rent.projection.points[13].expenses).toBe(3000);
  });

  it("one-time windfalls and purchases hit the right account in the right month", () => {
    const base = inputs({ months: 6, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), acc({ id: "brk", type: "brokerage", balance: 0 })] });
    const s = runScenario(base, "Bonus", [
      { kind: "one_time", label: "Bonus", amount: 5000, month: 2, fromAccountId: "brk" },
      { kind: "one_time", label: "Laptop", amount: -2000, month: 3 },
    ]);
    expect(s.projection.points[1].investments).toBe(0);
    expect(s.projection.points[2].investments).toBe(5000);
    expect(s.projection.points[3].checking).toBe(2000 * 3 - 2000);
  });

  it("return_rate and contribution changes apply to investments", () => {
    const base = inputs({ months: 12, accounts: [acc({ id: "chk", type: "checking", balance: 0 }), acc({ id: "brk", type: "brokerage", balance: 10000 })] });
    const s = runScenario(base, "Invest", [
      { kind: "return_rate", label: "8%", investmentReturnPct: 12 },
      { kind: "contribution", label: "Add", accountId: "brk", amountMonthly: 500, startMonth: 1 },
    ]);
    expect(s.projection.points[1].investments).toBeCloseTo(10500 * 1.01, 2);
    expect(s.projection.points[1].surplus).toBe(1500);
  });
});

describe("helpers", () => {
  it("monthIndexOf is day-of-month aware", () => {
    expect(monthIndexOf("2026-09-28", "2027-09-28")).toBe(12);
    expect(monthIndexOf("2026-09-28", "2027-09-15")).toBe(11);
    expect(monthIndexOf("2026-09-28", "2026-08-01")).toBe(-2);
  });
  it("requiredContribution and monthsToPayoff agree with closed-form math", () => {
    expect(requiredContribution(0, 1200, 12, 0)).toBe(100);
    expect(requiredContribution(1200, 1200, 12, 0)).toBe(0);
    expect(requiredContribution(0, 12000, 120, 6)).toBeCloseTo(73.22, 1);
    expect(monthsToPayoff(1000, 0, 100)).toBe(10);
    expect(monthsToPayoff(1000, 24, 10)).toBeNull();
    expect(monthsToPayoff(3000, 24, 200)).toBe(19);
  });
});
