import { describe, expect, it } from "vitest";

import {
  categoriesFor,
  defaultMtdCategory,
  suggestCategory,
} from "../expenseCategoryCatalog";

describe("profession-specific expense categories", () => {
  it("uses GP terminology while retaining stable stored category keys", () => {
    const categories = categoriesFor("gp");

    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "professional_memberships",
          label: expect.stringContaining("GMC"),
        }),
        expect.objectContaining({
          key: "professional_indemnity",
          label: expect.stringContaining("indemnity"),
        }),
      ]),
    );
    expect(
      categories.find(({ key }) => key === "professional_memberships")?.label,
    ).toMatch(/BMA.*RCGP/);
  });

  it("uses pharmacist terminology while retaining stable stored category keys", () => {
    const categories = categoriesFor("pharmacist");

    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "professional_memberships",
          label: expect.stringContaining("GPhC"),
        }),
        expect.objectContaining({
          key: "professional_indemnity",
          label: expect.stringContaining("indemnity"),
        }),
        expect.objectContaining({
          key: "professional_training",
          label: expect.stringContaining("CPD"),
        }),
      ]),
    );
    expect(
      categories.find(({ key }) => key === "professional_memberships")?.label,
    ).toContain("PDA");
  });

  it("retains shared travel, software, accountancy, equipment, clothing, and home-office categories", () => {
    const sharedKeys = [
      "mileage_business_travel",
      "computer_software_phone_internet",
      "accountancy_legal_bank_fees",
      "doctors_bag_equipment",
      "stationery_office_supplies",
      "uniform_protective_clothing",
      "home_office",
    ];

    for (const profession of ["gp", "pharmacist"] as const) {
      expect(categoriesFor(profession).map(({ key }) => key)).toEqual(
        expect.arrayContaining(sharedKeys),
      );
    }
  });

  it("offers the same stationery and office supplies category to both professions", () => {
    for (const profession of ["gp", "pharmacist"] as const) {
      expect(categoriesFor(profession)).toContainEqual({
        key: "stationery_office_supplies",
        label: "Stationery and office supplies",
        group: "general",
      });
    }
  });
});

describe("expense category suggestions", () => {
  it("suggests a stable category key from profession-specific wording", () => {
    expect(
      suggestCategory("pharmacist", "GPhC annual retention fee")?.key,
    ).toBe("professional_memberships");
    expect(suggestCategory("gp", "BMA membership renewal")?.key).toBe(
      "professional_memberships",
    );
    expect(suggestCategory("gp", "GMC annual fee")?.key).toBe(
      "professional_memberships",
    );
    expect(suggestCategory("gp", "RCGP membership")?.key).toBe(
      "professional_memberships",
    );
    expect(suggestCategory("gp", "MPS annual indemnity")?.key).toBe(
      "professional_indemnity",
    );
    expect(suggestCategory("gp", "Medical defence subscription")?.key).toBe(
      "professional_indemnity",
    );
    expect(suggestCategory("pharmacist", "PDA membership")?.key).toBe(
      "professional_memberships",
    );
    expect(suggestCategory("pharmacist", "CPD training day")?.key).toBe(
      "professional_training",
    );
  });

  it("does not match professional abbreviations inside ordinary words", () => {
    expect(suggestCategory("pharmacist", "Software update")).toBeNull();
    expect(suggestCategory("gp", "Postage stamps")).toBeNull();
    expect(suggestCategory("gp", "Golf course parking")).toBeNull();
  });

  it("suggests stationery and office supplies from bounded receipt wording", () => {
    for (const profession of ["gp", "pharmacist"] as const) {
      expect(
        suggestCategory(
          profession,
          "Professional stationery and printer paper",
        )?.key,
      ).toBe("stationery_office_supplies");
      expect(
        suggestCategory(
          profession,
          "Office supplies - toner cartridge",
        )?.key,
      ).toBe("stationery_office_supplies");
    }
  });

  it("does not infer stationery from partial ordinary words", () => {
    expect(suggestCategory("gp", "Newspaper subscription")).toBeNull();
    expect(suggestCategory("pharmacist", "Fingerprint scanner")).toBeNull();
  });

  it("provides conservative editable HMRC defaults", () => {
    expect(defaultMtdCategory("professional_indemnity")).toBe(
      "professional_fees",
    );
    expect(defaultMtdCategory("mileage_business_travel")).toBe(
      "travel_costs",
    );
    expect(defaultMtdCategory("stationery_office_supplies")).toBe(
      "office_costs",
    );
  });

  it("does not claim one HMRC category for ambiguous accountancy and bank fees", () => {
    expect(defaultMtdCategory("accountancy_legal_bank_fees")).toBeNull();
  });
});
