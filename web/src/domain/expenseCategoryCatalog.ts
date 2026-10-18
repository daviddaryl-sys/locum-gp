import {
  PREDEFINED_EXPENSE_CATEGORIES,
  type PredefinedExpenseCategoryKey,
} from "./expense";
import type { MtdExpenseCategory } from "./mtd";
import type { Profession } from "./profession";

export type ExpenseCategoryCatalogItem = {
  key: PredefinedExpenseCategoryKey;
  label: string;
  group: "practice" | "general";
};

const PROFESSION_LABELS: Record<
  Profession,
  Partial<Record<PredefinedExpenseCategoryKey, string>>
> = {
  gp: {
    professional_indemnity: "GP professional indemnity",
    professional_memberships:
      "GMC, BMA, RCGP, and other professional memberships",
    professional_training: "GP training and CPD",
    doctors_bag_equipment: "Doctor's bag and professional equipment",
  },
  pharmacist: {
    professional_indemnity: "Pharmacist professional indemnity",
    professional_memberships:
      "GPhC, PDA, and other professional memberships",
    professional_training: "Pharmacist training and CPD",
    doctors_bag_equipment: "Professional bag and equipment",
  },
};

const SUGGESTION_TERMS: Record<
  Profession,
  ReadonlyArray<{
    key: PredefinedExpenseCategoryKey;
    terms: readonly string[];
  }>
> = {
  gp: [
    {
      key: "professional_memberships",
      terms: ["gmc", "bma", "rcgp"],
    },
    {
      key: "professional_indemnity",
      terms: ["indemnity", "medical defence", "mdu", "mps"],
    },
    {
      key: "professional_training",
      terms: ["cpd", "training"],
    },
    {
      key: "stationery_office_supplies",
      terms: [
        "stationery",
        "office supplies",
        "printer paper",
        "printing paper",
        "notebook",
        "notebooks",
        "printer ink",
        "ink cartridge",
        "toner cartridge",
      ],
    },
  ],
  pharmacist: [
    {
      key: "professional_memberships",
      terms: ["gphc", "pda"],
    },
    {
      key: "professional_indemnity",
      terms: ["indemnity", "professional defence"],
    },
    {
      key: "professional_training",
      terms: ["cpd", "training"],
    },
    {
      key: "stationery_office_supplies",
      terms: [
        "stationery",
        "office supplies",
        "printer paper",
        "printing paper",
        "notebook",
        "notebooks",
        "printer ink",
        "ink cartridge",
        "toner cartridge",
      ],
    },
  ],
};

const MTD_DEFAULTS: Record<
  PredefinedExpenseCategoryKey,
  MtdExpenseCategory | null
> = {
  mileage_business_travel: "travel_costs",
  public_transport_taxi: "travel_costs",
  parking_tolls_congestion: "travel_costs",
  qualifying_accommodation: "travel_costs",
  qualifying_subsistence: "travel_costs",
  practice_medical_supplies: "cost_of_goods",
  practice_printing_phone_postage: "office_costs",
  agency_booking_fees: "professional_fees",
  other_practice_specific: "other_business_expenses",
  professional_indemnity: "professional_fees",
  professional_memberships: "professional_fees",
  accountancy_legal_bank_fees: null,
  professional_training: "other_business_expenses",
  computer_software_phone_internet: "office_costs",
  stationery_office_supplies: "office_costs",
  doctors_bag_equipment: "other_business_expenses",
  uniform_protective_clothing: "other_business_expenses",
  home_office: "premises_costs",
  other_general: "other_business_expenses",
};

export function categoriesFor(
  profession: Profession,
): ExpenseCategoryCatalogItem[] {
  const labels = PROFESSION_LABELS[profession];
  return PREDEFINED_EXPENSE_CATEGORIES.map((category) => ({
    ...category,
    label: labels[category.key] ?? category.label,
  }));
}

export function suggestCategory(
  profession: Profession,
  description: string,
): ExpenseCategoryCatalogItem | null {
  const normalized = description.trim().toLocaleLowerCase("en-GB");
  if (!normalized) return null;

  const suggestion = SUGGESTION_TERMS[profession].find(({ terms }) =>
    terms.some((term) => matchesTerm(normalized, term)),
  );
  if (!suggestion) return null;

  return (
    categoriesFor(profession).find(({ key }) => key === suggestion.key) ?? null
  );
}

export function defaultMtdCategory(
  categoryKey: PredefinedExpenseCategoryKey,
): MtdExpenseCategory | null {
  return MTD_DEFAULTS[categoryKey];
}

function matchesTerm(value: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(
    value,
  );
}
