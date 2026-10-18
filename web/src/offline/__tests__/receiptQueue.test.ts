import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocumDatabase, type LocumDatabase } from "../db";
import { OfflineRepository } from "../repository";
import { fetchReceiptOperation, flushReceiptQueue } from "../receiptQueue";

const databases: LocumDatabase[] = [];

function repository(ownerId = "owner-a") {
  const database = createLocumDatabase(`receipts-${Date.now()}-${Math.random()}`);
  databases.push(database);
  return new OfflineRepository(database, ownerId, {
    now: () => "2026-08-02T12:00:00.000Z",
    uuid: () => crypto.randomUUID(),
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe("private receipt queue", () => {
  it("uploads an IndexedDB receipt as a raw typed body without multipart encoding", async () => {
    const blob = new Blob(["private receipt"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {},
      revision: 2,
      updatedAt: "2026-08-10T20:16:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchReceiptOperation({
      ownerId: "owner-a",
      id: "queue-1",
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/receipt.pdf",
      operation: "upload",
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: blob.size,
      blob,
      deleteAfterUploadKey: null,
      state: "failed",
      attempts: 1,
      version: 2,
      createdAt: "2026-08-10T20:15:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/expenses/expense-1/receipt",
      expect.objectContaining({
        body: blob,
        headers: {
          "Content-Type": "application/pdf",
          "X-Receipt-Object-Key": "owner-a%2Fexpense-1%2Freceipt.pdf",
          "X-Receipt-Original-Name": "receipt.pdf",
        },
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[0][1].body).not.toBeInstanceOf(FormData);
  });

  it("atomically saves and tombstones expenses with receipt operations", async () => {
    const repo = repository();
    await repo.initialize();
    const blob = new Blob(["x"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/receipt.pdf" },
      {
        expenseId: "expense-1",
        objectKey: "owner-a/expense-1/receipt.pdf",
        originalName: "receipt.pdf",
        mimeType: "application/pdf",
        sizeBytes: blob.size,
        blob,
        deleteAfterUploadKey: null,
      },
    );
    expect(await repo.getRecord("expenses", "expense-1")).toMatchObject({
      syncState: "pending",
    });
    expect(await repo.pendingMutations()).toHaveLength(1);
    expect(await repo.pendingReceiptOperations()).toHaveLength(1);

    await repo.deleteExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/receipt.pdf" },
      "owner-a/expense-1/receipt.pdf",
    );
    expect(await repo.getRecord("expenses", "expense-1")).toMatchObject({
      deletedAt: "2026-08-02T12:00:00.000Z",
    });
    expect(await repo.pendingReceiptOperations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "delete",
          objectKey: "owner-a/expense-1/receipt.pdf",
        }),
      ]),
    );
  });

  it("persists a 10 MiB PDF and clears it when the account changes", async () => {
    const first = repository();
    await first.initialize();
    const blob = new NodeBlob([new Uint8Array(10 * 1024 * 1024)], {
      type: "application/pdf",
    }) as Blob;
    await first.queueReceiptUpload({
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/receipt.pdf",
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: blob.size,
      blob,
      deleteAfterUploadKey: null,
    });
    expect((await first.pendingReceiptOperations())[0].blob?.size).toBe(10485760);

    const second = new OfflineRepository(first.database, "owner-b");
    await second.initialize();
    expect(await first.database.receiptQueue.count()).toBe(0);
  });

  it("clears private business rows and queued receipt blobs on sign-out", async () => {
    const repo = repository();
    await repo.initialize();
    await repo.saveRecord("expenses", "expense-1", { receiptObjectKey: "owner-a/expense-1/receipt.pdf" });
    await repo.queueReceiptUpload({
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/receipt.pdf",
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blob: new Blob(["private receipt"], { type: "application/pdf" }),
      deleteAfterUploadKey: null,
    });

    await repo.clearPrivateCache();

    expect(await repo.database.expenses.count()).toBe(0);
    expect(await repo.database.outbox.count()).toBe(0);
    expect(await repo.database.receiptQueue.count()).toBe(0);
    expect(await repo.database.metadata.count()).toBe(0);
  });

  it("cancels an unsent receipt upload instead of queuing a stale delete", async () => {
    const repo = repository();
    await repo.initialize();
    const oldBlob = new Blob(["old receipt"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/old.pdf", receiptSyncStatus: "pending" },
      {
        expenseId: "expense-1",
        objectKey: "owner-a/expense-1/old.pdf",
        originalName: "old.pdf",
        mimeType: "application/pdf",
        sizeBytes: oldBlob.size,
        blob: oldBlob,
        deleteAfterUploadKey: null,
      },
    );

    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: null, receiptSyncStatus: "none" },
      { operation: "delete", expenseId: "expense-1", objectKey: "owner-a/expense-1/old.pdf" },
    );

    expect(await repo.pendingReceiptOperations()).toEqual([]);
    expect(await repo.database.receiptQueue.count()).toBe(0);
  });

  it("transforms an unsent receipt upload into its replacement without retaining the old blob", async () => {
    const repo = repository();
    await repo.initialize();
    const oldBlob = new Blob(["old receipt"], { type: "application/pdf" });
    const first = await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/old.pdf", receiptSyncStatus: "pending" },
      {
        expenseId: "expense-1",
        objectKey: "owner-a/expense-1/old.pdf",
        originalName: "old.pdf",
        mimeType: "application/pdf",
        sizeBytes: oldBlob.size,
        blob: oldBlob,
        deleteAfterUploadKey: null,
      },
    );
    const replacementBlob = new Blob(["replacement receipt"], { type: "application/pdf" });

    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/replacement.pdf", receiptSyncStatus: "pending" },
      {
        expenseId: "expense-1",
        objectKey: "owner-a/expense-1/replacement.pdf",
        originalName: "replacement.pdf",
        mimeType: "application/pdf",
        sizeBytes: replacementBlob.size,
        blob: replacementBlob,
        deleteAfterUploadKey: "owner-a/expense-1/old.pdf",
      },
    );

    expect(await repo.pendingReceiptOperations()).toEqual([expect.objectContaining({
      id: first.receipt?.id,
      operation: "upload",
      objectKey: "owner-a/expense-1/replacement.pdf",
      deleteAfterUploadKey: null,
    })]);
    expect(await repo.database.receiptQueue.count()).toBe(1);
  });

  it("carries the original uploaded receipt cleanup through a pending replacement chain", async () => {
    const repo = repository();
    await repo.initialize();
    const b = new Blob(["B"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: b.size, blob: b, deleteAfterUploadKey: "owner-a/expense-1/a.pdf" },
    );
    const c = new Blob(["C"], { type: "application/pdf" });

    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/c.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/c.pdf", originalName: "c.pdf", mimeType: "application/pdf", sizeBytes: c.size, blob: c, deleteAfterUploadKey: "owner-a/expense-1/b.pdf" },
    );

    expect(await repo.pendingReceiptOperations()).toEqual([expect.objectContaining({
      objectKey: "owner-a/expense-1/c.pdf",
      deleteAfterUploadKey: "owner-a/expense-1/a.pdf",
    })]);
  });

  it("queues the original uploaded receipt cleanup when removing a pending replacement", async () => {
    const repo = repository();
    await repo.initialize();
    const b = new Blob(["B"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: b.size, blob: b, deleteAfterUploadKey: "owner-a/expense-1/a.pdf" },
    );

    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: null, receiptSyncStatus: "none" },
      { operation: "delete", expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf" },
    );

    expect(await repo.pendingReceiptOperations()).toEqual([expect.objectContaining({
      operation: "delete",
      objectKey: "owner-a/expense-1/a.pdf",
    })]);
  });

  it("does not let a completed stale upload overwrite a newer replacement", async () => {
    const repo = repository();
    await repo.initialize();
    const b = new Blob(["B"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: b.size, blob: b, deleteAfterUploadKey: "owner-a/expense-1/a.pdf" },
    );
    await repo.putServerRecord("expenses", "expense-1", { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" }, 1);
    let resolveUpload: ((value: { data: Record<string, unknown>; revision: number; updatedAt: string }) => void) | undefined;
    const transport = vi.fn(() => new Promise<{ data: Record<string, unknown>; revision: number; updatedAt: string }>((resolve) => { resolveUpload = resolve; }));
    const flushing = flushReceiptQueue(repo, transport);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const c = new Blob(["C"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/c.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/c.pdf", originalName: "c.pdf", mimeType: "application/pdf", sizeBytes: c.size, blob: c, deleteAfterUploadKey: "owner-a/expense-1/b.pdf" },
    );
    resolveUpload?.({ data: { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "uploaded" }, revision: 2, updatedAt: "2026-08-02T12:01:00.000Z" });
    await flushing;

    expect(await repo.getRecord("expenses", "expense-1")).toMatchObject({ data: { receiptObjectKey: "owner-a/expense-1/c.pdf" }, syncState: "pending" });
    expect(await repo.pendingReceiptOperations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "upload", objectKey: "owner-a/expense-1/c.pdf", deleteAfterUploadKey: "owner-a/expense-1/a.pdf" }),
      expect.objectContaining({ operation: "delete", objectKey: "owner-a/expense-1/b.pdf" }),
    ]));
  });

  it("queues cleanup when a removed in-flight upload completes", async () => {
    const repo = repository();
    await repo.initialize();
    const b = new Blob(["B"], { type: "application/pdf" });
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" },
      { expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: b.size, blob: b, deleteAfterUploadKey: "owner-a/expense-1/a.pdf" },
    );
    await repo.putServerRecord("expenses", "expense-1", { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "pending" }, 1);
    let resolveUpload: ((value: { data: Record<string, unknown>; revision: number; updatedAt: string }) => void) | undefined;
    const transport = vi.fn(() => new Promise<{ data: Record<string, unknown>; revision: number; updatedAt: string }>((resolve) => { resolveUpload = resolve; }));
    const flushing = flushReceiptQueue(repo, transport);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    await repo.saveExpenseWithReceipt(
      "expense-1",
      { receiptObjectKey: null, receiptSyncStatus: "none" },
      { operation: "delete", expenseId: "expense-1", objectKey: "owner-a/expense-1/b.pdf" },
    );
    resolveUpload?.({ data: { receiptObjectKey: "owner-a/expense-1/b.pdf", receiptSyncStatus: "uploaded" }, revision: 2, updatedAt: "2026-08-02T12:01:00.000Z" });
    await flushing;

    expect(await repo.getRecord("expenses", "expense-1")).toMatchObject({ data: { receiptObjectKey: null }, syncState: "pending" });
    expect(await repo.pendingReceiptOperations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "delete", objectKey: "owner-a/expense-1/a.pdf" }),
      expect.objectContaining({ operation: "delete", objectKey: "owner-a/expense-1/b.pdf" }),
    ]));
  });

  it("waits for record sync and reuses the same object key on retry", async () => {
    const repo = repository();
    await repo.initialize();
    await repo.saveRecord("expenses", "expense-1", { receiptSyncStatus: "pending" });
    await repo.queueReceiptUpload({
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/stable.pdf",
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blob: new Blob(["x"], { type: "application/pdf" }),
      deleteAfterUploadKey: null,
    });
    const transport = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await flushReceiptQueue(repo, transport)).toEqual({
      uploaded: 0, deleted: 0, failed: 0,
    });
    expect(transport).not.toHaveBeenCalled();

    await repo.putServerRecord("expenses", "expense-1", { receiptSyncStatus: "pending" }, 1);
    expect(await flushReceiptQueue(repo, transport)).toEqual({
      uploaded: 0, deleted: 0, failed: 1,
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "owner-a/expense-1/stable.pdf",
    }));
    expect((await repo.pendingReceiptOperations())[0].objectKey).toBe(
      "owner-a/expense-1/stable.pdf",
    );
  });

  it("deletes the replaced key only after the new upload succeeds", async () => {
    const repo = repository();
    await repo.initialize();
    await repo.putServerRecord("expenses", "expense-1", {}, 1);
    await repo.queueReceiptUpload({
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/new.pdf",
      originalName: "new.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blob: new Blob(["x"], { type: "application/pdf" }),
      deleteAfterUploadKey: "owner-a/expense-1/old.pdf",
    });
    const operations: string[] = [];
    const transport = vi.fn(async (entry: { operation: string; objectKey: string }) => {
      operations.push(`${entry.operation}:${entry.objectKey}`);
      return entry.operation === "upload"
        ? { data: {}, revision: 2, updatedAt: "2026-08-02T12:01:00.000Z" }
        : null;
    });
    expect(await flushReceiptQueue(repo, transport)).toEqual({
      uploaded: 1, deleted: 1, failed: 0,
    });
    expect(operations).toEqual([
      "upload:owner-a/expense-1/new.pdf",
      "delete:owner-a/expense-1/old.pdf",
    ]);
    expect(await repo.pendingReceiptOperations()).toEqual([]);
  });

  it("retries only the old-key deletion after a replacement upload succeeds", async () => {
    const repo = repository();
    await repo.initialize();
    await repo.putServerRecord("expenses", "expense-1", {}, 1);
    await repo.queueReceiptUpload({
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/new.pdf",
      originalName: "new.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blob: new Blob(["x"], { type: "application/pdf" }),
      deleteAfterUploadKey: "owner-a/expense-1/old.pdf",
    });
    let deleteFails = true;
    const operations: string[] = [];
    const transport = vi.fn(async (entry: { operation: string; objectKey: string }) => {
      operations.push(`${entry.operation}:${entry.objectKey}`);
      if (entry.operation === "upload") return { data: {}, revision: 2, updatedAt: "2026-08-02T12:01:00.000Z" };
      if (deleteFails) throw new Error("old object is temporarily unavailable");
      return null;
    });

    expect(await flushReceiptQueue(repo, transport)).toEqual({ uploaded: 1, deleted: 0, failed: 1 });
    expect(await repo.pendingReceiptOperations()).toEqual([expect.objectContaining({
      operation: "delete",
      objectKey: "owner-a/expense-1/old.pdf",
      blob: null,
    })]);

    deleteFails = false;
    operations.length = 0;
    expect(await flushReceiptQueue(repo, transport)).toEqual({ uploaded: 0, deleted: 1, failed: 0 });
    expect(operations).toEqual(["delete:owner-a/expense-1/old.pdf"]);
    expect(await repo.pendingReceiptOperations()).toEqual([]);
  });
});
