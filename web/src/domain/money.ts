export function formatGBP(pence: number): string {
  assertNonNegativeSafeIntegerPence(pence, "Pence value");

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function assertNonNegativeSafeIntegerPence(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative safe integer number of pence.`,
    );
  }
}

export function calculateLineTotal(
  quantity: number,
  unitRatePence: number,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be finite and greater than zero.");
  }

  assertNonNegativeSafeIntegerPence(unitRatePence, "Unit rate");

  const rawLineTotal = quantity * unitRatePence;
  if (
    !Number.isFinite(rawLineTotal) ||
    rawLineTotal < 0 ||
    rawLineTotal > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      "Line total must be a non-negative safe integer number of pence.",
    );
  }

  const lineTotal = Math.round(rawLineTotal);
  assertNonNegativeSafeIntegerPence(lineTotal, "Line total");

  return lineTotal;
}

export function sumPence(values: number[]): number {
  return values.reduce((total, value) => {
    assertNonNegativeSafeIntegerPence(value, "Pence value");

    const nextTotal = total + value;
    assertNonNegativeSafeIntegerPence(nextTotal, "Pence total");
    return nextTotal;
  }, 0);
}
