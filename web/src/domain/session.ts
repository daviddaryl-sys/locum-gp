import { calculateLineTotal } from "./money";

const MILLISECONDS_PER_HOUR = 3_600_000;

export function durationHours(start: string, end: string): number {
  const startTimestamp = Date.parse(start);
  const endTimestamp = Date.parse(end);

  if (
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(endTimestamp) ||
    endTimestamp <= startTimestamp
  ) {
    throw new Error("Session end must be later than its start.");
  }

  return (endTimestamp - startTimestamp) / MILLISECONDS_PER_HOUR;
}

export function sessionValuePence(
  durationInHours: number,
  hourlyRatePence: number,
): number {
  return calculateLineTotal(durationInHours, hourlyRatePence);
}
