import { describe, expect, it } from "vitest";

import {
  CAR_AND_GOODS_VEHICLE_MILEAGE_RATE_TABLES,
  suggestMileage,
} from "../mileage";

describe("mileage suggestions", () => {
  it("uses the 2026-27 first-band rate from 6 April 2026", () => {
    expect(
      suggestMileage({
        date: "2026-04-06",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toMatchObject({
      amountPence: 1100,
      startingRatePence: 55,
      taxYear: "2026-27",
      rateVersion: "self-employed-simplified-mileage-2026-27-v1",
      thresholdSplit: {
        firstBandMiles: 20,
        afterThresholdMiles: 0,
        firstBandRatePence: 55,
        afterThresholdRatePence: 25,
      },
    });
  });

  it("uses the previous first-band rate through 5 April 2026", () => {
    expect(
      suggestMileage({
        date: "2026-04-05",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toMatchObject({
      amountPence: 900,
      startingRatePence: 45,
      taxYear: "2025-26",
      rateVersion: "self-employed-simplified-mileage-2025-26-v1",
    });
  });

  it("fails closed before the supported prior tax year", () => {
    expect(() =>
      suggestMileage({
        date: "2025-04-05",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toThrow("No verified mileage rate is configured for this date.");

    expect(
      suggestMileage({
        date: "2025-04-06",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toMatchObject({
      amountPence: 900,
      taxYear: "2025-26",
      rateVersion: "self-employed-simplified-mileage-2025-26-v1",
    });
  });

  it("calculates a 20-mile journey wholly within the 2026-27 first band", () => {
    expect(
      suggestMileage({
        date: "2026-08-12",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toMatchObject({ amountPence: 1100, startingRatePence: 55 });
  });

  it("splits a journey that crosses 10,000 cumulative tax-year miles", () => {
    const suggestion = suggestMileage({
      date: "2026-08-12",
      distanceMiles: 20,
      priorTaxYearMiles: 9990,
    });

    expect(suggestion).toMatchObject({
      amountPence: 800,
      startingRatePence: 55,
      thresholdSplit: {
        firstBandMiles: 10,
        afterThresholdMiles: 10,
        firstBandRatePence: 55,
        afterThresholdRatePence: 25,
      },
    });
    expect(suggestion.basis).toContain("10 miles at 55p");
    expect(suggestion.basis).toContain("10 miles at 25p");
  });

  it("uses the after-band rate when prior mileage is already at the threshold", () => {
    expect(
      suggestMileage({
        date: "2025-12-01",
        distanceMiles: 20,
        priorTaxYearMiles: 10_000,
      }),
    ).toMatchObject({
      amountPence: 500,
      startingRatePence: 25,
      thresholdSplit: {
        firstBandMiles: 0,
        afterThresholdMiles: 20,
      },
    });
  });

  it("marks the calculated value as an editable suggestion with cautionary metadata", () => {
    const suggestion = suggestMileage({
      date: "2026-08-12",
      distanceMiles: 20,
      priorTaxYearMiles: 0,
    });

    expect(suggestion.editable).toBe(true);
    expect(suggestion.suggestionOnly).toBe(true);
    expect(suggestion.appliesTo).toBe("cars_and_goods_vehicles");
    expect(suggestion.basis).toContain("2026-27");
    expect(suggestion.basis).toContain("cars and goods vehicles");
    expect(suggestion.warning).toContain("actual vehicle costs");
    expect(suggestion.warning).toContain("capital allowances");
    expect(suggestion.warning).toContain("accountant");
    expect(suggestion.warning).toContain(
      "Motorcycles and bicycles use different rates",
    );
    expect(suggestion.warning).not.toMatch(/guaranteed|submitted to HMRC/i);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid distance of %s miles",
    (distanceMiles) => {
      expect(() =>
        suggestMileage({
          date: "2026-08-12",
          distanceMiles,
          priorTaxYearMiles: 0,
        }),
      ).toThrow("Distance must be finite and greater than zero");
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid prior tax-year mileage of %s",
    (priorTaxYearMiles) => {
      expect(() =>
        suggestMileage({
          date: "2026-08-12",
          distanceMiles: 20,
          priorTaxYearMiles,
        }),
      ).toThrow("Prior tax-year mileage must be finite and non-negative");
    },
  );

  it.each(["", "12/08/2026", "2026-02-30", "2026-13-01"])(
    "rejects invalid date %s",
    (date) => {
      expect(() =>
        suggestMileage({ date, distanceMiles: 20, priorTaxYearMiles: 0 }),
      ).toThrow("Date must be a valid YYYY-MM-DD calendar date");
    },
  );

  it("rejects dates without a verified mileage rate version", () => {
    expect(() =>
      suggestMileage({
        date: "2027-04-06",
        distanceMiles: 20,
        priorTaxYearMiles: 0,
      }),
    ).toThrow("No verified mileage rate is configured for this date.");
  });

  it.each([
    { field: "distance", distanceMiles: 1.001, priorTaxYearMiles: 0 },
    { field: "prior", distanceMiles: 1, priorTaxYearMiles: 1.001 },
    { field: "distance", distanceMiles: 1_000_000, priorTaxYearMiles: 0 },
    { field: "prior", distanceMiles: 1, priorTaxYearMiles: 1_000_000 },
  ])("rejects incompatible $field precision or bounds", (input) => {
    expect(() =>
      suggestMileage({ date: "2026-08-12", ...input }),
    ).toThrow(/at most 999999\.99 miles with no more than 2 decimal places/);
  });

  it("rounds valid two-decimal mile inputs deterministically to integer pence", () => {
    expect(
      suggestMileage({
        date: "2026-08-12",
        distanceMiles: 1.01,
        priorTaxYearMiles: 0,
      }).amountPence,
    ).toBe(56);
    expect(
      suggestMileage({
        date: "2026-08-12",
        distanceMiles: 0.01,
        priorTaxYearMiles: 9999.99,
      }).amountPence,
    ).toBe(1);
  });

  it("splits a fractional journey at the threshold in centimiles", () => {
    expect(
      suggestMileage({
        date: "2026-08-12",
        distanceMiles: 0.02,
        priorTaxYearMiles: 9999.99,
      }),
    ).toMatchObject({
      amountPence: 1,
      thresholdSplit: {
        firstBandMiles: 0.01,
        afterThresholdMiles: 0.01,
        firstBandRatePence: 55,
        afterThresholdRatePence: 25,
      },
    });
  });

  it("rounds an exact half penny up to the nearest whole penny", () => {
    const suggestion = suggestMileage({
      date: "2026-08-12",
      distanceMiles: 0.02,
      priorTaxYearMiles: 10_000,
    });

    expect(suggestion.amountPence).toBe(1);
    expect(suggestion.roundingPolicy).toBe("nearest_penny_half_up");
    expect(suggestion.basis).toContain("half pennies rounded up");
  });

  it("exports immutable, versioned source data", () => {
    expect(CAR_AND_GOODS_VEHICLE_MILEAGE_RATE_TABLES).toEqual([
      expect.objectContaining({
        version: "self-employed-simplified-mileage-2026-27-v1",
        appliesTo: "cars_and_goods_vehicles",
        effectiveFrom: "2026-04-06",
        effectiveTo: "2027-04-05",
        firstBandRatePence: 55,
        afterThresholdRatePence: 25,
        thresholdMiles: 10_000,
      }),
      expect.objectContaining({
        version: "self-employed-simplified-mileage-2025-26-v1",
        appliesTo: "cars_and_goods_vehicles",
        effectiveFrom: "2025-04-06",
        effectiveTo: "2026-04-05",
        firstBandRatePence: 45,
        afterThresholdRatePence: 25,
      }),
    ]);
  });
});
