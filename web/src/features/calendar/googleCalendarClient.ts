import type { CalendarSyncSummary } from "./server/calendarRepository";

const UNAVAILABLE = "Calendar sync is temporarily unavailable.";
const STATES: CalendarSyncSummary["state"][] = [
  "disabled",
  "not_connected",
  "connected",
  "pending",
  "reconnect_required",
];

function isTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseCalendarSyncSummary(value: unknown): CalendarSyncSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(UNAVAILABLE);
  }
  const row = value as Record<string, unknown>;
  if (
    !STATES.includes(row.state as CalendarSyncSummary["state"]) ||
    !Number.isSafeInteger(row.pendingCount) ||
    (row.pendingCount as number) < 0 ||
    !isTimestamp(row.lastSyncAt) ||
    !isTimestamp(row.nextRetryAt)
  ) {
    throw new Error(UNAVAILABLE);
  }
  return {
    state: row.state as CalendarSyncSummary["state"],
    pendingCount: row.pendingCount as number,
    lastSyncAt: row.lastSyncAt,
    nextRetryAt: row.nextRetryAt,
  };
}

export async function requestCalendarSync(): Promise<CalendarSyncSummary> {
  try {
    const response = await fetch("/api/google-calendar/sync", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) throw new Error(UNAVAILABLE);
    return parseCalendarSyncSummary(await response.json());
  } catch {
    throw new Error(UNAVAILABLE);
  }
}
