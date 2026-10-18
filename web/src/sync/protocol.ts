import {
  RECORD_STORES,
  type RecordPayload,
  type RecordStoreName,
} from "@/offline/types";
import {
  isExpenseDate,
  parseExpenseCategoryData,
  parseExpenseData,
} from "@/domain/expense";
import { isIsoDate as isIsoCalendarDate } from "@/domain/mtd";
import { parseServerPaymentEnvelope } from "@/security/paymentEnvelope";

export type SyncMutation = {
  idempotencyKey: string;
  recordType: RecordStoreName;
  recordId: string;
  operation: "upsert" | "delete";
  payload: RecordPayload;
  baseRevision: number;
  localRevision: number;
  updatedAt: string;
};

export type AppliedMutation = {
  kind?: "applied";
  mutationId: string;
  recordType: RecordStoreName;
  recordId: string;
  data: RecordPayload;
  serverRevision: number;
  updatedAt: string;
};

export type MutationConflict = {
  kind?: "conflict";
  mutationId: string;
  recordType: RecordStoreName;
  recordId: string;
  localData: RecordPayload;
  localUpdatedAt: string;
  serverData: RecordPayload;
  serverRevision: number;
  serverUpdatedAt: string;
};

export type SyncMutationResult =
  | (AppliedMutation & { kind: "applied" })
  | (MutationConflict & { kind: "conflict" });

export type PulledRecord = {
  recordType: RecordStoreName;
  recordId: string;
  data: RecordPayload;
  serverRevision: number;
  updatedAt: string;
  deletedAt?: string | null;
};

export type SyncBatchRequest = {
  mutations: SyncMutation[];
  cursor: string | null;
};

export type SyncBatchResponse = {
  applied: AppliedMutation[];
  conflicts: MutationConflict[];
  pulled: PulledRecord[];
  nextCursor: string | null;
};

