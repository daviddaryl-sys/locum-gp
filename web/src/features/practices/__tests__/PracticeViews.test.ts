import { describe, expect, it } from "vitest";

import { parsePracticeData } from "@/features/practices/PracticeViews";

describe("parsePracticeData", () => {
  it("accepts the server default empty billing-address object", () => {
    expect(
      parsePracticeData({
        name: "Riverside Medical Centre",
        billingAddress: {},
        defaultHourlyRatePence: 6500,
        paymentTermsDays: 30,
        archived: false,
      }),
    ).toEqual({
      name: "Riverside Medical Centre",
      billingAddress: { formatted: "" },
      defaultHourlyRatePence: 6500,
      paymentTermsDays: 30,
      archived: false,
    });
  });
});
