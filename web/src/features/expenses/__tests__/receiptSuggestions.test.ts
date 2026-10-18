import { describe, expect, it } from "vitest";

import { parseReceiptSuggestions } from "../receiptSuggestions";

const FICTIONAL_RECEIPT = `
Fictional Medical Supplies
Receipt number FMS-1042
Date 08/08/2026
Clinical stationery £35.82
VAT £7.17
Total £42.99
`;

describe("receipt suggestion parser", () => {
  it("extracts a supplier, UK date and decimal total with independent confidence", () => {
    expect(parseReceiptSuggestions(FICTIONAL_RECEIPT, "gp")).toMatchObject({
      supplier: { value: "Fictional Medical Supplies", confidence: "high" },
      expenseDate: { value: "2026-08-08", confidence: "high" },
      amountPence: { value: 4299, confidence: "high" },
      category: {
        value: "stationery_office_supplies",
        label: "Stationery and office supplies",
        confidence: "high",
      },
    });
  });

  it("prefers the final Total over competing subtotal and VAT values", () => {
    const result = parseReceiptSuggestions(
      `Example Training Ltd\nSubtotal 80.00\nVAT 16.00\nTOTAL GBP 96.00`,
      "gp",
    );

    expect(result.amountPence).toEqual({ value: 9600, confidence: "high" });
  });

  it("uses the profession-aware category catalog", () => {
    const gp = parseReceiptSuggestions(
      "Fictional Membership Body\nGMC annual membership\nTotal £450.00",
      "gp",
    );
    const pharmacist = parseReceiptSuggestions(
      "Example Pharmacy Association\nGPhC annual membership\nTotal £275.00",
      "pharmacist",
    );

    expect(gp.category).toMatchObject({
      value: "professional_memberships",
      label: "GMC, BMA, RCGP, and other professional memberships",
      confidence: "high",
    });
    expect(pharmacist.category).toMatchObject({
      value: "professional_memberships",
      label: "GPhC, PDA, and other professional memberships",
      confidence: "high",
    });
  });

  it("does not infer a pharmacist category from GP-only wording", () => {
    expect(
      parseReceiptSuggestions(
        "Fictional Membership Body\nGMC annual membership\nTotal £450.00",
        "pharmacist",
      ).category,
    ).toBeNull();
  });

  it("returns lower-confidence unlabeled amounts independently of other fields", () => {
    const result = parseReceiptSuggestions(
      "Example Parking Services\n08-08-2026\n12.50",
      "gp",
    );

    expect(result.supplier?.confidence).toBe("high");
    expect(result.expenseDate?.confidence).toBe("high");
    expect(result.amountPence).toEqual({ value: 1250, confidence: "medium" });
    expect(result.category).toBeNull();
  });

  it("returns only empty structured suggestions for empty or malformed text", () => {
    const empty = parseReceiptSuggestions("", "gp");
    const malformed = parseReceiptSuggestions("\u0000\u0001 !!!\nnot a receipt", "gp");

    expect(empty).toEqual({
      supplier: null,
      expenseDate: null,
      amountPence: null,
      category: null,
    });
    expect(malformed).toEqual({
      supplier: null,
      expenseDate: null,
      amountPence: null,
      category: null,
    });
    expect(JSON.stringify({ empty, malformed })).not.toContain("not a receipt");
  });
});
