export const RECORD_STORES = [
  "practices",
  "sessions",
  "invoices",
  "invoiceItems",
  "settings",
  "expenseCategories",
  "expenses",
] as const;

export type RecordStoreName = (typeof RECORD_STORES)[number];
export type SyncState = "pending" | "synced" | "conflict";
export type MutationState = "pending" | "conflict";
export type MutationOperation = "upsert" | "delete";
export type RecordPayload = Record<string, unknown>;

export type LocalRecord = {
  ownerId: string;
  id: string;
  recordType: RecordStoreName;
  data: RecordPayload;
  localRevision: number;
  serverRevision: number;
  syncState: SyncState;
  updatedAt: string;
  deletedAt?: string | null;
};

export type OutboxMutation = {
  ownerId: string;
  id: string;
  recordType: RecordStoreName;
  recordId: string;
  operation: MutationOperation;
  payload: RecordPayload;
  baseRevision: number;
  localRevision: number;
  state: MutationState;
  attempts: number;
  createdAt: string;
  nextAttemptAt?: string | null;
};

export type SyncCursor = {
  ownerId: string;
  cursor: string | null;
  updatedAt: string;
};

export type StoredConflict = {
  ownerId: string;
  id: string;
  recordType: RecordStoreName;
  recordId: string;
  mutationId: string;
  localData: RecordPayload;
  serverData: RecordPayload;
  serverRevision: number;
  localUpdatedAt: string;
  serverUpdatedAt: string;
  createdAt: string;
};

export type AccountMetadata = {
  key: "active-owner";
  ownerId: string;
};

export type SaveRecordResult = {
  record: LocalRecord;
  mutation: OutboxMutation;
};

export type ReceiptQueueEntry = {
  ownerId: string;
  id: string;
  expenseId: string;
  objectKey: string;
  operation: "upload" | "delete";
  originalName: string;
  mimeType: import("@/domain/expense").ExpenseReceiptMimeType;
  sizeBytes: number;
  blob: Blob | null;
  deleteAfterUploadKey: string | null;
  state: "pending" | "failed";
  attempts: number;
  version: number;
  createdAt: string;
};

export type ReceiptUploadDraft = Omit<
  ReceiptQueueEntry,
  "ownerId" | "id" | "operation" | "state" | "attempts" | "version" | "createdAt"
>;

export type ReceiptDeleteDraft = Pick<
  ReceiptQueueEntry,
  "expenseId" | "objectKey"
> & { operation: "delete" };

export type ReceiptOperationDraft = ReceiptUploadDraft | ReceiptDeleteDraft;
