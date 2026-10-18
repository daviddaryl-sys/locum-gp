import { describe, expect, it } from "vitest";
import {
  buildTaxYearPeriods,
  isExpenseDate,
  isPredefinedExpenseCategoryKey,
  parseExpenseData,
  resolveExpensePeriod,
  summarizeExpenses,
  validateReceiptFile,
} from "../expense";

function validExpense(overrides: Record<string, unknown> = {}) {
  return {
    expenseDate: "2026-05-01",
    amountPence: 1200,
    categoryKey: "home_office",
    customCategoryId: null,
    mtdCategory: "premises_costs",
    allowablePercentage: 80,
    practiceId: null,
    supplierDescription: "Example supplier",
    notes: null,
    reimbursedByPractice: false,
    needsAccountantReview: false,
    receiptObjectKey: null,
    receiptOriginalName: null,
    receiptMimeType: null,
    receiptSizeBytes: null,
    receiptSyncStatus: "none",
    isDemo: false,
    ...overrides,
  };
}

describe("structured mileage expenses", () => {
  it("defaults legacy expense records to a standard expense", () => {
    expect(parseExpenseData(validExpense())).toMatchObject({
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
    });
  });

  it("accepts complete mileage details and an optional UUID session link", () => {
    expect(
      parseExpenseData(
        validExpense({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          distanceMiles: 12.5,
          mileageRatePence: 55,
          linkedSessionId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    ).toMatchObject({
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 12.5,
      mileageRatePence: 55,
      linkedSessionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("accepts PostgreSQL mileage boundaries", () => {
    expect(
      parseExpenseData(
        validExpense({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          distanceMiles: 999999.99,
          mileageRatePence: 2147483647,
          linkedSessionId: null,
        }),
      ),
    ).toMatchObject({
      distanceMiles: 999999.99,
      mileageRatePence: 2147483647,
    });
  });

  it("accepts a two-decimal distance with normal floating-point noise", () => {
    expect(
      parseExpenseData(
        validExpense({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          distanceMiles: 0.1 + 0.2,
          mileageRatePence: 55,
          linkedSessionId: null,
        }),
      ),
    ).toMatchObject({ distanceMiles: 0.3 });
  });

  it.each([
    { distanceMiles: 12.345, mileageRatePence: 55 },
    { distanceMiles: 1_000_000, mileageRatePence: 55 },
    { distanceMiles: 12.5, mileageRatePence: 2_147_483_648 },
  ])("rejects mileage values PostgreSQL cannot represent", (limits) => {
    expect(
      parseExpenseData(
        validExpense({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          linkedSessionId: null,
          ...limits,
        }),
      ),
    ).toBeNull();
  });

  it.each([
    { expenseKind: null },
    { expenseKind: "standard", journeyOrigin: "Example Surgery" },
    {
      expenseKind: "mileage",
      journeyOrigin: " ",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 12.5,
      mileageRatePence: 55,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: " ",
      distanceMiles: 12.5,
      mileageRatePence: 55,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 0,
      mileageRatePence: 55,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: Number.POSITIVE_INFINITY,
      mileageRatePence: 55,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 12.5,
      mileageRatePence: 0,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 12.5,
      mileageRatePence: 55.5,
      linkedSessionId: null,
    },
    {
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 12.5,
      mileageRatePence: 55,
      linkedSessionId: "not-a-uuid",
    },
  ])("rejects inconsistent mileage details", (mileage) => {
    expect(parseExpenseData(validExpense(mileage))).toBeNull();
  });
});

it("recognises stable stored expense category keys", () => {
  expect(isPredefinedExpenseCategoryKey("professional_memberships")).toBe(true);
  expect(isPredefinedExpenseCategoryKey("stationery_office_supplies")).toBe(true);
  expect(isPredefinedExpenseCategoryKey("pharmacist_memberships")).toBe(false);
  expect(isPredefinedExpenseCategoryKey(null)).toBe(false);
});

describe("UK expense periods", () => {
  it("places 5 April in the ending year and 6 April in the new year", () => {
    expect(resolveExpensePeriod("tax-year", "2027-04-05")).toEqual({
      id: "tax-year",
      label: "Entire tax year",
      start: "2026-04-06",
      end: "2027-04-05",
    });
    expect(resolveExpensePeriod("tax-year", "2027-04-06")).toEqual({
      id: "tax-year",
      label: "Entire tax year",
      start: "2027-04-06",
      end: "2028-04-05",
    });
  });

  it("returns the whole year plus 13 chronological fragments", () => {
    const periods = buildTaxYearPeriods("2026-08-02");
    expect(periods).toHaveLength(14);
    expect(periods[1]).toMatchObject({
      id: "opening-april",
      start: "2026-04-06",
      end: "2026-04-30",
    });
    expect(periods.at(-1)).toMatchObject({
      id: "closing-april",
      start: "2027-04-01",
      end: "2027-04-05",
    });
  });

  it("falls back to the entire tax year for an unsupported period", () => {
    expect(resolveExpensePeriod("not-a-period", "2026-08-02").id).toBe(
      "tax-year",
    );
  });
});

it("excludes reimbursed rows from net while keeping a reimbursed subtotal", () => {
  const period = resolveExpensePeriod("tax-year", "2026-08-02");
  const summary = summarizeExpenses(
    [
      {
        expenseDate: "2026-05-01",
        amountPence: 1200,
        reimbursedByPractice: false,
      },
      {
        expenseDate: "2026-05-02",
        amountPence: 800,
        reimbursedByPractice: true,
      },
    ],
    period,
  );
  expect(summary).toEqual({ count: 2, netPence: 1200, reimbursedPence: 800 });
});

it("rejects files outside the exact type and 10 MiB boundary", () => {
  expect(
    validateReceiptFile({
      name: "receipt.pdf",
      type: "application/pdf",
      size: 0,
    }),
  ).toBe("Receipt must not be empty.");
  expect(
    validateReceiptFile({
      name: "receipt.pdf",
      type: "application/pdf",
      size: 10485760,
    }),
  ).toBeNull();
  expect(
    validateReceiptFile({
      name: "receipt.pdf",
      type: "application/pdf",
      size: 10485761,
    }),
  ).toBe("Receipt must be 10 MB or smaller.");
  expect(
    validateReceiptFile({
      name: "receipt.exe",
      type: "application/octet-stream",
      size: 10,
    }),
  ).toBe("Choose a JPG, PNG, HEIC, or PDF receipt.");
});

it("rejects non-finite and unsafe expense amounts at the domain boundary", () => {
  const expense = {
    expenseDate: "2026-05-01",
    amountPence: 1200,
    categoryKey: "home_office",
    mtdCategory: "premises_costs",
    allowablePercentage: 80,
    customCategoryId: null,
    practiceId: null,
    supplierDescription: "Desk",
    notes: null,
    reimbursedByPractice: false,
    needsAccountantReview: false,
    receiptObjectKey: null,
    receiptOriginalName: null,
    receiptMimeType: null,
    receiptSizeBytes: null,
    receiptSyncStatus: "none",
    isDemo: false,
  };
  expect(parseExpenseData({ ...expense, amountPence: Number.POSITIVE_INFINITY })).toBeNull();
  expect(parseExpenseData({ ...expense, amountPence: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
});

it("parses exact MTD fields and rejects unsupported tax values", () => {
  const expense = {
    expenseDate: "2026-05-01",
    amountPence: 1200,
    categoryKey: "home_office",
    customCategoryId: null,
    mtdCategory: "premises_costs",
    allowablePercentage: 80,
    practiceId: null,
    supplierDescription: "Desk",
    notes: null,
    reimbursedByPractice: false,
    needsAccountantReview: false,
    receiptObjectKey: null,
    receiptOriginalName: null,
    receiptMimeType: null,
    receiptSizeBytes: null,
    receiptSyncStatus: "none",
    isDemo: false,
  };

  expect(parseExpenseData(expense)).toMatchObject({
    mtdCategory: "premises_costs",
    allowablePercentage: 80,
  });
  expect(parseExpenseData({ ...expense, mtdCategory: "made-up" })).toBeNull();
  expect(parseExpenseData({ ...expense, allowablePercentage: 101 })).toBeNull();
  expect(parseExpenseData({ ...expense, allowablePercentage: 1.5 })).toBeNull();
});

it("requires exactly one category source", () => {
  expect(
    parseExpenseData({
      expenseDate: "2026-05-01",
      amountPence: 1200,
      categoryKey: "home_office",
      customCategoryId: "category-id",
      practiceId: null,
      supplierDescription: "Desk",
      notes: null,
      reimbursedByPractice: false,
      needsAccountantReview: false,
      receiptObjectKey: null,
      receiptOriginalName: null,
      receiptMimeType: null,
      receiptSizeBytes: null,
      receiptSyncStatus: "none",
      isDemo: false,
    }),
  ).toBeNull();
});

it("validates real calendar dates while retaining date strings for repair", () => {
  expect(isExpenseDate("2028-02-29")).toBe(true);
  expect(isExpenseDate("2027-02-29")).toBe(false);
});
