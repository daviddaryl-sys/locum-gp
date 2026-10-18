import { describe, expect, it } from "vitest";

import { durationHours, sessionValuePence } from "../session";

describe("session domain rules", () => {
  it("calculates session duration in hours", () => {
    expect(
      durationHours(
        "2026-07-22T08:00:00.000Z",
        "2026-07-22T12:00:00.000Z",
      ),
    ).toBe(4);
  });

  it("uses elapsed time across the Europe/London DST jump", () => {
    expect(
      durationHours(
        "2026-03-29T00:30:00.000Z",
        "2026-03-29T02:30:00.000+01:00",
      ),
    ).toBe(1);
  });

  it.each([
    ["not-a-date", "2026-07-22T12:00:00.000Z"],
    ["2026-07-22T08:00:00.000Z", "not-a-date"],
    ["2026-07-22T08:00:00.000Z", "2026-07-22T08:00:00.000Z"],
    ["2026-07-22T12:00:00.000Z", "2026-07-22T08:00:00.000Z"],
  ])("rejects invalid or non-positive ranges from %s to %s", (start, end) => {
    expect(() => durationHours(start, end)).toThrow(
      "Session end must be later than its start.",
    );
  });

  it("calculates and rounds session values in pence", () => {
    expect(sessionValuePence(4, 6000)).toBe(24000);
    expect(sessionValuePence(1.5, 1999)).toBe(2999);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid hourly rate of %s",
    (hourlyRatePence) => {
      expect(() => sessionValuePence(4, hourlyRatePence)).toThrow(
        "Unit rate must be a non-negative safe integer number of pence.",
      );
    },
  );

  it("rejects an overflowing session value", () => {
    expect(() => sessionValuePence(2, Number.MAX_SAFE_INTEGER)).toThrow(
      "Line total must be a non-negative safe integer number of pence.",
    );
  });
});
