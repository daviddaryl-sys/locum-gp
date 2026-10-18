import { sumPence } from "./money";
import {
  isMtdExpenseCategory,
  type MtdExpenseCategory,
} from "./mtd";

export const PREDEFINED_EXPENSE_CATEGORIES = [
  { key: "mileage_business_travel", label: "Mileage and business travel", group: "practice" },
  { key: "public_transport_taxi", label: "Public transport and taxi", group: "practice" },
  { key: "parking_tolls_congestion", label: "Parking, tolls, and congestion charges", group: "practice" },
  { key: "qualifying_accommodation", label: "Qualifying hotel or accommodation", group: "practice" },
  { key: "qualifying_subsistence", label: "Qualifying subsistence", group: "practice" },
  { key: "practice_medical_supplies", label: "Practice-specific medical supplies and consumables", group: "practice" },
  { key: "practice_printing_phone_postage", label: "Practice-specific printing, phone, or postage", group: "practice" },
  { key: "agency_booking_fees", label: "Agency or booking fees for the engagement", group: "practice" },
  { key: "other_practice_specific", label: "Other practice-specific expense", group: "practice" },
  { key: "professional_indemnity", label: "Professional indemnity", group: "general" },
  { key: "professional_memberships", label: "GMC, BMA, RCGP, and other professional memberships", group: "general" },
  { key: "accountancy_legal_bank_fees", label: "Accountancy, legal, and bank fees", group: "general" },
  { key: "professional_training", label: "Professional training", group: "general" },
  { key: "computer_software_phone_internet", label: "Computer, software, phone, and internet", group: "general" },
  { key: "stationery_office_supplies", label: "Stationery and office supplies", group: "general" },
  { key: "doctors_bag_equipment", label: "Doctor's bag and equipment used across practices", group: "general" },
  { key: "uniform_protective_clothing", label: "Uniform and protective clothing", group: "general" },
  { key: "home_office", label: "Home office", group: "general" },
  { key: "other_general", label: "Other general expense", group: "general" },
] as const;

export type PredefinedExpenseCategoryKey =
  (typeof PREDEFINED_EXPENSE_CATEGORIES)[number]["key"];
export type ExpenseReceiptMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/heic"
  | "application/pdf";
export type ExpenseReceiptSyncStatus =
  | "none"
  | "pending"
  | "uploaded"
  | "failed"
  | "delete-pending";

export type ExpenseKind = "standard" | "mileage";
export type MileageFields = {
  expenseKind: ExpenseKind;
  journeyOrigin: string | null;
  journeyDestination: string | null;
  distanceMiles: number | null;
  mileageRatePence: number | null;
  linkedSessionId: string | null;
};

export type ExpenseData = MileageFields & {
  expenseDate: string;
  amountPence: number;
  categoryKey: PredefinedExpenseCategoryKey | null;
  customCategoryId: string | null;
  mtdCategory: MtdExpenseCategory | null;
  allowablePercentage: number | null;
  practiceId: string | null;
  supplierDescription: string;
  notes: string | null;
  reimbursedByPractice: boolean;
  needsAccountantReview: boolean;
  receiptObjectKey: string | null;
  receiptOriginalName: string | null;
  receiptMimeType: ExpenseReceiptMimeType | null;
  receiptSizeBytes: number | null;
  receiptSyncStatus: ExpenseReceiptSyncStatus;
  isDemo: boolean;
};

export type ExpenseCategoryData = {
  name: string;
  archivedAt: string | null;
  isDemo: boolean;
};

export type TaxPeriod = {
  id: string;
  label: string;
  start: string;
  end: string;
};

const CATEGORY_KEYS = new Set<string>(
  PREDEFINED_EXPENSE_CATEGORIES.map(({ key }) => key),
);

export function isPredefinedExpenseCategoryKey(
  value: unknown,
): value is PredefinedExpenseCategoryKey {
  return typeof value === "string" && CATEGORY_KEYS.has(value);
}
const RECEIPT_STATUSES = new Set<ExpenseReceiptSyncStatus>([
  "none",
  "pending",
  "uploaded",
  "failed",
  "delete-pending",
]);
const RECEIPT_TYPES = new Map<string, ReadonlySet<string>>([
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/heic", new Set(["heic"])],
  ["application/pdf", new Set(["pdf"])],
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DISTANCE_MILES = 999999.99;
const MAX_POSTGRES_INTEGER = 2147483647;

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100;
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isExpenseDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseExpenseCategoryData(
  value: unknown,
): ExpenseCategoryData | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.trim().length > 80 ||
    !isNullableString(value.archivedAt) ||
    typeof value.isDemo !== "boolean"
  ) {
    return null;
  }
  return {
    name: value.name.trim(),
    archivedAt: value.archivedAt,
    isDemo: value.isDemo,
  };
}

