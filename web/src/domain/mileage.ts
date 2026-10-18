const MAX_DISTANCE_MILES = 999_999.99;
const TAX_YEAR_THRESHOLD_MILES = 10_000;
const CENTIMILES_PER_MILE = 100;

export type MileageRateVersion = {
  version: string;
  appliesTo: "cars_and_goods_vehicles";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  firstBandRatePence: number;
  afterThresholdRatePence: number;
  thresholdMiles: number;
};

// Source: https://www.gov.uk/simpler-income-tax-simplified-expenses/vehicles
// Retrieved 2026-08-08. These are suggestions, not an eligibility decision.
// 2025-04-06 is the app's verified support boundary for the prior tax year;
// it does not claim that the 45p rate legally began on that date.
export const CAR_AND_GOODS_VEHICLE_MILEAGE_RATE_TABLES = Object.freeze([
  Object.freeze({
    version: "self-employed-simplified-mileage-2026-27-v1",
    appliesTo: "cars_and_goods_vehicles" as const,
    effectiveFrom: "2026-04-06",
    effectiveTo: "2027-04-05",
    firstBandRatePence: 55,
    afterThresholdRatePence: 25,
    thresholdMiles: TAX_YEAR_THRESHOLD_MILES,
  }),
  Object.freeze({
    version: "self-employed-simplified-mileage-2025-26-v1",
    appliesTo: "cars_and_goods_vehicles" as const,
    effectiveFrom: "2025-04-06",
    effectiveTo: "2026-04-05",
    firstBandRatePence: 45,
    afterThresholdRatePence: 25,
    thresholdMiles: TAX_YEAR_THRESHOLD_MILES,
  }),
] satisfies readonly MileageRateVersion[]);

export type MileageSuggestionInput = {
  date: string;
  distanceMiles: number;
  priorTaxYearMiles: number;
};

export type MileageThresholdSplit = {
  firstBandMiles: number;
  afterThresholdMiles: number;
  firstBandRatePence: number;
  afterThresholdRatePence: number;
};

export type MileageSuggestion = {
  amountPence: number;
  startingRatePence: number;
  thresholdSplit: MileageThresholdSplit;
  taxYear: string;
  rateVersion: string;
  appliesTo: "cars_and_goods_vehicles";
  roundingPolicy: "nearest_penny_half_up";
  basis: string;
  editable: true;
  suggestionOnly: true;
  warning: string;
};

const MILEAGE_WARNING =
  "This editable estimate is only for cars and goods vehicles. Motorcycles and bicycles use different rates and are not covered by this calculation. If you use actual vehicle costs or have claimed capital allowances, you may need advice from your accountant.";

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * CENTIMILES_PER_MILE;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

function assertDistance(distanceMiles: number): void {
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) {
    throw new Error("Distance must be finite and greater than zero.");
  }
  if (
    distanceMiles > MAX_DISTANCE_MILES ||
    !hasAtMostTwoDecimalPlaces(distanceMiles)
  ) {
    throw new Error(
      "Distance must be at most 999999.99 miles with no more than 2 decimal places.",
    );
  }
}

function assertPriorMileage(priorTaxYearMiles: number): void {
  if (!Number.isFinite(priorTaxYearMiles) || priorTaxYearMiles < 0) {
    throw new Error(
      "Prior tax-year mileage must be finite and non-negative.",
    );
  }
  if (
    priorTaxYearMiles > MAX_DISTANCE_MILES ||
    !hasAtMostTwoDecimalPlaces(priorTaxYearMiles)
  ) {
    throw new Error(
      "Prior tax-year mileage must be at most 999999.99 miles with no more than 2 decimal places.",
    );
  }
}

function rateTableFor(date: string): MileageRateVersion {
  const table = CAR_AND_GOODS_VEHICLE_MILEAGE_RATE_TABLES.find(
    ({ effectiveFrom, effectiveTo }) =>
      (effectiveFrom === null || date >= effectiveFrom) &&
      (effectiveTo === null || date <= effectiveTo),
  );
  if (!table) {
    throw new Error("No verified mileage rate is configured for this date.");
  }
  return table;
}

function ukTaxYearFor(date: string): string {
  const year = Number(date.slice(0, 4));
  const startsThisCalendarYear = date.slice(5) >= "04-06";
  const startYear = startsThisCalendarYear ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function formatMiles(centimiles: number): string {
  return String(centimiles / CENTIMILES_PER_MILE);
}

export function suggestMileage({
  date,
  distanceMiles,
  priorTaxYearMiles,
}: MileageSuggestionInput): MileageSuggestion {
  if (!isValidDate(date)) {
    throw new Error("Date must be a valid YYYY-MM-DD calendar date.");
  }
  assertDistance(distanceMiles);
  assertPriorMileage(priorTaxYearMiles);

  const rateTable = rateTableFor(date);
  const distanceCentimiles = Math.round(
    distanceMiles * CENTIMILES_PER_MILE,
  );
  const priorCentimiles = Math.round(
    priorTaxYearMiles * CENTIMILES_PER_MILE,
  );
  const thresholdCentimiles =
    rateTable.thresholdMiles * CENTIMILES_PER_MILE;
  const firstBandCentimiles = Math.min(
    distanceCentimiles,
    Math.max(0, thresholdCentimiles - priorCentimiles),
  );
  const afterThresholdCentimiles =
    distanceCentimiles - firstBandCentimiles;

  const amountHundredthsOfPence =
    firstBandCentimiles * rateTable.firstBandRatePence +
    afterThresholdCentimiles * rateTable.afterThresholdRatePence;
  // Calculate in exact centimile-hundredths of pence, then round the journey
  // total once to the nearest penny; exact half pennies round up.
  const amountPence = Math.round(
    amountHundredthsOfPence / CENTIMILES_PER_MILE,
  );
  if (!Number.isSafeInteger(amountPence)) {
    throw new Error("Mileage suggestion exceeds the supported pence range.");
  }

  const taxYear = ukTaxYearFor(date);
  const basisParts: string[] = [];
  if (firstBandCentimiles > 0) {
    basisParts.push(
      `${formatMiles(firstBandCentimiles)} miles at ${rateTable.firstBandRatePence}p`,
    );
  }
  if (afterThresholdCentimiles > 0) {
    basisParts.push(
      `${formatMiles(afterThresholdCentimiles)} miles at ${rateTable.afterThresholdRatePence}p`,
    );
  }

  return {
    amountPence,
    startingRatePence:
      priorCentimiles < thresholdCentimiles
        ? rateTable.firstBandRatePence
        : rateTable.afterThresholdRatePence,
    thresholdSplit: {
      firstBandMiles: firstBandCentimiles / CENTIMILES_PER_MILE,
      afterThresholdMiles:
        afterThresholdCentimiles / CENTIMILES_PER_MILE,
      firstBandRatePence: rateTable.firstBandRatePence,
      afterThresholdRatePence: rateTable.afterThresholdRatePence,
    },
    taxYear,
    rateVersion: rateTable.version,
    appliesTo: rateTable.appliesTo,
    roundingPolicy: "nearest_penny_half_up",
    basis: `${taxYear} simplified mileage suggestion for cars and goods vehicles only: ${basisParts.join(" + ")}. Amount rounded to the nearest penny, with half pennies rounded up.`,
    editable: true,
    suggestionOnly: true,
    warning: MILEAGE_WARNING,
  };
}
