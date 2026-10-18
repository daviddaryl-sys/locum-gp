import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLocumDatabase, type LocumDatabase } from "../db";
import { OfflineRepository } from "../repository";

const databases: LocumDatabase[] = [];

function testDatabase() {
  const db = createLocumDatabase(
    `locum-repository-${Date.now()}-${Math.random()}`,
  );
  databases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe("OfflineRepository", () => {
  it("atomically saves a pending record and a stable outbox mutation", async () => {
    const database = testDatabase();
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-01T09:00:00.000Z",
      uuid: () => "mutation-1",
    });
    await repository.initialize();

    const result = await repository.saveRecord("practices", "practice-1", {
      name: "Riverside Medical Centre",
    });

    expect(result.record).toMatchObject({
      id: "practice-1",
      localRevision: 1,
      ownerId: "owner-a",
      serverRevision: 0,
      syncState: "pending",
    });
    expect(result.mutation).toMatchObject({
      baseRevision: 0,
      id: "mutation-1",
      localRevision: 1,
      ownerId: "owner-a",
      recordId: "practice-1",
      recordType: "practices",
      state: "pending",
    });

    await database.transaction(
      "r",
      database.practices,
      database.outbox,
      async () => {
        expect(await database.practices.get(["owner-a", "practice-1"])).toEqual(
          result.record,
        );
        expect(await database.outbox.get(["owner-a", "mutation-1"])).toEqual(
          result.mutation,
        );
      },
    );
  });

  it("coalesces repeated pending upserts into the latest full payload at the earliest cloud base", async () => {
    const database = testDatabase();
    const ids = ["mutation-1", "mutation-2", "mutation-3"];
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-01T09:00:00.000Z",
      uuid: () => ids.shift()!,
    });
    await repository.initialize();

    await repository.putServerRecord("sessions", "session-1", {
      durationMinutes: 480,
    }, 4, "2026-07-31T12:00:00.000Z");
    const first = await repository.saveRecord("sessions", "session-1", {
      durationMinutes: 510,
    });
    const second = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-13T08:00:00.000Z" }),
    );
    const third = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-14T08:00:00.000Z" }),
    );

    expect(first.record.localRevision).toBe(1);
    expect(first.mutation.baseRevision).toBe(4);
    expect(second.record.localRevision).toBe(2);
    expect(second.mutation.baseRevision).toBe(4);
    expect(third.record.localRevision).toBe(3);
    expect(third.mutation).toMatchObject({
      id: "mutation-1",
      baseRevision: 4,
      localRevision: 3,
      payload: {
        durationMinutes: 510,
        startsAt: "2026-08-14T08:00:00.000Z",
      },
    });
    expect(await repository.pendingMutations()).toEqual([third.mutation]);
  });

  it("atomically transforms the latest record into a pending local mutation", async () => {
    const database = testDatabase();
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-01T09:00:00.000Z",
      uuid: () => "mutation-transform",
    });
    await repository.initialize();
    await repository.putServerRecord("sessions", "session-1", {
      startsAt: "2026-08-12T08:00:00.000Z",
      notes: "latest server note",
      unrelated: { preserve: true },
    }, 7);

    const result = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => {
        expect(current?.serverRevision).toBe(7);
        return {
          ...current!.data,
          startsAt: "2026-08-13T08:00:00.000Z",
        };
      },
    );

    expect(result.record).toMatchObject({
      data: {
        startsAt: "2026-08-13T08:00:00.000Z",
        notes: "latest server note",
        unrelated: { preserve: true },
      },
      serverRevision: 7,
      syncState: "pending",
    });
    expect(result.mutation).toMatchObject({
      baseRevision: 7,
      payload: result.record.data,
    });
  });

  it("rolls back an atomic transform when its updater rejects the latest record", async () => {
    const database = testDatabase();
    const repository = new OfflineRepository(database, "owner-a", {
      uuid: () => "unused-mutation",
    });
    await repository.initialize();
    await repository.putServerRecord("sessions", "session-1", { status: "invoiced" }, 3);

    await expect(repository.transformRecordAtomically(
      "sessions",
      "session-1",
      () => { throw new Error("Session cannot be moved."); },
    )).rejects.toThrow("Session cannot be moved.");

    expect(await repository.getRecord("sessions", "session-1")).toMatchObject({
      data: { status: "invoiced" },
      serverRevision: 3,
      syncState: "synced",
    });
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("keeps a local transform when server pull and local write serialize in either order", async () => {
    const exerciseOrder = async (serverFirst: boolean) => {
      const database = testDatabase();
      const repository = new OfflineRepository(database, "owner-a", {
        uuid: () => `mutation-${serverFirst ? "server-first" : "local-first"}`,
      });
      await repository.initialize();
      await repository.putServerRecord("sessions", "session-1", {
        startsAt: "2026-08-12T08:00:00.000Z",
        notes: "original",
      }, 1);

      const applyServer = () => repository.applyServerRecordIfSynced(
        "sessions",
        "session-1",
        {
          startsAt: "2026-08-12T08:00:00.000Z",
          notes: "pulled before move",
        },
        2,
        "2026-08-12T09:00:00.000Z",
      );
      const moveLocal = () => repository.transformRecordAtomically(
        "sessions",
        "session-1",
        (current) => ({
          ...current!.data,
          startsAt: "2026-08-13T08:00:00.000Z",
        }),
      );

      const pullApplied = serverFirst
        ? await applyServer().then(async (applied) => { await moveLocal(); return applied; })
        : await moveLocal().then(() => applyServer());

      expect(await repository.getRecord("sessions", "session-1")).toMatchObject({
        data: {
          startsAt: "2026-08-13T08:00:00.000Z",
          notes: serverFirst ? "pulled before move" : "original",
        },
        syncState: "pending",
      });
      expect(pullApplied).toBe(serverFirst);
    };

    await exerciseOrder(true);
    await exerciseOrder(false);
  });

  it("does not fold a newer attempted upsert into an older conflict", async () => {
    const database = testDatabase();
    const ids = ["mutation-old", "mutation-new"];
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-12T09:00:00.000Z",
      uuid: () => ids.shift()!,
    });
    await repository.initialize();
    await repository.putServerRecord("sessions", "session-1", {
      startsAt: "2026-08-12T08:00:00.000Z",
    }, 4);
    const old = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-13T08:00:00.000Z" }),
    );
    repository.markMutationsInFlight([old.mutation.id]);
    const newer = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-14T08:00:00.000Z" }),
    );
    repository.releaseMutationsInFlight([old.mutation.id]);
    await repository.markMutationAttempt(newer.mutation.id, null);

    await repository.recordConflict({
      ownerId: "owner-a",
      id: old.mutation.id,
      mutationId: old.mutation.id,
      recordType: "sessions",
      recordId: "session-1",
      localData: old.mutation.payload,
      serverData: { startsAt: "2026-08-15T08:00:00.000Z" },
      serverRevision: 5,
      localUpdatedAt: old.mutation.createdAt,
      serverUpdatedAt: "2026-08-12T09:01:00.000Z",
      createdAt: "2026-08-12T09:01:00.000Z",
    });

    expect(await repository.conflicts()).toEqual([
      expect.objectContaining({
        mutationId: "mutation-old",
        localData: { startsAt: "2026-08-13T08:00:00.000Z" },
      }),
    ]);
    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({
        id: "mutation-new",
        attempts: 1,
        payload: { startsAt: "2026-08-14T08:00:00.000Z" },
      }),
    ]);
    expect(await database.outbox.get(["owner-a", "mutation-old"])).toMatchObject({
      state: "conflict",
    });
  });

  it("does not fold a newer active in-flight upsert into an older conflict", async () => {
    const database = testDatabase();
    const ids = ["mutation-old", "mutation-new"];
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-12T09:00:00.000Z",
      uuid: () => ids.shift()!,
    });
    await repository.initialize();
    await repository.putServerRecord("sessions", "session-1", {
      startsAt: "2026-08-12T08:00:00.000Z",
    }, 4);
    const old = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-13T08:00:00.000Z" }),
    );
    repository.markMutationsInFlight([old.mutation.id]);
    const newer = await repository.transformRecordAtomically(
      "sessions",
      "session-1",
      (current) => ({ ...current!.data, startsAt: "2026-08-14T08:00:00.000Z" }),
    );
    repository.releaseMutationsInFlight([old.mutation.id]);
    repository.markMutationsInFlight([newer.mutation.id]);

    await repository.recordConflict({
      ownerId: "owner-a",
      id: old.mutation.id,
      mutationId: old.mutation.id,
      recordType: "sessions",
      recordId: "session-1",
      localData: old.mutation.payload,
      serverData: { startsAt: "2026-08-15T08:00:00.000Z" },
      serverRevision: 5,
      localUpdatedAt: old.mutation.createdAt,
      serverUpdatedAt: "2026-08-12T09:01:00.000Z",
      createdAt: "2026-08-12T09:01:00.000Z",
    });
    repository.releaseMutationsInFlight([newer.mutation.id]);

    expect(await repository.conflicts()).toEqual([
      expect.objectContaining({
        mutationId: "mutation-old",
        localData: { startsAt: "2026-08-13T08:00:00.000Z" },
      }),
    ]);
    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({
        id: "mutation-new",
        attempts: 0,
        payload: { startsAt: "2026-08-14T08:00:00.000Z" },
      }),
    ]);
    expect(await database.outbox.get(["owner-a", "mutation-old"])).toMatchObject({
      state: "conflict",
    });
  });

  it("rolls back the record write when the outbox append fails", async () => {
    const database = testDatabase();
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-01T09:00:00.000Z",
      uuid: () => "duplicate-id",
    });
    await repository.initialize();

    await repository.saveRecord("practices", "practice-1", { name: "Original" }, "delete");
    await expect(
      repository.saveRecord("practices", "practice-1", { name: "Changed" }),
    ).rejects.toThrow();

    const saved = await repository.getRecord("practices", "practice-1");
    expect(saved).toMatchObject({
      data: { name: "Original" },
      localRevision: 1,
    });
    expect(await repository.pendingMutations()).toHaveLength(1);
  });

  it("atomically saves a multi-store batch and rolls all records back on failure", async () => {
    const database = testDatabase();
    const ids = ["mutation-1", "mutation-2"];
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-03T09:00:00.000Z",
      uuid: () => ids.shift()!,
    });
    await repository.initialize();

    const saved = await repository.saveRecordsAtomically([
      {
        recordType: "practices",
        id: "practice-1",
        data: { name: "Demo practice" },
      },
      {
        recordType: "sessions",
        id: "session-1",
        data: { practiceId: "practice-1" },
      },
    ]);

    expect(saved).toHaveLength(2);
    expect(await repository.pendingMutations()).toHaveLength(2);
    expect(await repository.getRecord("practices", "practice-1")).toBeTruthy();
    expect(await repository.getRecord("sessions", "session-1")).toBeTruthy();

    const failingRepository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-03T10:00:00.000Z",
      uuid: () => "duplicate-mutation",
    });
    await failingRepository.initialize();
    await expect(
      failingRepository.saveRecordsAtomically([
        {
          recordType: "practices",
          id: "practice-2",
          data: { name: "First write" },
        },
        {
          recordType: "sessions",
          id: "session-2",
          data: { practiceId: "practice-2" },
        },
      ]),
    ).rejects.toThrow();

    expect(await repository.getRecord("practices", "practice-2")).toBeUndefined();
    expect(await repository.getRecord("sessions", "session-2")).toBeUndefined();
  });
});
