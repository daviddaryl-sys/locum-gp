import { expect, it } from "vitest";

import { createMtdExportFiles } from "../exportMtdPackage";

it("creates deterministic accountant JSON and CSV without receipt or patient data", () => {
  const files = createMtdExportFiles({
    createdAt: "2026-08-04T12:00:00.000Z",
    period: { id: "quarter-2", label: "Quarter 2 · to 5 October 2026", start: "2026-04-06", end: "2026-10-05" },
    invoices: [
      { id: "invoice-1", status: "paid", paidAt: "2026-07-20", totalPence: 48_000, isDemo: false },
      { id: "invoice-demo", status: "paid", paidAt: "2026-07-21", totalPence: 99_000, isDemo: true },
    ],
    expenses: [{
      id: "expense-1",
      expenseDate: "2026-07-21",
      amountPence: 10_000,
      mtdCategory: "travel_costs",
      allowablePercentage: 75,
      reimbursedByPractice: false,
      needsAccountantReview: false,
      isDemo: false,
      supplierDescription: "Fictional parking",
      receiptObjectKey: "owner/expense/private.pdf",
      notes: "No patient information",
    }],
  });

  expect(files.fileStem).toBe("locum-manager-mtd-2026-04-06-to-2026-10-05");
  expect(JSON.parse(files.json)).toMatchObject({
    schemaVersion: 1,
    filingStatus: "not-submitted",
    totals: { turnoverPence: 48_000, allowableExpensesPence: 7_500, netPence: 40_500 },
    income: [{ recordId: "invoice-1", receivedDate: "2026-07-20", turnoverPence: 48_000 }],
    expenses: [{ recordId: "expense-1", category: "travel_costs", allowablePence: 7_500 }],
  });
  expect(files.csv).toContain("income,invoice-1,2026-07-20,turnover,48000,100,48000");
  expect(files.csv).toContain("expense,expense-1,2026-07-21,travel_costs,10000,75,7500");
  expect(`${files.json}${files.csv}`).not.toContain("private.pdf");
  expect(`${files.json}${files.csv}`).not.toContain("patient");
  expect(`${files.json}${files.csv}`).not.toContain("invoice-demo");
});