export interface MutationExecutor {
  execute(ownerId: string, mutation: SyncMutation): Promise<SyncMutationResult>;
  pull(
    ownerId: string,
    cursor: string | null,
  ): Promise<{ pulled: PulledRecord[]; nextCursor: string | null }>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "ownerId",
  "owner_id",
  "revision",
  "updatedAt",
  "updated_at",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecordStoreName(value: unknown): value is RecordStoreName {
  return RECORD_STORES.includes(value as RecordStoreName);
}

function invalidRequest(): never {
  throw new Error("Invalid sync request.");
}

function validatePayload(
  recordType: RecordStoreName,
  operation: "upsert" | "delete",
  value: unknown,
): RecordPayload {
  if (!isObject(value)) invalidRequest();
  if (Object.keys(value).some((key) => FORBIDDEN_PAYLOAD_KEYS.has(key))) {
    invalidRequest();
  }
  if (operation === "delete") return value;

  const allowedKeys: Record<RecordStoreName, Set<string>> = {
    practices: new Set([
      "name",
      "billingAddress",
      "defaultHourlyRatePence",
      "paymentTermsDays",
      "archived",
      "isDemo",
    ]),
    sessions: new Set([
      "practiceId",
      "startsAt",
      "endsAt",
      "hourlyRatePence",
      "status",
      "notes",
      "isDemo",
    ]),
    invoices: new Set([
      "invoiceNumber",
      "status",
      "practiceId",
      "issueDate",
      "dueDate",
      "paidAt",
      "totalPence",
      "practiceSnapshot",
      "paymentSnapshot",
      "issuedAt",
      "artifactPath",
      "isDemo",
    ]),
    invoiceItems: new Set([
      "invoiceId",
      "sessionId",
      "description",
      "quantity",
      "unitRatePence",
      "lineTotalPence",
      "isDemo",
    ]),
    settings: new Set([
      "ciphertext",
      "salt",
      "initializationVector",
      "kdfParameters",
      "encryptionVersion",
      "profile",
      "invoicePrefix",
    ]),
    expenseCategories: new Set(["name", "archivedAt", "isDemo"]),
    expenses: new Set([
      "expenseDate",
      "amountPence",
      "categoryKey",
      "customCategoryId",
      "mtdCategory",
      "allowablePercentage",
      "practiceId",
      "supplierDescription",
      "notes",
      "reimbursedByPractice",
      "needsAccountantReview",
      "receiptObjectKey",
      "receiptOriginalName",
      "receiptMimeType",
      "receiptSizeBytes",
      "receiptSyncStatus",
      "expenseKind",
      "journeyOrigin",
      "journeyDestination",
      "distanceMiles",
      "mileageRatePence",
      "linkedSessionId",
      "isDemo",
    ]),
  };
  if (Object.keys(value).some((key) => !allowedKeys[recordType].has(key))) {
    invalidRequest();
  }

  if (recordType === "practices") {
    if (typeof value.name !== "string" || value.name.trim().length === 0) {
      invalidRequest();
    }
  } else if (recordType === "sessions") {
    if (
      typeof value.practiceId !== "string" ||
      !UUID_PATTERN.test(value.practiceId) ||
      !isIsoDate(value.startsAt) ||
      !isIsoDate(value.endsAt) ||
      Date.parse(value.endsAt) <= Date.parse(value.startsAt) ||
      !Number.isInteger(value.hourlyRatePence) ||
      Number(value.hourlyRatePence) < 0
    ) {
      invalidRequest();
    }
  } else if (recordType === "invoices") {
    if (
      (value.practiceId !== null &&
        (typeof value.practiceId !== "string" ||
          !UUID_PATTERN.test(value.practiceId))) ||
      !(value.paidAt === undefined || value.paidAt === null || isIsoCalendarDate(value.paidAt)) ||
      (value.paidAt !== undefined && value.paidAt !== null && value.status !== "paid")
    ) {
      invalidRequest();
    }
  } else if (recordType === "invoiceItems") {
    if (
      typeof value.invoiceId !== "string" ||
      !UUID_PATTERN.test(value.invoiceId) ||
      typeof value.description !== "string" ||
      value.description.trim().length === 0 ||
      typeof value.quantity !== "number" ||
      value.quantity <= 0 ||
      !Number.isInteger(value.unitRatePence) ||
      Number(value.unitRatePence) < 0 ||
      !Number.isInteger(value.lineTotalPence) ||
      Number(value.lineTotalPence) < 0
    ) {
      invalidRequest();
    }
  } else if (recordType === "settings") {
    const profile = value.profile;
    if (profile !== undefined && !isObject(profile)) invalidRequest();
    if (
      isObject(profile) &&
      ((profile.profession !== undefined &&
        profile.profession !== "gp" &&
        profile.profession !== "pharmacist") ||
        ["doctorName", "tradingName", "address", "email"].some(
          (key) => profile[key] !== undefined && typeof profile[key] !== "string",
        ))
    ) {
      invalidRequest();
    }
    if (
      value.invoicePrefix !== undefined &&
      (typeof value.invoicePrefix !== "string" ||
        !/^[A-Z0-9]{1,10}$/.test(value.invoicePrefix))
    ) invalidRequest();

    const vaultKeys = [
      "ciphertext",
      "salt",
      "initializationVector",
      "kdfParameters",
      "encryptionVersion",
    ] as const;
    const suppliedVaultFields = vaultKeys.filter((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
    if (suppliedVaultFields.length > 0) {
      if (suppliedVaultFields.length !== vaultKeys.length) invalidRequest();
      const validVersion1 =
        typeof value.ciphertext === "string" && value.ciphertext.length > 0 &&
        typeof value.salt === "string" && value.salt.length > 0 &&
        typeof value.initializationVector === "string" && value.initializationVector.length > 0 &&
        isObject(value.kdfParameters) &&
        value.kdfParameters.name === "PBKDF2" &&
        value.kdfParameters.hash === "SHA-256" &&
        Number.isSafeInteger(value.kdfParameters.iterations) &&
        Number(value.kdfParameters.iterations) >= 300_000 &&
        Number(value.kdfParameters.iterations) <= 1_000_000 &&
        value.encryptionVersion === 1;
      const validVersion2 = Boolean(parseServerPaymentEnvelope({
        version: value.encryptionVersion,
        ciphertext: value.ciphertext,
        salt: value.salt,
        initializationVector: value.initializationVector,
        kdfParameters: value.kdfParameters,
      }));
      if (!validVersion1 && !validVersion2) invalidRequest();
    }
  } else if (recordType === "expenseCategories") {
    const parsed = parseExpenseCategoryData(value);
    if (!parsed) invalidRequest();
    return parsed;
  } else if (recordType === "expenses") {
    const parsed = parseExpenseData(value);
    if (
      !parsed ||
      !isExpenseDate(parsed.expenseDate) ||
      (parsed.practiceId !== null && !UUID_PATTERN.test(parsed.practiceId)) ||
      (parsed.customCategoryId !== null &&
        !UUID_PATTERN.test(parsed.customCategoryId))
    ) {
      invalidRequest();
    }
    return parsed;
  }
  return value;
}

function parseMutation(value: unknown): SyncMutation {
  if (!isObject(value)) invalidRequest();
  const operation = value.operation;
  if (operation !== "upsert" && operation !== "delete") invalidRequest();
  if (!isRecordStoreName(value.recordType)) invalidRequest();
  if (typeof value.idempotencyKey !== "string" || !UUID_PATTERN.test(value.idempotencyKey)) {
    invalidRequest();
  }
  if (typeof value.recordId !== "string" || !UUID_PATTERN.test(value.recordId)) {
    invalidRequest();
  }
  if (!Number.isInteger(value.baseRevision) || Number(value.baseRevision) < 0) {
    invalidRequest();
  }
  if (!Number.isInteger(value.localRevision) || Number(value.localRevision) < 1) {
    invalidRequest();
  }
  if (!isIsoDate(value.updatedAt)) invalidRequest();

  return {
    idempotencyKey: value.idempotencyKey,
    recordType: value.recordType,
    recordId: value.recordId,
    operation,
    payload: validatePayload(value.recordType, operation, value.payload),
    baseRevision: Number(value.baseRevision),
    localRevision: Number(value.localRevision),
    updatedAt: value.updatedAt,
  };
}

export function parseSyncBatchRequest(value: unknown): SyncBatchRequest {
  if (!isObject(value) || !Array.isArray(value.mutations)) invalidRequest();
  if (value.mutations.length > 100) invalidRequest();
  if (value.cursor !== null && typeof value.cursor !== "string") invalidRequest();

  return {
    mutations: value.mutations.map(parseMutation),
    cursor: value.cursor,
  };
}

export async function processSyncBatch(
  ownerId: string,
  request: SyncBatchRequest,
  executor: MutationExecutor,
): Promise<SyncBatchResponse> {
  const applied: AppliedMutation[] = [];
  const conflicts: MutationConflict[] = [];

  for (const mutation of request.mutations) {
    const result = await executor.execute(ownerId, mutation);
    if (result.kind === "applied") {
      const { kind: _kind, ...entry } = result;
      void _kind;
      applied.push(entry);
    } else {
      const { kind: _kind, ...entry } = result;
      void _kind;
      conflicts.push(entry);
    }
  }

  const pulledResult = await executor.pull(ownerId, request.cursor);
  return {
    applied,
    conflicts,
    pulled: pulledResult.pulled,
    nextCursor: pulledResult.nextCursor,
  };
}
