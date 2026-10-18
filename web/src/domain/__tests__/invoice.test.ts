import { describe, expect, it } from "vitest";

import {
  calculateDueDate,
  deriveInvoiceDisplayStatus,
  formatInvoiceNumber,
} from "../invoice";

describe("invoice domain rules", () => {
  it("formats a sequential invoice number", () => {
    expect(formatInvoiceNumber(" INV ", 2026, 1)).toBe("INV-2026-0001");
    expect(formatInvoiceNumber("INV", 2026, 12345)).toBe("INV-2026-12345");
  });

  it.each(["", "   "])("rejects an empty invoice prefix", (prefix) => {
    expect(() => formatInvoiceNumber(prefix, 2026, 1)).toThrow(
      "Invoice prefix must contain non-whitespace characters.",
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid invoice year of %s", (year) => {
    expect(() => formatInvoiceNumber("INV", year, 1)).toThrow(
      "Invoice year must be a positive safe integer.",
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid invoice sequence of %s", (sequence) => {
    expect(() => formatInvoiceNumber("INV", 2026, sequence)).toThrow(
      "Invoice sequence must be a positive safe integer.",
    );
  });

  it("calculates due dates across month, leap-day, and year boundaries", () => {
    expect(calculateDueDate("2026-07-20", 30)).toBe("2026-08-19");
    expect(calculateDueDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(calculateDueDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it.each(["2026-2-20", "2026-02-30", "not-a-date"])(
    "rejects a malformed issue date of %s",
    (issueDate) => {
      expect(() => calculateDueDate(issueDate, 30)).toThrow(
        "Issue date must be a valid ISO calendar date (YYYY-MM-DD).",
      );
    },
  );

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid payment terms of %s", (paymentTermsDays) => {
    expect(() => calculateDueDate("2026-07-20", paymentTermsDays)).toThrow(
      "Payment terms must be a non-negative safe integer number of days.",
    );
  });

  it("rejects a calculated due date outside canonical ISO years", () => {
    expect(() => calculateDueDate("9999-12-31", 1)).toThrow(
      "Payment terms produce a due date outside the supported range.",
    );
  });

  it("derives overdue only for sent invoices past their due date", () => {
    expect(
      deriveInvoiceDisplayStatus({
        storedStatus: "sent",
        dueDate: "2026-07-19",
        today: "2026-07-20",
      }),
    ).toBe("overdue");
    expect(
      deriveInvoiceDisplayStatus({
        storedStatus: "sent",
        dueDate: "2026-07-20",
        today: "2026-07-20",
      }),
    ).toBe("sent");
    expect(
      deriveInvoiceDisplayStatus({
        storedStatus: "paid",
        dueDate: "2026-07-19",
        today: "2026-07-20",
      }),
    ).toBe("paid");
  });

  it("validates both calendar dates before deriving status", () => {
    expect(() =>
      deriveInvoiceDisplayStatus({
        storedStatus: "sent",
        dueDate: "2026-02-30",
        today: "2026-03-01",
      }),
    ).toThrow("Due date must be a valid ISO calendar date (YYYY-MM-DD).");
    expect(() =>
      deriveInvoiceDisplayStatus({
        storedStatus: "paid",
        dueDate: "2026-03-01",
        today: "2026-3-02",
      }),
    ).toThrow("Today must be a valid ISO calendar date (YYYY-MM-DD).");
  });
});
