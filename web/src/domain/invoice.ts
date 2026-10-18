export type StoredInvoiceStatus = "draft" | "sent" | "paid";
export type InvoiceDisplayStatus = StoredInvoiceStatus | "overdue";

const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function parseIsoCalendarDate(value: string, label: string): Date {
  const date = new Date(`${value}T12:00:00.000Z`);

  if (
    !ISO_CALENDAR_DATE_PATTERN.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(
      `${label} must be a valid ISO calendar date (YYYY-MM-DD).`,
    );
  }

  return date;
}

export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequence: number,
): string {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    throw new Error("Invoice prefix must contain non-whitespace characters.");
  }

  assertPositiveSafeInteger(year, "Invoice year");
  assertPositiveSafeInteger(sequence, "Invoice sequence");

  return `${trimmedPrefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

export function calculateDueDate(
  issueDate: string,
  paymentTermsDays: number,
): string {
  const date = parseIsoCalendarDate(issueDate, "Issue date");
  if (!Number.isSafeInteger(paymentTermsDays) || paymentTermsDays < 0) {
    throw new Error(
      "Payment terms must be a non-negative safe integer number of days.",
    );
  }

  date.setUTCDate(date.getUTCDate() + paymentTermsDays);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(
      "Payment terms produce a due date outside the supported range.",
    );
  }

  const dueDate = date.toISOString().slice(0, 10);
  if (!ISO_CALENDAR_DATE_PATTERN.test(dueDate)) {
    throw new Error(
      "Payment terms produce a due date outside the supported range.",
    );
  }

  return dueDate;
}

export function deriveInvoiceDisplayStatus(input: {
  storedStatus: StoredInvoiceStatus;
  dueDate: string;
  today: string;
}): InvoiceDisplayStatus {
  parseIsoCalendarDate(input.dueDate, "Due date");
  parseIsoCalendarDate(input.today, "Today");

  if (input.storedStatus === "sent" && input.dueDate < input.today) {
    return "overdue";
  }

  return input.storedStatus;
}
