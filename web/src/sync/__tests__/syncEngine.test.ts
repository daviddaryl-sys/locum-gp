import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocumDatabase, type LocumDatabase } from "@/offline/db";
import { OfflineRepository } from "@/offline/repository";
import type { OutboxMutation, RecordPayload } from "@/offline/types";
import { resolveConflict, SyncEngine, SyncTransportError } from "../client";
import {
  parseSyncBatchRequest,
  processSyncBatch,
  type MutationExecutor,
  type SyncMutation,
  type SyncMutationResult,
} from "../protocol";

const MUTATION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_MUTATION_ID = "22222222-2222-4222-8222-222222222222";
const databases: LocumDatabase[] = [];

function createRepository(
  ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  mutationIds = [MUTATION_ID],
) {
  const database = createLocumDatabase(
    `locum-sync-${Date.now()}-${Math.random()}`,
  );
  databases.push(database);
  const ids = [...mutationIds];
  const repository = new OfflineRepository(database, ownerId, {
    now: () => "2026-08-01T09:00:00.000Z",
    uuid: () => ids.shift()!,
  });
  return { database, repository };
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

function successfulResponse(overrides = {}) {
  return {
    applied: [],
    conflicts: [],
    pulled: [],
    nextCursor: "2026-08-01T09:01:00.000Z",
    ...overrides,
  };
}

describe("SyncEngine", () => {
  it("uploads one combined mutation for an unsynced edit followed by repeated session moves", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const { repository } = createRepository(undefined, [
      MUTATION_ID,
      SECOND_MUTATION_ID,
      "55555555-5555-4555-8555-555555555555",
    ]);
    await repository.initialize();
    await repository.putServerRecord("sessions", sessionId, {
      practiceId: "44444444-4444-4444-8444-444444444444",
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
      hourlyRatePence: 9000,
      status: "completed",
      notes: "original",
      isDemo: false,
    }, 4);
    await repository.saveRecord("sessions", sessionId, {
      ...(await repository.getRecord("sessions", sessionId))!.data,
      notes: "offline note",
    });
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-13T08:00:00.000Z",
      endsAt: "2026-08-13T16:00:00.000Z",
    }));
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-14T08:00:00.000Z",
      endsAt: "2026-08-14T16:00:00.000Z",
    }));
    const executor = new MemoryMutationExecutor();
    executor.records.set(`sessions:${sessionId}`, {
      data: { notes: "original" },
      revision: 4,
    });
    const transport = vi.fn((request) => processSyncBatch(repository.ownerId, request, executor));

    await new SyncEngine({ repository, transport, isOnline: () => true }).syncNow();

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      mutations: [expect.objectContaining({
        baseRevision: 4,
        localRevision: 3,
        payload: expect.objectContaining({
          notes: "offline note",
          startsAt: "2026-08-14T08:00:00.000Z",
          endsAt: "2026-08-14T16:00:00.000Z",
        }),
      })],
    }));
    expect(executor.records.get(`sessions:${sessionId}`)).toMatchObject({
      revision: 5,
      data: expect.objectContaining({
        notes: "offline note",
        startsAt: "2026-08-14T08:00:00.000Z",
      }),
    });
    expect(await repository.conflicts()).toHaveLength(0);
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("rebases a newer session move saved while its previous mutation is in flight", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const { repository } = createRepository(undefined, [MUTATION_ID, SECOND_MUTATION_ID]);
    await repository.initialize();
    await repository.putServerRecord("sessions", sessionId, {
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
      notes: "original",
    }, 4);
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-13T08:00:00.000Z",
      endsAt: "2026-08-13T16:00:00.000Z",
    }));
    const executor = new MemoryMutationExecutor();
    executor.records.set(`sessions:${sessionId}`, {
      data: { startsAt: "2026-08-12T08:00:00.000Z" },
      revision: 4,
    });
    let releaseFirstRequest!: () => void;
    const firstRequestStarted = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
    let continueFirstRequest!: () => void;
    const firstRequestCanFinish = new Promise<void>((resolve) => { continueFirstRequest = resolve; });
    const transport = vi.fn(async (request) => {
      if (transport.mock.calls.length === 1) {
        releaseFirstRequest();
        await firstRequestCanFinish;
      }
      return processSyncBatch(repository.ownerId, request, executor);
    });
    const engine = new SyncEngine({ repository, transport, isOnline: () => true });

    const firstSync = engine.syncNow();
    await firstRequestStarted;
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-14T08:00:00.000Z",
      endsAt: "2026-08-14T16:00:00.000Z",
    }));
    continueFirstRequest();
    await firstSync;

    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({ id: SECOND_MUTATION_ID, baseRevision: 5 }),
    ]);
    await engine.syncNow();

    expect(executor.records.get(`sessions:${sessionId}`)).toMatchObject({
      revision: 6,
      data: expect.objectContaining({ startsAt: "2026-08-14T08:00:00.000Z" }),
    });
    expect(await repository.conflicts()).toHaveLength(0);
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("atomically claims a mutation before another repository instance saves a newer move", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const { database, repository } = createRepository(undefined, [MUTATION_ID]);
    const otherRepository = new OfflineRepository(database, repository.ownerId, {
      now: () => "2026-08-01T09:00:30.000Z",
      uuid: () => SECOND_MUTATION_ID,
    });
    await repository.initialize();
    await otherRepository.initialize();
    await repository.putServerRecord("sessions", sessionId, {
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
      notes: "original",
    }, 4);
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-13T08:00:00.000Z",
      endsAt: "2026-08-13T16:00:00.000Z",
    }));
    const claimRepository = repository as OfflineRepository & {
      claimPendingMutations(): Promise<OutboxMutation[]>;
    };
    const claimPendingMutations = claimRepository.claimPendingMutations.bind(repository);
    let claimFinished!: () => void;
    const claimed = new Promise<void>((resolve) => { claimFinished = resolve; });
    let releaseClaim!: () => void;
    const claimCanReturn = new Promise<void>((resolve) => { releaseClaim = resolve; });
    vi.spyOn(claimRepository, "claimPendingMutations").mockImplementation(async () => {
      const snapshot = await claimPendingMutations();
      claimFinished();
      await claimCanReturn;
      return snapshot;
    });
    const executor = new MemoryMutationExecutor();
    executor.records.set(`sessions:${sessionId}`, {
      data: { startsAt: "2026-08-12T08:00:00.000Z", notes: "original" },
      revision: 4,
    });
    const transport = vi.fn((request) => processSyncBatch(repository.ownerId, request, executor));
    const engine = new SyncEngine({ repository, transport, isOnline: () => true });

    const firstSync = engine.syncNow();
    await claimed;
    const newer = await otherRepository.transformRecordAtomically(
      "sessions",
      sessionId,
      (current) => ({
        ...current!.data,
        startsAt: "2026-08-14T08:00:00.000Z",
        endsAt: "2026-08-14T16:00:00.000Z",
      }),
    );
    releaseClaim();
    await firstSync;

    expect(transport.mock.calls[0][0].mutations).toEqual([
      expect.objectContaining({
        idempotencyKey: MUTATION_ID,
        localRevision: 1,
        payload: expect.objectContaining({ startsAt: "2026-08-13T08:00:00.000Z" }),
      }),
    ]);
    expect(newer.mutation.id).toBe(SECOND_MUTATION_ID);
    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({
        id: SECOND_MUTATION_ID,
        baseRevision: 5,
        localRevision: 2,
        payload: expect.objectContaining({ startsAt: "2026-08-14T08:00:00.000Z" }),
      }),
    ]);

    await engine.syncNow();
    expect(executor.records.get(`sessions:${sessionId}`)).toMatchObject({
      revision: 6,
      data: expect.objectContaining({ startsAt: "2026-08-14T08:00:00.000Z" }),
    });
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("keeps the latest session move when an older in-flight mutation conflicts", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const { repository } = createRepository(undefined, [MUTATION_ID, SECOND_MUTATION_ID]);
    await repository.initialize();
    await repository.putServerRecord("sessions", sessionId, {
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
      notes: "original",
    }, 4);
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-13T08:00:00.000Z",
      endsAt: "2026-08-13T16:00:00.000Z",
    }));
    const executor = new MemoryMutationExecutor();
    executor.records.set(`sessions:${sessionId}`, {
      data: { startsAt: "2026-08-15T08:00:00.000Z", notes: "cloud edit" },
      revision: 5,
    });
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    let finishRequest!: () => void;
    const canFinish = new Promise<void>((resolve) => { finishRequest = resolve; });
    const transport = vi.fn(async (request) => {
      requestStarted();
      await canFinish;
      return processSyncBatch(repository.ownerId, request, executor);
    });
    const engine = new SyncEngine({ repository, transport, isOnline: () => true });

    const sync = engine.syncNow();
    await started;
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-14T08:00:00.000Z",
      endsAt: "2026-08-14T16:00:00.000Z",
    }));
    finishRequest();
    await sync;

    expect(await repository.pendingMutations()).toHaveLength(0);
    expect(await repository.conflicts()).toEqual([
      expect.objectContaining({
        mutationId: MUTATION_ID,
        localData: expect.objectContaining({ startsAt: "2026-08-14T08:00:00.000Z" }),
        serverRevision: 5,
      }),
    ]);
  });

  it("does not reuse a mutation identifier after an ambiguous delivery", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const { repository } = createRepository(undefined, [MUTATION_ID, SECOND_MUTATION_ID]);
    await repository.initialize();
    await repository.putServerRecord("sessions", sessionId, {
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T16:00:00.000Z",
      notes: "original",
    }, 4);
    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      notes: "offline note",
    }));
    const executor = new MemoryMutationExecutor();
    executor.records.set(`sessions:${sessionId}`, { data: { notes: "original" }, revision: 4 });
    const ambiguousTransport = vi.fn(async (request) => {
      await processSyncBatch(repository.ownerId, request, executor);
      throw new SyncTransportError(503);
    });
    await new SyncEngine({
      repository,
      transport: ambiguousTransport,
      isOnline: () => true,
      maxAttempts: 1,
    }).syncNow();

    await repository.transformRecordAtomically("sessions", sessionId, (current) => ({
      ...current!.data,
      startsAt: "2026-08-14T08:00:00.000Z",
      endsAt: "2026-08-14T16:00:00.000Z",
    }));
    const transport = vi.fn((request) => processSyncBatch(repository.ownerId, request, executor));
    const engine = new SyncEngine({ repository, transport, isOnline: () => true });
    await engine.syncNow();

    expect(transport.mock.calls[0][0].mutations).toEqual([
      expect.objectContaining({ idempotencyKey: MUTATION_ID, localRevision: 1 }),
    ]);
    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({ id: SECOND_MUTATION_ID, baseRevision: 5, localRevision: 2 }),
    ]);

    await engine.syncNow();
    expect(executor.records.get(`sessions:${sessionId}`)).toMatchObject({
      revision: 6,
      data: expect.objectContaining({
        notes: "offline note",
        startsAt: "2026-08-14T08:00:00.000Z",
      }),
    });
    expect(await repository.conflicts()).toHaveLength(0);
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("keeps edits queued while offline and uploads them after reconnect", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.saveRecord("practices", "practice-1", {
      name: "Riverside Medical Centre",
    });
    let online = false;
    const transport = vi.fn().mockResolvedValue(
      successfulResponse({
        applied: [
          {
            mutationId: MUTATION_ID,
            recordType: "practices",
            recordId: "practice-1",
            serverRevision: 1,
            data: { name: "Riverside Medical Centre" },
            updatedAt: "2026-08-01T09:01:00.000Z",
          },
        ],
      }),
    );
    const engine = new SyncEngine({
      repository,
      transport,
      isOnline: () => online,
    });

    await engine.syncNow();
    expect(engine.status).toBe("offline");
    expect(transport).not.toHaveBeenCalled();
    expect(await repository.pendingMutations()).toHaveLength(1);

    online = true;
    await engine.syncNow();
    expect(engine.status).toBe("synced");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        mutations: [expect.objectContaining({ idempotencyKey: MUTATION_ID })],
      }),
    );
    expect(await repository.pendingMutations()).toHaveLength(0);
  });

  it("never removes an outbox item without a server acknowledgement", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.saveRecord("sessions", "session-1", {
      startsAt: "2026-08-01T09:00:00.000Z",
    });
    const engine = new SyncEngine({
      repository,
      transport: vi.fn().mockResolvedValue(successfulResponse()),
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(await repository.pendingMutations()).toHaveLength(1);
    expect(engine.status).toBe("saving");
  });

  it("records server revision conflicts and requires GP action", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.saveRecord("practices", "practice-1", {
      name: "Local name",
    });
    const engine = new SyncEngine({
      repository,
      transport: vi.fn().mockResolvedValue(
        successfulResponse({
          conflicts: [
            {
              mutationId: MUTATION_ID,
              recordType: "practices",
              recordId: "practice-1",
              localData: { name: "Local name" },
              localUpdatedAt: "2026-08-01T09:00:00.000Z",
              serverData: { name: "Cloud name" },
              serverRevision: 3,
              serverUpdatedAt: "2026-08-01T09:00:30.000Z",
            },
          ],
        }),
      ),
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(engine.status).toBe("action-required");
    expect(await repository.conflicts()).toEqual([
      expect.objectContaining({
        mutationId: MUTATION_ID,
        serverRevision: 3,
      }),
    ]);
    expect(await repository.pendingMutations()).toHaveLength(0);
    expect(repository.database.outbox.count()).resolves.toBe(1);

    const [storedConflict] = await repository.conflicts();
    await resolveConflict(repository, storedConflict, "local", {
      now: () => "2026-08-01T09:07:00.000Z",
      uuid: () => SECOND_MUTATION_ID,
    });

    expect(await repository.conflicts()).toHaveLength(0);
    expect(await repository.pendingMutations()).toEqual([
      expect.objectContaining({
        id: SECOND_MUTATION_ID,
        baseRevision: 3,
        payload: { name: "Local name" },
      }),
    ]);
  });

  it("uses bounded exponential backoff for transient failures", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.saveRecord("invoices", "invoice-1", { status: "draft" });
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new SyncTransportError(503))
      .mockRejectedValueOnce(new SyncTransportError(503))
      .mockResolvedValue(
        successfulResponse({
          applied: [
            {
              mutationId: MUTATION_ID,
              recordType: "invoices",
              recordId: "invoice-1",
              serverRevision: 1,
              data: { status: "draft" },
              updatedAt: "2026-08-01T09:01:00.000Z",
            },
          ],
        }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new SyncEngine({
      repository,
      transport,
      sleep,
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(transport).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
    expect(engine.status).toBe("synced");
  });

  it("pauses immediately on authentication failure", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.saveRecord("settings", "bank", { ciphertext: "encrypted" });
    const transport = vi.fn().mockRejectedValue(new SyncTransportError(401));
    const sleep = vi.fn();
    const engine = new SyncEngine({
      repository,
      transport,
      sleep,
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(engine.status).toBe("action-required");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(await repository.pendingMutations()).toHaveLength(1);
  });

  it("stores pulled records and sends the persisted cursor next time", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        successfulResponse({
          pulled: [
            {
              recordType: "sessions",
              recordId: "cloud-session",
              data: { status: "completed" },
              serverRevision: 8,
              updatedAt: "2026-08-01T09:02:00.000Z",
            },
          ],
          nextCursor: "cursor-8",
        }),
      )
      .mockResolvedValueOnce(successfulResponse({ nextCursor: "cursor-9" }));
    const engine = new SyncEngine({
      repository,
      transport,
      isOnline: () => true,
    });

    await engine.syncNow();
    await engine.syncNow();

    expect(
      await repository.getRecord("sessions", "cloud-session"),
    ).toMatchObject({ serverRevision: 8, syncState: "synced" });
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-8" }),
    );
  });

  it("cannot overwrite a local transform that starts while a pulled record is applied", async () => {
    const { repository } = createRepository();
    await repository.initialize();
    await repository.putServerRecord("sessions", "session-1", {
      startsAt: "2026-08-12T08:00:00.000Z",
      notes: "original",
    }, 1);
    const applyServerRecord = repository.applyServerRecordIfSynced.bind(repository);
    const atomicPull = vi.spyOn(repository, "applyServerRecordIfSynced")
      .mockImplementation(async (...args) => {
        const pull = applyServerRecord(...args);
        const move = repository.transformRecordAtomically(
          "sessions",
          "session-1",
          (current) => ({
            ...current!.data,
            startsAt: "2026-08-13T08:00:00.000Z",
          }),
        );
        const [applied] = await Promise.all([pull, move]);
        return applied;
      });
    const engine = new SyncEngine({
      repository,
      transport: vi.fn().mockResolvedValue(successfulResponse({
        pulled: [{
          recordType: "sessions",
          recordId: "session-1",
          data: {
            startsAt: "2026-08-12T08:00:00.000Z",
            notes: "pulled",
          },
          serverRevision: 2,
          updatedAt: "2026-08-12T09:00:00.000Z",
        }],
      })),
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(atomicPull).toHaveBeenCalledOnce();
    expect(await repository.getRecord("sessions", "session-1")).toMatchObject({
      data: {
        startsAt: "2026-08-13T08:00:00.000Z",
        notes: "pulled",
      },
      serverRevision: 2,
      syncState: "pending",
    });
    expect(await repository.pendingMutations()).toHaveLength(1);
  });

  it("uploads a durable queue after a simulated application restart", async () => {
    const databaseName = `sync-restart-${Date.now()}-${Math.random()}`;
    const firstDatabase = createLocumDatabase(databaseName);
    databases.push(firstDatabase);
    const firstRepository = new OfflineRepository(firstDatabase, "owner-a", {
      uuid: () => SECOND_MUTATION_ID,
    });
    await firstRepository.initialize();
    await firstRepository.saveRecord("invoices", "invoice-2", { status: "draft" });
    firstDatabase.close();

    const reopenedDatabase = createLocumDatabase(databaseName);
    databases.push(reopenedDatabase);
    const reopenedRepository = new OfflineRepository(reopenedDatabase, "owner-a");
    await reopenedRepository.initialize();
    const transport = vi.fn().mockResolvedValue(
      successfulResponse({
        applied: [
          {
            mutationId: SECOND_MUTATION_ID,
            recordType: "invoices",
            recordId: "invoice-2",
            serverRevision: 1,
            data: { status: "draft" },
            updatedAt: "2026-08-01T09:03:00.000Z",
          },
        ],
      }),
    );

    await new SyncEngine({
      repository: reopenedRepository,
      transport,
      isOnline: () => true,
    }).syncNow();

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        mutations: [expect.objectContaining({ idempotencyKey: SECOND_MUTATION_ID })],
      }),
    );
    expect(await reopenedRepository.pendingMutations()).toHaveLength(0);
  });
});

