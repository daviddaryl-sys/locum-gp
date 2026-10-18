import { describe, expect, it } from "vitest";

import { parseReceiptSuggestions } from "../receiptSuggestions";

describe("receipt logo suggestions", () => {
  it("does not present fragmented logo text as a trusted supplier name", () => {
    const result = parseReceiptSuggestions(
      "RR Ba Be ORE Tre i\n10/08/2026\nTotal £49.99",
      "gp",
    );

    expect(result.supplier).toBeNull();
    expect(result.expenseDate).toEqual({
      value: "2026-08-10",
      confidence: "high",
    });
    expect(result.amountPence).toEqual({ value: 4999, confidence: "high" });
  });
});
