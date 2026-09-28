import { describe, expect, it } from "vitest";
import { averageCashFlow, displayName, mapAccountType, mapBalance, mapTransaction, matchBudgetCategory, summarizeCashFlow } from "../mapping";

describe("plaid mapping", () => {
  it("maps Plaid types and subtypes onto app account types", () => {
    expect(mapAccountType("depository", "checking")).toBe("checking");
    expect(mapAccountType("depository", "savings")).toBe("savings");
    expect(mapAccountType("depository", "money market")).toBe("savings");
    expect(mapAccountType("credit", "credit card")).toBe("credit_card");
    expect(mapAccountType("loan", "student")).toBe("student_loan");
    expect(mapAccountType("loan", "auto")).toBe("auto_loan");
    expect(mapAccountType("loan", "mortgage")).toBe("other_loan");
    expect(mapAccountType("investment", "401k")).toBe("retirement");
    expect(mapAccountType("investment", "roth")).toBe("retirement");
    expect(mapAccountType("investment", "brokerage")).toBe("brokerage");
    expect(mapAccountType("other", null)).toBe("other_asset");
  });
  it("keeps liabilities positive and uses current before available", () => {
    expect(mapBalance("credit", { current: 410.25, available: 4589.75 })).toBe(410.25);
    expect(mapBalance("depository", { current: 1200, available: 1100 })).toBe(1200);
    expect(mapBalance("depository", { current: null, available: 900 })).toBe(900);
  });
  it("builds a readable name with institution and mask", () => {
    expect(displayName({ name: "Plaid Checking", official_name: null, mask: "0000" }, "Chase")).toBe("Chase Plaid Checking ••0000");
    expect(displayName({ name: "Chase Sapphire", official_name: null, mask: null }, "Chase")).toBe("Chase Sapphire");
  });
  it("flips amount sign and classifies transaction types", () => {
    expect(mapTransaction({ amount: 54.1, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }, "checking")).toEqual({ amount: -54.1, transaction_type: "expense" });
    expect(mapTransaction({ amount: -2500, personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" } }, "checking")).toEqual({ amount: 2500, transaction_type: "income" });
    expect(mapTransaction({ amount: 300, personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" } }, "checking")).toEqual({ amount: -300, transaction_type: "payment" });
    expect(mapTransaction({ amount: -300, personal_finance_category: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" } }, "brokerage")).toEqual({ amount: 300, transaction_type: "contribution" });
    expect(mapTransaction({ amount: -120, personal_finance_category: null }, "credit_card")).toEqual({ amount: 120, transaction_type: "payment" });
  });
  it("matches the most specific budget mapping", () => {
    const cats = [
      { id: "utilities", plaid_categories: ["RENT_AND_UTILITIES"] },
      { id: "housing", plaid_categories: ["RENT_AND_UTILITIES_RENT"] },
      { id: "food", plaid_categories: ["FOOD_AND_DRINK_GROCERIES"] },
      { id: "restaurants", plaid_categories: ["FOOD_AND_DRINK"] },
    ];
    expect(matchBudgetCategory(cats, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")).toBe("housing");
    expect(matchBudgetCategory(cats, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")).toBe("utilities");
    expect(matchBudgetCategory(cats, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT")).toBe("restaurants");
    expect(matchBudgetCategory(cats, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")).toBe("food");
    expect(matchBudgetCategory(cats, "TRAVEL", "TRAVEL_FLIGHTS")).toBeNull();
  });
  it("summarizes monthly income and spending, ignoring transfers, loan payments and pending rows", () => {
    const rows = [
      { transaction_date: "2026-08-01", amount: 3000, transaction_type: "income" as const, category_primary: "INCOME", pending: false },
      { transaction_date: "2026-08-03", amount: -1200, transaction_type: "expense" as const, category_primary: "RENT_AND_UTILITIES", pending: false },
      { transaction_date: "2026-08-10", amount: -400, transaction_type: "expense" as const, category_primary: "FOOD_AND_DRINK", pending: false },
      { transaction_date: "2026-08-12", amount: -250, transaction_type: "payment" as const, category_primary: "LOAN_PAYMENTS", pending: false },
      { transaction_date: "2026-08-15", amount: -500, transaction_type: "transfer" as const, category_primary: "TRANSFER_OUT", pending: false },
      { transaction_date: "2026-08-20", amount: -99, transaction_type: "expense" as const, category_primary: "ENTERTAINMENT", pending: true },
      { transaction_date: "2026-09-01", amount: 3000, transaction_type: "income" as const, category_primary: "INCOME", pending: false },
      { transaction_date: "2026-09-05", amount: -1200, transaction_type: "expense" as const, category_primary: "RENT_AND_UTILITIES", pending: false },
    ];
    const months = summarizeCashFlow(rows);
    expect(months.map((m) => m.month)).toEqual(["2026-08-01", "2026-09-01"]);
    expect(months[0]).toMatchObject({ income: 3000, spending: 1600, fixed: 1200, variable: 400, loanPayments: 250, transfersOut: 500 });
    expect(months[1]).toMatchObject({ income: 3000, spending: 1200, fixed: 1200, variable: 0 });
    expect(averageCashFlow(months)).toEqual({ income: 3000, fixed: 1200, variable: 200, spending: 1400, months: 2 });
  });
});
