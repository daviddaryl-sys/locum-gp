import type { RecordPayload, RecordStoreName } from "@/offline/types";

import {
  fromDatabaseSettingsPayload,
  toDatabaseSettingsPayload,
} from "./settingsPayload";

const PAYLOAD_FIELDS = {
  practices: {
    name: "name",
    billingAddress: "billing_address",
    defaultHourlyRatePence: "default_hourly_rate_pence",
    paymentTermsDays: "payment_terms_days",
    archived: "archived",
    isDemo: "is_demo",
  },
  sessions: {
    practiceId: "practice_id",
    startsAt: "starts_at",
    endsAt: "ends_at",
    hourlyRatePence: "hourly_rate_pence",
    status: "status",
    notes: "notes",
    isDemo: "is_demo",
  },
  invoices: {
    invoiceNumber: "invoice_number",
    status: "status",
    practiceId: "practice_id",
    issueDate: "issue_date",
    dueDate: "due_date",
    paidAt: "paid_at",
    totalPence: "total_pence",
    practiceSnapshot: "practice_snapshot",
    paymentSnapshot: "payment_snapshot",
    issuedAt: "issued_at",
    artifactPath: "artifact_path",
    isDemo: "is_demo",
  },
  invoiceItems: {
    invoiceId: "invoice_id",
    sessionId: "session_id",
    description: "description",
    quantity: "quantity",
    unitRatePence: "unit_rate_pence",
    lineTotalPence: "line_total_pence",
    isDemo: "is_demo",
  },
  settings: {
    ciphertext: "ciphertext",
    salt: "salt",
    initializationVector: "initialization_vector",
    kdfParameters: "kdf_parameters",
    encryptionVersion: "encryption_version",
    profile: "profile",
    invoicePrefix: "invoice_prefix",
  },
  expenseCategories: {
    name: "name",
    archivedAt: "archived_at",
    isDemo: "is_demo",
  },
  expenses: {
    expenseDate: "expense_date",
    amountPence: "amount_pence",
    categoryKey: "category_key",
    customCategoryId: "custom_category_id",
    mtdCategory: "mtd_category",
    allowablePercentage: "allowable_percentage",
    practiceId: "practice_id",
    supplierDescription: "supplier_description",
    notes: "notes",
    reimbursedByPractice: "reimbursed_by_practice",
    needsAccountantReview: "needs_accountant_review",
    receiptObjectKey: "receipt_object_key",
    receiptOriginalName: "receipt_original_name",
    receiptMimeType: "receipt_mime_type",
    receiptSizeBytes: "receipt_size_bytes",
    receiptSyncStatus: "receipt_sync_status",
    expenseKind: "expense_kind",
    journeyOrigin: "journey_origin",
    journeyDestination: "journey_destination",
    distanceMiles: "distance_miles",
    mileageRatePence: "mileage_rate_pence",
    linkedSessionId: "linked_session_id",
    isDemo: "is_demo",
  },
} as const;

export function toDatabasePayload(
  recordType: RecordStoreName,
  payload: RecordPayload,
) {
  if (recordType === "settings") return toDatabaseSettingsPayload(payload);
  const fields = PAYLOAD_FIELDS[recordType] as Record<string, string>;
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => key in fields)
      .map(([key, value]) => [fields[key], value]),
  );
}

export function fromDatabasePayload(
  recordType: RecordStoreName,
  row: Record<string, unknown>,
) {
  if (recordType === "settings") return fromDatabaseSettingsPayload(row);
  const fields = PAYLOAD_FIELDS[recordType] as Record<string, string>;
  return Object.fromEntries(
    Object.entries(fields).map(([clientField, databaseField]) => [
      clientField,
      row[databaseField],
    ]),
  );
}
