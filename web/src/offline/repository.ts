import type { Table } from "dexie";

import { clearLocumPrivateData, type LocumDatabase } from "./db";
import {
  RECORD_STORES,
  type LocalRecord,
  type OutboxMutation,
  type RecordPayload,
  type ReceiptOperationDraft,
  type RecordStoreName,
  type SaveRecordResult,
  type ReceiptQueueEntry,
  type ReceiptUploadDraft,
  type StoredConflict,
} from "./types";

type RepositoryDependencies = {
  now: () => string;
  uuid: () => string;
};

export type SaveRecordInput = {
  recordType: RecordStoreName;
  id: string;
  data: RecordPayload;
  operation?: "upsert" | "delete";
};

const defaultDependencies: RepositoryDependencies = {
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
};

function receiptVersion(entry: ReceiptQueueEntry) {
  return entry.version ?? 1;
}

function isCurrentReceiptOperation(current: ReceiptQueueEntry | undefined, expected: ReceiptQueueEntry) {
  return current?.operation === expected.operation
    && current.objectKey === expected.objectKey
    && receiptVersion(current) === receiptVersion(expected);
}

export class OfflineRepository {
  private initialized = false;
  private readonly dependencies: RepositoryDependencies;
  private readonly inFlightMutationIds = new Set<string>();