export function parseExpenseData(value: unknown): ExpenseData | null {
  if (!isRecord(value)) return null;

  const categoryKey = value.categoryKey;
  const customCategoryId = value.customCategoryId;
  const hasPredefined = isPredefinedExpenseCategoryKey(categoryKey);
  const hasCustom = typeof customCategoryId === "string" && customCategoryId.length > 0;
  if (hasPredefined === hasCustom) return null;

  const receiptStatus = value.receiptSyncStatus;
  const receiptMimeType = value.receiptMimeType;
  const mtdCategory = value.mtdCategory ?? null;
  const allowablePercentage = value.allowablePercentage ?? null;
  const expenseKind =
    value.expenseKind === undefined ? "standard" : value.expenseKind;
  const journeyOrigin = value.journeyOrigin ?? null;
  const journeyDestination = value.journeyDestination ?? null;
  const distanceMiles = value.distanceMiles ?? null;
  const mileageRatePence = value.mileageRatePence ?? null;
  const linkedSessionId = value.linkedSessionId ?? null;
  if (
    typeof value.expenseDate !== "string" ||
    !Number.isSafeInteger(value.amountPence) ||
    (value.amountPence as number) <= 0 ||
    !(value.practiceId === null || typeof value.practiceId === "string") ||
    typeof value.supplierDescription !== "string" ||
    value.supplierDescription.trim().length === 0 ||
    value.supplierDescription.trim().length > 160 ||
    !(value.notes === null || typeof value.notes === "string") ||
    (typeof value.notes === "string" && value.notes.length > 2000) ||
    typeof value.reimbursedByPractice !== "boolean" ||
    typeof value.needsAccountantReview !== "boolean" ||
    !isNullableString(value.receiptObjectKey) ||
    !isNullableString(value.receiptOriginalName) ||
    !(receiptMimeType === null || RECEIPT_TYPES.has(String(receiptMimeType))) ||
    !(value.receiptSizeBytes === null ||
      (Number.isSafeInteger(value.receiptSizeBytes) &&
        (value.receiptSizeBytes as number) >= 1 &&
        (value.receiptSizeBytes as number) <= 10 * 1024 * 1024)) ||
    typeof receiptStatus !== "string" ||
    !RECEIPT_STATUSES.has(receiptStatus as ExpenseReceiptSyncStatus) ||
    typeof value.isDemo !== "boolean"
    || !(mtdCategory === null || isMtdExpenseCategory(mtdCategory))
    || !(allowablePercentage === null || (
      Number.isInteger(allowablePercentage)
      && Number(allowablePercentage) >= 0
      && Number(allowablePercentage) <= 100
    ))
  ) {
    return null;
  }

  if (
    (expenseKind === "standard" &&
      (journeyOrigin !== null ||
        journeyDestination !== null ||
        distanceMiles !== null ||
        mileageRatePence !== null ||
        linkedSessionId !== null)) ||
    (expenseKind === "mileage" &&
      (typeof journeyOrigin !== "string" ||
        journeyOrigin.trim().length === 0 ||
        typeof journeyDestination !== "string" ||
        journeyDestination.trim().length === 0 ||
        typeof distanceMiles !== "number" ||
        !Number.isFinite(distanceMiles) ||
        distanceMiles <= 0 ||
        distanceMiles > MAX_DISTANCE_MILES ||
        !hasAtMostTwoDecimalPlaces(distanceMiles) ||
        !Number.isSafeInteger(mileageRatePence) ||
        Number(mileageRatePence) <= 0 ||
        Number(mileageRatePence) > MAX_POSTGRES_INTEGER ||
        !(linkedSessionId === null ||
          (typeof linkedSessionId === "string" &&
            UUID_PATTERN.test(linkedSessionId))))) ||
    (expenseKind !== "standard" && expenseKind !== "mileage")
  ) {
    return null;
  }

  const hasReceipt = value.receiptObjectKey !== null;
  if (
    (hasReceipt &&
      (value.receiptOriginalName === null ||
        receiptMimeType === null ||
        value.receiptSizeBytes === null ||
        receiptStatus === "none")) ||
    (!hasReceipt &&
      (value.receiptOriginalName !== null ||
        receiptMimeType !== null ||
        value.receiptSizeBytes !== null ||
        receiptStatus !== "none"))
  ) {
    return null;
  }

  return {
    expenseKind,
    journeyOrigin:
      typeof journeyOrigin === "string" ? journeyOrigin.trim() : null,
    journeyDestination:
      typeof journeyDestination === "string" ? journeyDestination.trim() : null,
    distanceMiles:
      typeof distanceMiles === "number"
        ? Math.round(distanceMiles * 100) / 100
        : null,
    mileageRatePence: mileageRatePence as number | null,
    linkedSessionId: linkedSessionId as string | null,
    expenseDate: value.expenseDate,
    amountPence: value.amountPence as number,
    categoryKey: hasPredefined
      ? (categoryKey as PredefinedExpenseCategoryKey)
      : null,
    customCategoryId: hasCustom ? (customCategoryId as string) : null,
    mtdCategory: mtdCategory as MtdExpenseCategory | null,
    allowablePercentage: allowablePercentage as number | null,
    practiceId: value.practiceId as string | null,
    supplierDescription: value.supplierDescription.trim(),
    notes: value.notes as string | null,
    reimbursedByPractice: value.reimbursedByPractice,
    needsAccountantReview: value.needsAccountantReview,
    receiptObjectKey: value.receiptObjectKey,
    receiptOriginalName: value.receiptOriginalName,
    receiptMimeType: receiptMimeType as ExpenseReceiptMimeType | null,
    receiptSizeBytes: value.receiptSizeBytes as number | null,
    receiptSyncStatus: receiptStatus as ExpenseReceiptSyncStatus,
    isDemo: value.isDemo,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function taxYearStart(referenceDate: string): number {
  if (!isExpenseDate(referenceDate)) {
    throw new Error("Reference date must be a valid YYYY-MM-DD date.");
  }
  const year = Number(referenceDate.slice(0, 4));
  const monthDay = referenceDate.slice(5);
  return monthDay < "04-06" ? year - 1 : year;
}

function monthEnd(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function buildTaxYearPeriods(referenceDate: string): TaxPeriod[] {
  const startYear = taxYearStart(referenceDate);
  const periods: TaxPeriod[] = [
    {
      id: "tax-year",
      label: "Entire tax year",
      start: isoDate(startYear, 4, 6),
      end: isoDate(startYear + 1, 4, 5),
    },
    {
      id: "opening-april",
      label: `6–30 April ${startYear}`,
      start: isoDate(startYear, 4, 6),
      end: isoDate(startYear, 4, 30),
    },
  ];

  for (let monthOffset = 5; monthOffset <= 15; monthOffset += 1) {
    const year = startYear + Math.floor((monthOffset - 1) / 12);
    const month = ((monthOffset - 1) % 12) + 1;
    const label = new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
    periods.push({
      id: `month-${pad(month)}`,
      label,
      start: isoDate(year, month, 1),
      end: isoDate(year, month, monthEnd(year, month)),
    });
  }

  periods.push({
    id: "closing-april",
    label: `1–5 April ${startYear + 1}`,
    start: isoDate(startYear + 1, 4, 1),
    end: isoDate(startYear + 1, 4, 5),
  });
  return periods;
}

export function resolveExpensePeriod(
  periodId: string,
  referenceDate: string,
): TaxPeriod {
  const periods = buildTaxYearPeriods(referenceDate);
  return periods.find(({ id }) => id === periodId) ?? periods[0];
}

export function summarizeExpenses(
  expenses: Array<{
    expenseDate: string;
    amountPence: number;
    reimbursedByPractice: boolean;
  }>,
  period: TaxPeriod,
): { count: number; netPence: number; reimbursedPence: number } {
  const included = expenses.filter(
    ({ expenseDate }) =>
      isExpenseDate(expenseDate) &&
      expenseDate >= period.start &&
      expenseDate <= period.end,
  );
  return {
    count: included.length,
    netPence: sumPence(
      included
        .filter(({ reimbursedByPractice }) => !reimbursedByPractice)
        .map(({ amountPence }) => amountPence),
    ),
    reimbursedPence: sumPence(
      included
        .filter(({ reimbursedByPractice }) => reimbursedByPractice)
        .map(({ amountPence }) => amountPence),
    ),
  };
}

export function validateReceiptFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const extensions = RECEIPT_TYPES.get(file.type);
  if (!extensions?.has(extension)) {
    return "Choose a JPG, PNG, HEIC, or PDF receipt.";
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    return "Receipt must not be empty.";
  }
  if (file.size > 10 * 1024 * 1024) {
    return "Receipt must be 10 MB or smaller.";
  }
  return null;
}
