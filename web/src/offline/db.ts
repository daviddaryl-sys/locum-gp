import Dexie, { type EntityTable, type Table } from "dexie";

import {
  RECORD_STORES,
  type AccountMetadata,
  type LocalRecord,
  type OutboxMutation,
  type ReceiptQueueEntry,
  type RecordStoreName,
  type StoredConflict,
  type SyncCursor,
} from "./types";

type RecordTable = Table<LocalRecord, [string, string]>;

export class LocumDatabase extends Dexie {
  practices!: EntityTable<LocalRecord, "id">;
  sessions!: EntityTable<LocalRecord, "id">;
  invoices!: EntityTable<LocalRecord, "id">;
  invoiceItems!: EntityTable<LocalRecord, "id">;
  settings!: EntityTable<LocalRecord, "id">;
  expenseCategories!: EntityTable<LocalRecord, "id">;
  expenses!: EntityTable<LocalRecord, "id">;
  syncCursors!: EntityTable<SyncCursor, "ownerId">;
  conflicts!: Table<StoredConflict, [string, string]>;
  outbox!: Table<OutboxMutation, [string, string]>;
  metadata!: EntityTable<AccountMetadata, "key">;
  receiptQueue!: Table<ReceiptQueueEntry, [string, string]>;

  constructor(name = "locum-manager") {
    super(name);

    this.version(1).stores({
      practices:
        "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      sessions: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      invoices: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      invoiceItems:
        "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      settings: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      syncCursors: "&ownerId, updatedAt",
      conflicts: "[ownerId+id], ownerId, id, recordId, createdAt",
      outbox:
        "[ownerId+id], ownerId, id, [ownerId+state], recordId, createdAt",
      metadata: "&key",
    });

    this.version(2).stores({
      practices:
        "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      sessions: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      invoices: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      invoiceItems:
        "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      settings: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      expenseCategories:
        "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      expenses: "[ownerId+id], ownerId, id, [ownerId+syncState], updatedAt",
      syncCursors: "&ownerId, updatedAt",
      conflicts: "[ownerId+id], ownerId, id, recordId, createdAt",
      outbox:
        "[ownerId+id], ownerId, id, [ownerId+state], recordId, createdAt",
      metadata: "&key",
    });

    this.version(3).stores({
      receiptQueue:
        "[ownerId+id], ownerId, expenseId, [ownerId+state], createdAt",
    });

    this.version(4).stores({
      receiptQueue:
        "[ownerId+id], ownerId, expenseId, [ownerId+state], createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("receiptQueue").toCollection().modify((entry) => {
        entry.version ??= 1;
      });
    });
  }

  recordTable(name: RecordStoreName): RecordTable {
    return this.table(name) as RecordTable;
  }
}

export function createLocumDatabase(name?: string) {
  return new LocumDatabase(name);
}

export async function clearLocumPrivateData(database: LocumDatabase) {
  await database.transaction(
    "rw",
    [
      database.practices,
      database.sessions,
      database.invoices,
      database.invoiceItems,
      database.settings,
      database.expenseCategories,
      database.expenses,
      database.syncCursors,
      database.conflicts,
      database.outbox,
      database.metadata,
      database.receiptQueue,
    ],
    async () => {
      await Promise.all([
        ...RECORD_STORES.map((store) => database.recordTable(store).clear()),
        database.syncCursors.clear(),
        database.conflicts.clear(),
        database.outbox.clear(),
        database.receiptQueue.clear(),
        database.metadata.clear(),
      ]);
    },
  );
}

export async function clearLocumPrivateDatabase(name = "locum-manager") {
  const database = createLocumDatabase(name);
  try {
    await clearLocumPrivateData(database);
  } finally {
    database.close();
  }
}
