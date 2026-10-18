import { describe, expect, it } from "vitest";

import { calculateLineTotal, formatGBP, sumPence } from "../money";

describe("money domain rules", () => {
  it("formats pence as pounds sterling", () => {
    expect(formatGBP(0)).toBe("£0.00");
    expect(formatGBP(50500)).toBe("£505.00");
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects formatting an invalid pence value of %s", (pence) => {
    expect(() => formatGBP(pence)).toThrow(
      "Pence value must be a non-negative safe integer number of pence.",
    );
  });

  it("calculates and rounds fixed-decimal line totals in pence", () => {
    expect(calculateLineTotal(4, 6000)).toBe(24000);
    expect(calculateLineTotal(1.5, 1999)).toBe(2999);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid quantity of %s",
    (quantity) => {
      expect(() => calculateLineTotal(quantity, 6000)).toThrow(
        "Quantity must be finite and greater than zero.",
      );
    },
  );

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid unit rate of %s", (unitRatePence) => {
    expect(() => calculateLineTotal(4, unitRatePence)).toThrow(
      "Unit rate must be a non-negative safe integer number of pence.",
    );
  });

  it("rejects an overflowing line total", () => {
    expect(() => calculateLineTotal(2, Number.MAX_SAFE_INTEGER)).toThrow(
      "Line total must be a non-negative safe integer number of pence.",
    );
  });

  it("sums pence values", () => {
    expect(sumPence([24000, 24000, 2500])).toBe(50500);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid pence value of %s", (value) => {
    expect(() => sumPence([value])).toThrow(
      "Pence value must be a non-negative safe integer number of pence.",
    );
  });

  it("rejects an overflowing pence total", () => {
    expect(() => sumPence([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      "Pence total must be a non-negative safe integer number of pence.",
    );
  });
});