  constructor(
    readonly database: LocumDatabase,
    readonly ownerId: string,
    dependencies: Partial<RepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async initialize() {
    await this.database.transaction(
      "rw",
      [
        this.database.practices,
        this.database.sessions,
        this.database.invoices,
        this.database.invoiceItems,
        this.database.settings,
        this.database.expenseCategories,
        this.database.expenses,
        this.database.syncCursors,
        this.database.conflicts,
        this.database.outbox,
        this.database.metadata,
        this.database.receiptQueue,
      ],
      async () => {
        const activeAccount = await this.database.metadata.get("active-owner");

        if (activeAccount && activeAccount.ownerId !== this.ownerId) {
          await Promise.all([
            ...RECORD_STORES.map((store) =>
              this.database.recordTable(store).clear(),
            ),
            this.database.syncCursors.clear(),
            this.database.conflicts.clear(),
            this.database.outbox.clear(),
            this.database.receiptQueue.clear(),
          ]);
        }

        await this.database.metadata.put({
          key: "active-owner",
          ownerId: this.ownerId,
        });
      },
    );

    this.initialized = true;
  }

  async activeOwnerId() {
    return (await this.database.metadata.get("active-owner"))?.ownerId;
  }

  async saveRecord(
    recordType: RecordStoreName,
    id: string,
    data: RecordPayload,
    operation: "upsert" | "delete" = "upsert",
  ): Promise<SaveRecordResult> {
    const [result] = await this.saveRecordsAtomically([
      { recordType, id, data, operation },
    ]);
    return result;
  }

  async saveRecordsAtomically(
    inputs: SaveRecordInput[],
  ): Promise<SaveRecordResult[]> {
    this.assertInitialized();
    if (inputs.length === 0) return [];
    const recordTables = RECORD_STORES.map((store) =>
      this.database.recordTable(store),
    );

    return this.database.transaction(
      "rw",
      [...recordTables, this.database.outbox],
      async () => {
        const results: SaveRecordResult[] = [];
        for (const input of inputs) {
          const table = this.database.recordTable(input.recordType);
          const existing = await table.get([this.ownerId, input.id]);
          results.push(await this.saveRecordInTransaction(table, input, existing));
        }
        return results;
      },
    );
  }

  async transformRecordAtomically(
    recordType: RecordStoreName,
    id: string,
    transform: (current: LocalRecord | undefined) => RecordPayload,
  ): Promise<SaveRecordResult> {
    this.assertInitialized();
    const table = this.database.recordTable(recordType);
    return this.database.transaction(
      "rw",
      table,
      this.database.outbox,
      async () => {
        const current = await table.get([this.ownerId, id]);
        const data = transform(current);
        return this.saveRecordInTransaction(
          table,
          { recordType, id, data },
          current,
        );
      },
    );
  }

  async applyServerRecordIfSynced(
    recordType: RecordStoreName,
    id: string,
    data: RecordPayload,
    serverRevision: number,
    updatedAt = this.dependencies.now(),
    deletedAt: string | null = null,
  ): Promise<boolean> {
    this.assertInitialized();
    const table = this.database.recordTable(recordType);
    return this.database.transaction("rw", table, async () => {
      const current = await table.get([this.ownerId, id]);
      if (current && current.syncState !== "synced") return false;
      await table.put({
        ownerId: this.ownerId,
        id,
        recordType,
        data,
        localRevision: current?.localRevision ?? 0,
        serverRevision,
        syncState: "synced",
        updatedAt,
        deletedAt,
      });
      return true;
    });
  }

  private async saveRecordInTransaction(
    table: Table<LocalRecord, [string, string]>,
    input: SaveRecordInput,
    existing: LocalRecord | undefined,
  ): Promise<SaveRecordResult> {
    const localRevision = (existing?.localRevision ?? 0) + 1;
    const now = this.dependencies.now();
    const operation = input.operation ?? "upsert";
    const record: LocalRecord = {
      ownerId: this.ownerId,
      id: input.id,
      recordType: input.recordType,
      data: input.data,
      localRevision,
      serverRevision: existing?.serverRevision ?? 0,
      syncState: "pending",
      updatedAt: now,
      deletedAt: operation === "delete" ? now : null,
    };
    const pendingForRecord = operation === "upsert"
      ? await this.database.outbox
        .where("ownerId")
        .equals(this.ownerId)
        .filter((mutation) =>
          mutation.recordType === input.recordType
          && mutation.recordId === input.id
          && mutation.state === "pending"
        )
        .sortBy("localRevision")
      : [];
    const coalescible: OutboxMutation[] = [];
    for (let index = pendingForRecord.length - 1; index >= 0; index -= 1) {
      const pending = pendingForRecord[index];
      if (
        pending.operation !== "upsert"
        || pending.attempts > 0
        || this.inFlightMutationIds.has(pending.id)
      ) break;
      coalescible.unshift(pending);
    }
    const retained = coalescible[0];
    const mutation: OutboxMutation = retained
      ? {
        ...retained,
        payload: input.data,
        localRevision,
        attempts: 0,
        nextAttemptAt: null,
      }
      : {
        ownerId: this.ownerId,
        id: this.dependencies.uuid(),
        recordType: input.recordType,
        recordId: input.id,
        operation,
        payload: input.data,
        baseRevision: record.serverRevision,
        localRevision,
        state: "pending",
        attempts: 0,
        createdAt: now,
        nextAttemptAt: null,
      };

    await table.put(record);
    if (retained) {
      await this.database.outbox.put(mutation);
      await this.database.outbox.bulkDelete(
        coalescible.slice(1).map((superseded) => [this.ownerId, superseded.id]),
      );
    } else {
      await this.database.outbox.add(mutation);
    }
    return { mutation, record };
  }

  async getRecord(recordType: RecordStoreName, id: string) {
    this.assertInitialized();
    return this.database.recordTable(recordType).get([this.ownerId, id]);
  }

  async putServerRecord(
    recordType: RecordStoreName,
    id: string,
    data: RecordPayload,
    serverRevision: number,
    updatedAt = this.dependencies.now(),
    deletedAt: string | null = null,
  ) {
    this.assertInitialized();
    const table = this.database.recordTable(recordType);
    const existing = await table.get([this.ownerId, id]);
    const record: LocalRecord = {
      ownerId: this.ownerId,
      id,
      recordType,
      data,
      localRevision: existing?.localRevision ?? 0,
      serverRevision,
      syncState: "synced",
      updatedAt,
      deletedAt,
    };
    await table.put(record);
    return record;
  }

  async reconcileServerRecord(
    recordType: RecordStoreName,
    id: string,
    serverData: RecordPayload,
    serverRevision: number,
    serverUpdatedAt: string,
    merge: (local: LocalRecord | undefined, server: RecordPayload) => RecordPayload,
  ): Promise<LocalRecord> {
    this.assertInitialized();
    const table = this.database.recordTable(recordType);
    return this.database.transaction(
      "rw",
      table,
      this.database.outbox,
      this.database.conflicts,
      async () => {
        const current = await table.get([this.ownerId, id]);
        const data = merge(current, serverData);
        const supersededMutations = await this.database.outbox
          .where("ownerId")
          .equals(this.ownerId)
          .filter((mutation) =>
            mutation.recordType === recordType &&
            mutation.recordId === id
          )
          .toArray();
        const supersededConflicts = await this.database.conflicts
          .where("ownerId")
          .equals(this.ownerId)
          .filter((conflict) =>
            conflict.recordType === recordType &&
            conflict.recordId === id
          )
          .toArray();
        if (supersededMutations.length) {
          await this.database.outbox.bulkDelete(
            supersededMutations.map((mutation) => [this.ownerId, mutation.id]),
          );
        }
        if (supersededConflicts.length) {
          await this.database.conflicts.bulkDelete(
            supersededConflicts.map((conflict) => [this.ownerId, conflict.id]),
          );
        }

        const changed = JSON.stringify(data) !== JSON.stringify(serverData);
        const localRevision = (current?.localRevision ?? 0) + (changed ? 1 : 0);
        const record: LocalRecord = {
          ownerId: this.ownerId,
          id,
          recordType,
          data,
          localRevision,
          serverRevision,
          syncState: changed ? "pending" : "synced",
          updatedAt: changed ? this.dependencies.now() : serverUpdatedAt,
          deletedAt: null,
        };
        await table.put(record);

        if (changed) {
          await this.database.outbox.add({
            ownerId: this.ownerId,
            id: this.dependencies.uuid(),
            recordType,
            recordId: id,
            operation: "upsert",
            payload: data,
            baseRevision: serverRevision,
            localRevision,
            state: "pending",
            attempts: 0,
            createdAt: this.dependencies.now(),
            nextAttemptAt: null,
          });
        }
        return record;
      },
    );
  }

  async pendingMutations() {
    this.assertInitialized();
    return this.database.outbox
      .where("[ownerId+state]")
      .equals([this.ownerId, "pending"])
      .sortBy("createdAt");
  }

  async claimPendingMutations() {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.outbox, async () => {
      const pending = await this.database.outbox
        .where("[ownerId+state]")
        .equals([this.ownerId, "pending"])
        .sortBy("createdAt");
      const earliestByRecord = new Map<string, OutboxMutation>();
      for (const mutation of pending) {
        const key = `${mutation.recordType}:${mutation.recordId}`;
        const earliest = earliestByRecord.get(key);
        if (!earliest || mutation.localRevision < earliest.localRevision) {
          earliestByRecord.set(key, mutation);
        }
      }
      const claimed = [...earliestByRecord.values()]
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt)
          || left.localRevision - right.localRevision
        )
        .map((mutation) => ({
          ...mutation,
          attempts: mutation.attempts + 1,
          nextAttemptAt: null,
        }));
      await this.database.outbox.bulkPut(claimed);
      return claimed;
    });
  }

  markMutationsInFlight(mutationIds: string[]) {
    this.assertInitialized();
    mutationIds.forEach((mutationId) => this.inFlightMutationIds.add(mutationId));
  }

  releaseMutationsInFlight(mutationIds: string[]) {
    this.assertInitialized();
    mutationIds.forEach((mutationId) => this.inFlightMutationIds.delete(mutationId));
  }

  async queueReceiptUpload(draft: ReceiptUploadDraft) {
    this.assertInitialized();
    const entry: ReceiptQueueEntry = {
      ...draft,
      ownerId: this.ownerId,
      id: this.dependencies.uuid(),
      operation: "upload",
      state: "pending",
      attempts: 0,
      version: 1,
      createdAt: this.dependencies.now(),
    };
    await this.database.receiptQueue.add(entry);
    return entry;
  }

  async saveExpenseWithReceipt(
    id: string,
    data: RecordPayload,
    draft: ReceiptOperationDraft | null,
  ) {
    this.assertInitialized();
    return this.database.transaction(
      "rw",
      [
        ...RECORD_STORES.map((store) => this.database.recordTable(store)),
        this.database.outbox,
        this.database.receiptQueue,
      ],
      async () => {
        const saved = await this.saveRecord("expenses", id, data);
        const supersededKey = !draft
          ? null
          : "operation" in draft
            ? draft.objectKey
            : draft.deleteAfterUploadKey;
        const supersededUpload = supersededKey
          ? await this.database.receiptQueue
            .where("ownerId")
            .equals(this.ownerId)
            .filter((entry) => entry.expenseId === id && entry.operation === "upload" && entry.objectKey === supersededKey && entry.blob !== null)
            .first()
          : undefined;
        let receipt: ReceiptQueueEntry | null = null;
        if (draft && supersededUpload && "operation" in draft) {
          const cleanupKey = supersededUpload.deleteAfterUploadKey;
          await this.database.receiptQueue.delete([this.ownerId, supersededUpload.id]);
          if (cleanupKey) receipt = await this.queueReceiptDeleteIfAbsent(id, cleanupKey);
        } else if (draft && supersededUpload) {
          receipt = {
            ...supersededUpload,
            ...draft,
            operation: "upload",
            deleteAfterUploadKey: supersededUpload.deleteAfterUploadKey,
            state: "pending",
            attempts: 0,
            version: receiptVersion(supersededUpload) + 1,
          };
          await this.database.receiptQueue.put(receipt);
        } else if (draft && "operation" in draft) {
          receipt = await this.queueReceiptDelete(draft.expenseId, draft.objectKey);
        } else if (draft) {
          receipt = await this.queueReceiptUpload(draft);
        }
        return { ...saved, receipt };
      },
    );
  }

  async deleteExpenseWithReceipt(
    id: string,
    data: RecordPayload,
    objectKey: string | null,
  ) {
    this.assertInitialized();
    return this.database.transaction(
      "rw",
      [
        ...RECORD_STORES.map((store) => this.database.recordTable(store)),
        this.database.outbox,
        this.database.receiptQueue,
      ],
      async () => {
        const saved = await this.saveRecord("expenses", id, data, "delete");
        const receipt = objectKey
          ? await this.queueReceiptDelete(id, objectKey)
          : null;
        return { ...saved, receipt };
      },
    );
  }

  async queueReceiptDelete(expenseId: string, objectKey: string) {
    this.assertInitialized();
    const entry: ReceiptQueueEntry = {
      ownerId: this.ownerId,
      id: this.dependencies.uuid(),
      expenseId,
      objectKey,
      operation: "delete",
      originalName: "",
      mimeType: "application/pdf",
      sizeBytes: 0,
      blob: null,
      deleteAfterUploadKey: null,
      state: "pending",
      attempts: 0,
      version: 1,
      createdAt: this.dependencies.now(),
    };
    await this.database.receiptQueue.add(entry);
    return entry;
  }

  async pendingReceiptOperations() {
    this.assertInitialized();
    return this.database.receiptQueue
      .where("ownerId")
      .equals(this.ownerId)
      .filter((entry) => entry.state === "pending" || entry.state === "failed")
      .sortBy("createdAt");
  }

  async acknowledgeReceiptOperation(id: string, expectedVersion?: number) {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.receiptQueue, async () => {
      const entry = await this.database.receiptQueue.get([this.ownerId, id]);
      if (!entry || (expectedVersion !== undefined && receiptVersion(entry) !== expectedVersion)) return false;
      await this.database.receiptQueue.delete([this.ownerId, id]);
      return true;
    });
  }

  async replaceReceiptUploadWithDelete(id: string) {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.receiptQueue, async () => {
      const entry = await this.database.receiptQueue.get([this.ownerId, id]);
      if (!entry || entry.operation !== "upload" || !entry.deleteAfterUploadKey) {
        throw new Error("Receipt replacement deletion is unavailable.");
      }
      const deletion: ReceiptQueueEntry = {
        ...entry,
        objectKey: entry.deleteAfterUploadKey,
        operation: "delete",
        originalName: "",
        mimeType: "application/pdf",
        sizeBytes: 0,
        blob: null,
        deleteAfterUploadKey: null,
        state: "pending",
        version: receiptVersion(entry) + 1,
      };
      await this.database.receiptQueue.put(deletion);
      return deletion;
    });
  }

  async failReceiptOperation(id: string, expectedVersion?: number) {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.receiptQueue, async () => {
      const entry = await this.database.receiptQueue.get([this.ownerId, id]);
      if (!entry || (expectedVersion !== undefined && receiptVersion(entry) !== expectedVersion)) return false;
      await this.database.receiptQueue.put({ ...entry, state: "failed", attempts: entry.attempts + 1 });
      return true;
    });
  }

  async queueReceiptDeleteIfAbsent(expenseId: string, objectKey: string) {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.receiptQueue, async () => {
      const existing = await this.database.receiptQueue
        .where("ownerId")
        .equals(this.ownerId)
        .filter((entry) => entry.expenseId === expenseId && entry.operation === "delete" && entry.objectKey === objectKey)
        .first();
      return existing ?? this.queueReceiptDelete(expenseId, objectKey);
    });
  }

  async completeReceiptUpload(
    entry: ReceiptQueueEntry,
    response: { data: RecordPayload; revision: number; updatedAt: string },
  ): Promise<{ state: "completed"; cleanup: ReceiptQueueEntry | null } | { state: "stale" | "deferred" }> {
    this.assertInitialized();
    return this.database.transaction("rw", this.database.expenses, this.database.receiptQueue, async () => {
      const current = await this.database.receiptQueue.get([this.ownerId, entry.id]);
      if (!current || !isCurrentReceiptOperation(current, entry)) return { state: "stale" };
      const expense = await this.database.expenses.get([this.ownerId, entry.expenseId]);
      if (!expense || expense.syncState !== "synced") return { state: "deferred" };
      await this.database.expenses.put({
        ...expense,
        data: response.data,
        serverRevision: response.revision,
        syncState: "synced",
        updatedAt: response.updatedAt,
      });
      if (!current.deleteAfterUploadKey) {
        await this.database.receiptQueue.delete([this.ownerId, entry.id]);
        return { state: "completed", cleanup: null };
      }
      const cleanup: ReceiptQueueEntry = {
        ...current,
        objectKey: current.deleteAfterUploadKey,
        operation: "delete",
        originalName: "",
        mimeType: "application/pdf",
        sizeBytes: 0,
        blob: null,
        deleteAfterUploadKey: null,
        state: "pending",
        version: receiptVersion(current) + 1,
      };
      await this.database.receiptQueue.put(cleanup);
      return { state: "completed", cleanup };
    });
  }

  async acknowledgeMutation(
    mutationId: string,
    serverRevision: number,
    serverData?: RecordPayload,
    serverUpdatedAt = this.dependencies.now(),
  ) {
    this.assertInitialized();
    const mutationBeforeTransaction = await this.database.outbox.get([
      this.ownerId,
      mutationId,
    ]);
    if (!mutationBeforeTransaction) return;

    const table = this.database.recordTable(mutationBeforeTransaction.recordType);
    await this.database.transaction(
      "rw",
      table,
      this.database.outbox,
      async () => {
        const mutation = await this.database.outbox.get([this.ownerId, mutationId]);
        if (!mutation) return;
        const record = await table.get([this.ownerId, mutation.recordId]);
        await this.database.outbox.delete([this.ownerId, mutationId]);

        if (record?.localRevision === mutation.localRevision) {
          await table.put({
            ...record,
            data: serverData ?? record.data,
            serverRevision,
            syncState: "synced",
            updatedAt: serverUpdatedAt,
          });
          return;
        }

        const [nextMutation] = await this.database.outbox
          .where("ownerId")
          .equals(this.ownerId)
          .filter((candidate) =>
            candidate.recordType === mutation.recordType
            && candidate.recordId === mutation.recordId
            && candidate.state === "pending"
            && candidate.localRevision > mutation.localRevision
          )
          .sortBy("localRevision");
        if (record && nextMutation) {
          await Promise.all([
            table.put({ ...record, serverRevision }),
            this.database.outbox.put({ ...nextMutation, baseRevision: serverRevision }),
          ]);
        }
      },
    );
  }

  async recordConflict(conflict: StoredConflict) {
    this.assertInitialized();
    const table = this.database.recordTable(conflict.recordType);
    await this.database.transaction(
      "rw",
      table,
      this.database.conflicts,
      this.database.outbox,
      async () => {
        const record = await table.get([this.ownerId, conflict.recordId]);
        const mutation = await this.database.outbox.get([
          this.ownerId,
          conflict.mutationId,
        ]);
        if (!mutation) return;
        const newerPending = mutation
          ? await this.database.outbox
            .where("ownerId")
            .equals(this.ownerId)
            .filter((candidate) =>
              candidate.recordType === conflict.recordType
              && candidate.recordId === conflict.recordId
              && candidate.state === "pending"
              && candidate.localRevision > mutation.localRevision
            )
            .toArray()
          : [];
        const canFoldNewerUpserts = newerPending.length > 0
          && newerPending.every((candidate) =>
            candidate.operation === "upsert"
            && candidate.attempts === 0
            && !this.inFlightMutationIds.has(candidate.id)
          );
        if (record) await table.put({ ...record, syncState: "conflict" });
        await this.database.conflicts.put(
          record && canFoldNewerUpserts
            ? {
              ...conflict,
              localData: record.data,
              localUpdatedAt: record.updatedAt,
            }
            : conflict,
        );
        if (canFoldNewerUpserts) {
          await this.database.outbox.bulkDelete(
            newerPending.map((candidate) => [this.ownerId, candidate.id]),
          );
        }
        if (mutation) {
          await this.database.outbox.put({ ...mutation, state: "conflict" });
        }
      },
    );
  }

  async conflicts() {
    this.assertInitialized();
    return this.database.conflicts.where("ownerId").equals(this.ownerId).toArray();
  }

  async syncCursor() {
    this.assertInitialized();
    return (await this.database.syncCursors.get(this.ownerId))?.cursor ?? null;
  }

  async setSyncCursor(cursor: string | null) {
    this.assertInitialized();
    await this.database.syncCursors.put({
      ownerId: this.ownerId,
      cursor,
      updatedAt: this.dependencies.now(),
    });
  }

  async markMutationAttempt(mutationId: string, nextAttemptAt: string | null) {
    this.assertInitialized();
    await this.database.outbox
      .where("[ownerId+id]")
      .equals([this.ownerId, mutationId])
      .modify((mutation) => {
        mutation.attempts += 1;
        mutation.nextAttemptAt = nextAttemptAt;
      });
  }

  async clearPrivateCache() {
    this.assertInitialized();
    await clearLocumPrivateData(this.database);
    this.initialized = false;
  }

  tableFor(recordType: RecordStoreName): Table<LocalRecord, [string, string]> {
    return this.database.recordTable(recordType);
  }

  private assertInitialized() {
    if (!this.initialized) {
      throw new Error("OfflineRepository must be initialized before use.");
    }
  }
}
