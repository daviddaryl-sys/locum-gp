import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLocumDatabase, type LocumDatabase } from "../db";
import { OfflineRepository } from "../repository";

const databaseNames: string[] = [];
const openDatabases: LocumDatabase[] = [];

function nextDatabaseName() {
  const name = `locum-restart-${Date.now()}-${Math.random()}`;
  databaseNames.push(name);
  return name;
}

afterEach(async () => {
  openDatabases.splice(0).forEach((database) => database.close());
  await Promise.all(
    databaseNames.splice(0).map(async (name) => {
      const database = createLocumDatabase(name);
      await database.delete();
    }),
  );
});

describe("offline restart recovery", () => {
  it("recovers an expense and its outbox mutation after reopening", async () => {
    const databaseName = nextDatabaseName();
    const expenseId = "33333333-3333-4333-8333-333333333333";
    const firstDatabase = createLocumDatabase(databaseName);
    openDatabases.push(firstDatabase);
    const firstRepository = new OfflineRepository(firstDatabase, "owner-a", {
      uuid: () => "expense-mutation-before-restart",
    });
    await firstRepository.initialize();
    const saved = await firstRepository.saveRecord("expenses", expenseId, {
      expenseDate: "2026-05-10",
      amountPence: 4500,
      categoryKey: "professional_training",
      customCategoryId: null,
      practiceId: null,
      supplierDescription: "Fictional course material",
      notes: null,
      reimbursedByPractice: false,
      needsAccountantReview: true,
      receiptObjectKey: null,
      receiptOriginalName: null,
      receiptMimeType: null,
      receiptSizeBytes: null,
      receiptSyncStatus: "none",
      isDemo: false,
    });
    expect(saved.mutation.recordType).toBe("expenses");
    firstDatabase.close();

    const reopenedDatabase = createLocumDatabase(databaseName);
    openDatabases.push(reopenedDatabase);
    const reopened = new OfflineRepository(reopenedDatabase, "owner-a");
    await reopened.initialize();

    expect((await reopened.getRecord("expenses", expenseId))?.data.amountPence).toBe(
      4500,
    );
    expect(await reopened.pendingMutations()).toEqual([
      expect.objectContaining({ recordType: "expenses", recordId: expenseId }),
    ]);
  });

  it("recovers local records and pending mutations after reopening", async () => {
    const databaseName = nextDatabaseName();
    const firstDatabase = createLocumDatabase(databaseName);
    openDatabases.push(firstDatabase);
    const firstRepository = new OfflineRepository(firstDatabase, "owner-a", {
      uuid: () => "mutation-before-restart",
    });
    await firstRepository.initialize();
    await firstRepository.saveRecord("invoices", "invoice-1", {
      status: "draft",
      totalPence: 125000,
    });
    firstDatabase.close();

    const reopenedDatabase = createLocumDatabase(databaseName);
    openDatabases.push(reopenedDatabase);
    const reopenedRepository = new OfflineRepository(
      reopenedDatabase,
      "owner-a",
    );
    await reopenedRepository.initialize();

    expect(
      await reopenedRepository.getRecord("invoices", "invoice-1"),
    ).toMatchObject({
      data: { status: "draft", totalPence: 125000 },
      syncState: "pending",
    });
    expect(await reopenedRepository.pendingMutations()).toEqual([
      expect.objectContaining({ id: "mutation-before-restart" }),
    ]);
  });

  it("clears the prior GP cache and outbox when the account changes", async () => {
    const databaseName = nextDatabaseName();
    const database = createLocumDatabase(databaseName);
    openDatabases.push(database);
    const firstAccount = new OfflineRepository(database, "owner-a", {
      uuid: () => "owner-a-mutation",
    });
    await firstAccount.initialize();
    await firstAccount.saveRecord("settings", "profile", {
      displayName: "Dr A",
    });

    const secondAccount = new OfflineRepository(database, "owner-b");
    await secondAccount.initialize();

    expect(await firstAccount.getRecord("settings", "profile")).toBeUndefined();
    expect(await database.outbox.count()).toBe(0);
    expect(await secondAccount.activeOwnerId()).toBe("owner-b");
  });
});