class MemoryMutationExecutor implements MutationExecutor {
  readonly receipts = new Map<string, SyncMutationResult>();
  readonly records = new Map<string, { data: RecordPayload; revision: number }>();
  applyCount = 0;

  async execute(_ownerId: string, mutation: SyncMutation) {
    const duplicate = this.receipts.get(mutation.idempotencyKey);
    if (duplicate) return duplicate;

    const key = `${mutation.recordType}:${mutation.recordId}`;
    const current = this.records.get(key);
    if ((current?.revision ?? 0) !== mutation.baseRevision) {
      const conflict: SyncMutationResult = {
        kind: "conflict",
        mutationId: mutation.idempotencyKey,
        recordType: mutation.recordType,
        recordId: mutation.recordId,
        localData: mutation.payload,
        localUpdatedAt: mutation.updatedAt,
        serverData: current?.data ?? {},
        serverRevision: current?.revision ?? 0,
        serverUpdatedAt: "2026-08-01T09:05:00.000Z",
      };
      this.receipts.set(mutation.idempotencyKey, conflict);
      return conflict;
    }

    this.applyCount += 1;
    const revision = (current?.revision ?? 0) + 1;
    this.records.set(key, { data: mutation.payload, revision });
    const applied: SyncMutationResult = {
      kind: "applied",
      mutationId: mutation.idempotencyKey,
      recordType: mutation.recordType,
      recordId: mutation.recordId,
      data: mutation.payload,
      serverRevision: revision,
      updatedAt: "2026-08-01T09:05:00.000Z",
    };
    this.receipts.set(mutation.idempotencyKey, applied);
    return applied;
  }

