import { describe, expect, it } from "vitest";

import {
  MTD_EXPENSE_CATEGORIES,
  buildMtdPeriods,
  buildMtdSummary,
  resolveMtdPeriod,
} from "../mtd";

describe("MTD category and period rules", () => {
  it("uses the 13 HMRC self-employment expense categories", () => {
    expect(MTD_EXPENSE_CATEGORIES.map(({ key }) => key)).toEqual([
      "cost_of_goods",
      "construction_subcontractors",
      "staff_costs",
      "travel_costs",
      "premises_costs",
      "repairs_maintenance",
      "office_costs",
      "advertising",
      "business_entertainment",
      "interest",
      "financial_charges",
      "professional_fees",
      "other_business_expenses",
    ]);
  });

  it("builds four cumulative periods for the standard 6 April tax year", () => {
    expect(buildMtdPeriods("2026-08-04")).toEqual([
      {
        id: "quarter-1",
        label: "Quarter 1 · to 5 July 2026",
        start: "2026-04-06",
        end: "2026-07-05",
      },
      {
        id: "quarter-2",
        label: "Quarter 2 · to 5 October 2026",
        start: "2026-04-06",
        end: "2026-10-05",
      },
      {
        id: "quarter-3",
        label: "Quarter 3 · to 5 January 2027",
        start: "2026-04-06",
        end: "2027-01-05",
      },
      {
        id: "quarter-4",
        label: "Quarter 4 · to 5 April 2027",
        start: "2026-04-06",
        end: "2027-04-05",
      },
    ]);
    expect(buildMtdPeriods("2027-04-05")[0].start).toBe("2026-04-06");
    expect(buildMtdPeriods("2027-04-06")[0].start).toBe("2027-04-06");
    expect(resolveMtdPeriod("unknown", "2026-08-04").id).toBe("quarter-2");
  });
});

describe("MTD cumulative summaries", () => {
  const period = {
    id: "quarter-2" as const,
    label: "Quarter 2",
    start: "2026-04-06",
    end: "2026-10-05",
  };

  it("counts paid income by payment date and groups allowable expenses", () => {
    const summary = buildMtdSummary({
      period,
      invoices: [
        { id: "paid", status: "paid", paidAt: "2026-07-20", totalPence: 100_000, isDemo: false },
        { id: "outside", status: "paid", paidAt: "2026-10-06", totalPence: 50_000, isDemo: false },
        { id: "sent", status: "sent", paidAt: null, totalPence: 40_000, isDemo: false },
        { id: "demo", status: "paid", paidAt: "2026-08-01", totalPence: 90_000, isDemo: true },
      ],
      expenses: [
        {
          id: "travel",
          expenseDate: "2026-07-21",
          amountPence: 10_001,
          mtdCategory: "travel_costs",
          allowablePercentage: 50,
          reimbursedByPractice: false,
          needsAccountantReview: false,
          isDemo: false,
        },
        {
          id: "professional",
          expenseDate: "2026-08-01",
          amountPence: 20_000,
          mtdCategory: "professional_fees",
          allowablePercentage: 100,
          reimbursedByPractice: false,
          needsAccountantReview: false,
          isDemo: false,
        },
        {
          id: "reimbursed",
          expenseDate: "2026-08-02",
          amountPence: 30_000,
          mtdCategory: "travel_costs",
          allowablePercentage: 100,
          reimbursedByPractice: true,
          needsAccountantReview: false,
          isDemo: false,
        },
      ],
    });

    expect(summary).toMatchObject({
      incomePence: 100_000,
      incomeCount: 1,
      allowableExpensesPence: 25_001,
      expenseCount: 2,
      netPence: 74_999,
      status: "ready",
    });
    expect(summary.expensesByCategory).toEqual([
      { category: "travel_costs", totalPence: 5_001 },
      { category: "professional_fees", totalPence: 20_000 },
    ]);
  });

  it("flags incomplete paid income and accountant-review expenses", () => {
    const summary = buildMtdSummary({
      period,
      invoices: [
        { id: "missing-date", status: "paid", paidAt: null, totalPence: 100_000, isDemo: false },
      ],
      expenses: [
        {
          id: "review",
          expenseDate: "2026-08-01",
          amountPence: 2_000,
          mtdCategory: "other_business_expenses",
          allowablePercentage: 100,
          reimbursedByPractice: false,
          needsAccountantReview: true,
          isDemo: false,
        },
        {
          id: "invalid",
          expenseDate: "2026-08-02",
          amountPence: 3_000,
          mtdCategory: null,
          allowablePercentage: null,
          reimbursedByPractice: false,
          needsAccountantReview: false,
          isDemo: false,
        },
      ],
    });

    expect(summary.status).toBe("needs-review");
    expect(summary.incomePence).toBe(0);
    expect(summary.issues).toEqual([
      { recordType: "invoice", recordId: "missing-date", message: "Add the payment-received date." },
      { recordType: "expense", recordId: "review", message: "Review this expense with your accountant." },
      { recordType: "expense", recordId: "invalid", message: "Choose an HMRC category and allowable percentage." },
    ]);
  });
});
