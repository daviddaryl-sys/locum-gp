import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLocumDatabase, type LocumDatabase } from "@/offline/db";
import { OfflineRepository } from "@/offline/repository";
import { demoRecordIds } from "../demoFixtures";
import { loadDemoData, removeDemoData } from "../demoDataService";

const databases: LocumDatabase[] = [];
const ownerId = "11111111-1111-4111-8111-111111111111";

async function repository() {
  const database = createLocumDatabase(
    `locum-demo-service-${Date.now()}-${Math.random()}`,
  );
  databases.push(database);
  const repository = new OfflineRepository(database, ownerId);
  await repository.initialize();
  return repository;
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe("demo data service", () => {
  it("loads idempotent owner-scoped records and removes only exact demo IDs", async () => {
    const store = await repository();

    await expect(loadDemoData(store, "2026-08-03")).resolves.toEqual({
      recordCount: 47,
    });
    await expect(loadDemoData(store, "2026-08-03")).resolves.toEqual({
      recordCount: 47,
    });

    const activeBefore = await Promise.all(
      ["practices", "sessions", "invoices", "invoiceItems", "expenses"].map((recordType) =>
        store.tableFor(recordType as never).where("ownerId").equals(ownerId).toArray(),
      ),
    );
    expect(activeBefore.flat().filter((record) => !record.deletedAt)).toHaveLength(
      47,
    );

    await store.saveRecord("practices", crypto.randomUUID(), {
      name: "User-created practice",
    });
    await expect(removeDemoData(store)).resolves.toEqual({ recordCount: 47 });

    const activeAfter = await Promise.all(
      ["practices", "sessions", "invoices", "invoiceItems", "expenses"].map((recordType) =>
        store.tableFor(recordType as never).where("ownerId").equals(ownerId).toArray(),
      ),
    );
    expect(activeAfter.flat().filter((record) => !record.deletedAt)).toHaveLength(1);
    expect(
      activeAfter
        .flat()
        .filter((record) => record.deletedAt)
        .map((record) => record.id),
    ).toHaveLength(47);
  });

  it("refuses removal before mutation when real records depend on demo IDs", async () => {
    const store = await repository();
    await loadDemoData(store, "2026-08-03");
    const ids = await demoRecordIds(ownerId);
    await store.saveRecord("sessions", crypto.randomUUID(), {
      practiceId: ids.practices[0],
      startsAt: "2026-08-20T09:00:00.000Z",
      endsAt: "2026-08-20T13:00:00.000Z",
      hourlyRatePence: 6500,
      status: "planned",
      notes: "User-created session",
    });

    await expect(removeDemoData(store)).rejects.toThrow(
      "Demo data is linked to a non-demo record.",
    );
    expect(
      await store.getRecord("practices", ids.practices[0]),
    ).toMatchObject({ deletedAt: null });
  });
});