  async pull() {
    return { pulled: [], nextCursor: null };
  }
}

describe("authenticated batch protocol", () => {
  it("accepts a payment-received date and rejects an invalid calendar date", () => {
    const mutation = {
      idempotencyKey: MUTATION_ID,
      recordType: "invoices",
      recordId: "33333333-3333-4333-8333-333333333333",
      operation: "upsert",
      payload: {
        invoiceNumber: "INV-2026-0001",
        status: "paid",
        practiceId: null,
        issueDate: "2026-08-01",
        dueDate: "2026-08-31",
        paidAt: "2026-08-20",
        totalPence: 45000,
        practiceSnapshot: null,
        paymentSnapshot: null,
        issuedAt: "2026-08-01T12:00:00.000Z",
        artifactPath: null,
        isDemo: false,
      },
      baseRevision: 0,
      localRevision: 1,
      updatedAt: "2026-08-20T09:00:00.000Z",
    } as const;

    expect(parseSyncBatchRequest({ cursor: null, mutations: [mutation] }).mutations[0].payload.paidAt).toBe("2026-08-20");
    expect(() => parseSyncBatchRequest({
      cursor: null,
      mutations: [{ ...mutation, payload: { ...mutation.payload, paidAt: "2026-02-30" } }],
    })).toThrow(/invalid sync request/i);
  });

  it("accepts a normalized expense payload", () => {
    const request = parseSyncBatchRequest({
      cursor: null,
      mutations: [
        {
          idempotencyKey: MUTATION_ID,
          recordType: "expenses",
          recordId: "33333333-3333-4333-8333-333333333333",
          operation: "upsert",
          payload: {
            expenseDate: "2026-05-10",
            amountPence: 4500,
            categoryKey: "professional_training",
            customCategoryId: null,
            mtdCategory: "professional_fees",
            allowablePercentage: 75,
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
          },
          baseRevision: 0,
          localRevision: 1,
          updatedAt: "2026-08-01T09:00:00.000Z",
        },
      ],
    });

    expect(request.mutations[0].payload).toMatchObject({
      amountPence: 4500,
      categoryKey: "professional_training",
      customCategoryId: null,
      mtdCategory: "professional_fees",
      allowablePercentage: 75,
    });
  });

  it.each([
    ["owner fields", { ownerId: "somebody-else" }],
    ["two category sources", { customCategoryId: "category-id" }],
    ["a non-positive amount", { amountPence: 0 }],
    ["an invalid practice ID", { practiceId: "not-a-uuid" }],
    ["an unknown receipt status", { receiptSyncStatus: "unknown" }],
    ["an unknown MTD category", { mtdCategory: "unknown" }],
    ["an invalid allowable percentage", { allowablePercentage: 101 }],
  ])("rejects expense payloads containing %s", (_label, override) => {
    expect(() =>
      parseSyncBatchRequest({
        cursor: null,
        mutations: [
          {
            idempotencyKey: MUTATION_ID,
            recordType: "expenses",
            recordId: "33333333-3333-4333-8333-333333333333",
            operation: "upsert",
            payload: {
              expenseDate: "2026-05-10",
              amountPence: 4500,
              categoryKey: "professional_training",
              customCategoryId: null,
              mtdCategory: "professional_fees",
              allowablePercentage: 75,
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
              ...override,
            },
            baseRevision: 0,
            localRevision: 1,
            updatedAt: "2026-08-01T09:00:00.000Z",
          },
        ],
      }),
    ).toThrow(/invalid sync request/i);
  });

  it("applies one idempotency key at most once", async () => {
    const executor = new MemoryMutationExecutor();
    const request = parseSyncBatchRequest({
      cursor: null,
      mutations: [
        {
          idempotencyKey: MUTATION_ID,
          recordType: "practices",
          recordId: "33333333-3333-4333-8333-333333333333",
          operation: "upsert",
          payload: { name: "Riverside Medical Centre" },
          baseRevision: 0,
          localRevision: 1,
          updatedAt: "2026-08-01T09:00:00.000Z",
        },
      ],
    });

    const first = await processSyncBatch("owner-a", request, executor);
    const duplicate = await processSyncBatch("owner-a", request, executor);

    expect(executor.applyCount).toBe(1);
    expect(duplicate.applied).toEqual(first.applied);
  });

  it("returns a conflict when the base revision is stale", async () => {
    const executor = new MemoryMutationExecutor();
    executor.records.set(
      "practices:33333333-3333-4333-8333-333333333333",
      { data: { name: "Cloud" }, revision: 4 },
    );
    const request = parseSyncBatchRequest({
      cursor: null,
      mutations: [
        {
          idempotencyKey: MUTATION_ID,
          recordType: "practices",
          recordId: "33333333-3333-4333-8333-333333333333",
          operation: "upsert",
          payload: { name: "Local" },
          baseRevision: 3,
          localRevision: 1,
          updatedAt: "2026-08-01T09:00:00.000Z",
        },
      ],
    });

    const response = await processSyncBatch("owner-a", request, executor);

    expect(response.conflicts).toEqual([
      expect.objectContaining({ serverData: { name: "Cloud" }, serverRevision: 4 }),
    ]);
    expect(executor.applyCount).toBe(0);
  });

  it("rejects malformed mutation payloads before execution", () => {
    expect(() =>
      parseSyncBatchRequest({
        cursor: null,
        mutations: [
          {
            idempotencyKey: MUTATION_ID,
            recordType: "practices",
            recordId: "not-a-uuid",
            operation: "upsert",
            payload: { ownerId: "somebody-else" },
            baseRevision: -1,
            localRevision: 0,
            updatedAt: "not-a-date",
          },
        ],
      }),
    ).toThrow(/invalid sync request/i);
  });
});
