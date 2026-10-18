import "fake-indexeddb/auto";

import { afterEach, expect, it } from "vitest";

import { mergeProfession } from "@/domain/profession";
import { profileSettingPayload, type ProfileInput } from "@/features/settings/ProfileForm";
import { parseSyncBatchRequest } from "@/sync/protocol";
import { createLocumDatabase, type LocumDatabase } from "../db";
import { OfflineRepository } from "../repository";

const databases: LocumDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

const profileInput: ProfileInput = {
  doctorName: "Alex Example",
  tradingName: "Example Locums",
  address: "1 Example Road",
  email: "alex@example.test",
  invoicePrefix: "INV",
  accountName: "Alex Example",
  sortCode: "12-34-56",
  accountNumber: "12345678",
  passcode: "fictional secure passcode",
};

const vault = {
  version: 1 as const,
  ciphertext: "opaque-ciphertext",
  salt: "opaque-salt",
  initializationVector: "opaque-iv",
  kdfParameters: { name: "PBKDF2" as const, hash: "SHA-256" as const, iterations: 310000 },
};

it("coalesces interleaved profession and vault transforms into one valid pending payload", async () => {
  const database = createLocumDatabase(
    `locum-settings-${Date.now()}-${Math.random()}`,
  );
  databases.push(database);
  const repository = new OfflineRepository(database, "owner-a", {
    now: () => "2026-08-08T09:00:00.000Z",
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  await repository.initialize();
  await repository.putServerRecord(
    "settings",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    { profile: { doctorName: "Original Name" }, invoicePrefix: "OLD" },
    3,
  );

  let releaseEncryption: () => void = () => undefined;
  const encryptionFinished = new Promise<void>((resolve) => {
    releaseEncryption = resolve;
  });
  const delayedVaultSave = encryptionFinished.then(() =>
    repository.transformRecordAtomically(
      "settings",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      (current) => profileSettingPayload(profileInput, vault, current?.data ?? {}),
    ),
  );

  await repository.transformRecordAtomically(
    "settings",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    (current) => mergeProfession(current?.data ?? {}, "pharmacist"),
  );
  releaseEncryption();
  await delayedVaultSave;

  const [mutation] = await repository.pendingMutations();
  expect(mutation.payload).toMatchObject({
    profile: { profession: "pharmacist", doctorName: "Alex Example" },
    invoicePrefix: "INV",
    ciphertext: "opaque-ciphertext",
  });
  expect(mutation.baseRevision).toBe(3);
  expect(mutation.localRevision).toBe(2);

  expect(() =>
    parseSyncBatchRequest({
      cursor: null,
      mutations: [
        {
          idempotencyKey: mutation.id,
          recordType: mutation.recordType,
          recordId: mutation.recordId,
          operation: mutation.operation,
          payload: mutation.payload,
          baseRevision: mutation.baseRevision,
          localRevision: mutation.localRevision,
          updatedAt: mutation.createdAt,
        },
      ],
    }),
  ).not.toThrow();
});

it("rebases an interleaved profession save onto a canonical server payment record", async () => {
  const database = createLocumDatabase(`locum-settings-reconcile-${Date.now()}-${Math.random()}`);
  databases.push(database);
  const mutationIds = [
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ];
  const repository = new OfflineRepository(database, "owner-a", {
    now: () => "2026-08-09T12:00:00.000Z",
    uuid: () => mutationIds.shift() ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  await repository.initialize();
  await repository.putServerRecord("settings", "owner-a", {
    profile: { ...profileInput, profession: "gp" },
    invoicePrefix: "INV",
  }, 4);
  const professionSave = await repository.transformRecordAtomically("settings", "owner-a", (current) =>
    mergeProfession(current?.data ?? {}, "pharmacist"));

  await repository.recordConflict({
    ownerId: "owner-a",
    id: professionSave.mutation.id,
    recordType: "settings",
    recordId: "owner-a",
    mutationId: professionSave.mutation.id,
    localData: professionSave.record.data,
    serverData: { profile: { profession: "gp" } },
    serverRevision: 5,
    localUpdatedAt: professionSave.record.updatedAt,
    serverUpdatedAt: "2026-08-09T11:59:00.000Z",
    createdAt: "2026-08-09T11:59:30.000Z",
  });
  expect(await repository.conflicts()).toHaveLength(1);

  await repository.reconcileServerRecord(
    "settings",
    "owner-a",
    {
      profile: { doctorName: "Alex Example", profession: "gp" },
      invoicePrefix: "INV",
      ciphertext: "server-v2-ciphertext",
      salt: "server-v2-salt",
      initializationVector: "server-v2-iv",
      kdfParameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2" },
      encryptionVersion: 2,
    },
    5,
    "2026-08-09T11:59:00.000Z",
    (local, server) => {
      const profession = local?.data.profile && typeof local.data.profile === "object"
        ? (local.data.profile as { profession?: unknown }).profession
        : null;
      return profession === "gp" || profession === "pharmacist"
        ? mergeProfession(server, profession)
        : server;
    },
  );

  const record = await repository.getRecord("settings", "owner-a");
  expect(record).toMatchObject({
    data: {
      profile: { doctorName: "Alex Example", profession: "pharmacist" },
      encryptionVersion: 2,
      ciphertext: "server-v2-ciphertext",
    },
    serverRevision: 5,
    syncState: "pending",
  });
  const pending = await repository.pendingMutations();
  expect(pending).toHaveLength(1);
  expect(await repository.conflicts()).toEqual([]);
  expect(pending[0]).toMatchObject({
    baseRevision: 5,
    payload: {
      profile: { profession: "pharmacist" },
      encryptionVersion: 2,
    },
  });

  await repository.recordConflict({
    ownerId: "owner-a",
    id: "stale-profession-mutation",
    recordType: "settings",
    recordId: "owner-a",
    mutationId: "replaced-profession-mutation",
    localData: { profile: { profession: "pharmacist" } },
    serverData: { profile: { profession: "gp" } },
    serverRevision: 5,
    localUpdatedAt: "2026-08-09T11:58:00.000Z",
    serverUpdatedAt: "2026-08-09T11:59:00.000Z",
    createdAt: "2026-08-09T12:00:00.000Z",
  });
  expect(await repository.conflicts()).toEqual([]);
  expect(await repository.getRecord("settings", "owner-a")).toMatchObject({
    data: { profile: { profession: "pharmacist" } },
    syncState: "pending",
  });
});
