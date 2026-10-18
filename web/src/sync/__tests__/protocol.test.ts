import { describe, expect, it } from "vitest";

import { parseSyncBatchRequest } from "../protocol";

function invoiceMutation(practiceId: string) {
  return {
    cursor: null,
    mutations: [
      {
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recordType: "invoices",
        recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        operation: "upsert",
        payload: {
          invoiceNumber: "DEMO-2026-0001",
          status: "draft",
          practiceId,
          issueDate: "2026-08-03",
          dueDate: "2026-09-02",
          totalPence: 24000,
          practiceSnapshot: null,
          paymentSnapshot: null,
          issuedAt: null,
          artifactPath: null,
        },
        baseRevision: 0,
        localRevision: 1,
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
    ],
  };
}

function settingsMutation(payload: Record<string, unknown>) {
  return {
    cursor: null,
    mutations: [
      {
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        recordType: "settings",
        recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
        operation: "upsert",
        payload,
        baseRevision: 0,
        localRevision: 1,
        updatedAt: "2026-08-08T09:00:00.000Z",
      },
    ],
  };
}

function expenseMutation(payload: Record<string, unknown>) {
  return {
    cursor: null,
    mutations: [
      {
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
        recordType: "expenses",
        recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
        operation: "upsert",
        payload: {
          expenseDate: "2026-08-08",
          amountPence: 1375,
          categoryKey: "mileage_business_travel",
          customCategoryId: null,
          mtdCategory: "travel_costs",
          allowablePercentage: 100,
          practiceId: null,
          supplierDescription: "Example journey",
          notes: null,
          reimbursedByPractice: false,
          needsAccountantReview: false,
          receiptObjectKey: null,
          receiptOriginalName: null,
          receiptMimeType: null,
          receiptSizeBytes: null,
          receiptSyncStatus: "none",
          isDemo: false,
          ...payload,
        },
        baseRevision: 0,
        localRevision: 1,
        updatedAt: "2026-08-08T09:00:00.000Z",
      },
    ],
  };
}

describe("sync protocol structured mileage expenses", () => {
  it("accepts and preserves complete mileage fields", () => {
    const request = parseSyncBatchRequest(
      expenseMutation({
        expenseKind: "mileage",
        journeyOrigin: "Example Surgery",
        journeyDestination: "Example Pharmacy",
        distanceMiles: 25,
        mileageRatePence: 55,
        linkedSessionId: "11111111-1111-4111-8111-111111111111",
      }),
    );

    expect(request.mutations[0].payload).toMatchObject({
      expenseKind: "mileage",
      journeyOrigin: "Example Surgery",
      journeyDestination: "Example Pharmacy",
      distanceMiles: 25,
      mileageRatePence: 55,
      linkedSessionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("accepts and preserves PostgreSQL mileage boundaries", () => {
    const payload = parseSyncBatchRequest(
      expenseMutation({
        expenseKind: "mileage",
        journeyOrigin: "Example Surgery",
        journeyDestination: "Example Pharmacy",
        distanceMiles: 999999.99,
        mileageRatePence: 2147483647,
        linkedSessionId: null,
      }),
    ).mutations[0].payload;

    expect(payload).toMatchObject({
      distanceMiles: 999999.99,
      mileageRatePence: 2147483647,
    });
  });

  it("normalizes accepted floating-point distance noise before syncing", () => {
    const payload = parseSyncBatchRequest(
      expenseMutation({
        expenseKind: "mileage",
        journeyOrigin: "Example Surgery",
        journeyDestination: "Example Pharmacy",
        distanceMiles: 0.1 + 0.2,
        mileageRatePence: 55,
        linkedSessionId: null,
      }),
    ).mutations[0].payload;

    expect(payload.distanceMiles).toBe(0.3);
  });

  it.each([
    { distanceMiles: 12.345, mileageRatePence: 55 },
    { distanceMiles: 1_000_000, mileageRatePence: 55 },
    { distanceMiles: 12.5, mileageRatePence: 2_147_483_648 },
  ])("rejects mileage values PostgreSQL cannot represent", (limits) => {
    expect(() =>
      parseSyncBatchRequest(
        expenseMutation({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          linkedSessionId: null,
          ...limits,
        }),
      ),
    ).toThrow("Invalid sync request.");
  });

  it("defaults a legacy expense payload to standard fields", () => {
    expect(
      parseSyncBatchRequest(expenseMutation({})).mutations[0].payload,
    ).toMatchObject({
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
    });
  });

  it("rejects unknown expense fields", () => {
    expect(() =>
      parseSyncBatchRequest(expenseMutation({ unexpectedMileageField: 1 })),
    ).toThrow("Invalid sync request.");
  });

  it("rejects a non-UUID linked session", () => {
    expect(() =>
      parseSyncBatchRequest(
        expenseMutation({
          expenseKind: "mileage",
          journeyOrigin: "Example Surgery",
          journeyDestination: "Example Pharmacy",
          distanceMiles: 25,
          mileageRatePence: 55,
          linkedSessionId: "not-a-uuid",
        }),
      ),
    ).toThrow("Invalid sync request.");
  });
});

describe("sync protocol invoice practice links", () => {
  it("preserves a UUID-shaped practiceId on an invoice upsert", () => {
    const request = parseSyncBatchRequest(
      invoiceMutation("11111111-1111-4111-8111-111111111111"),
    );

    expect(request.mutations[0].payload.practiceId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("rejects a non-UUID invoice practiceId", () => {
    expect(() => parseSyncBatchRequest(invoiceMutation("not-a-uuid"))).toThrow(
      "Invalid sync request.",
    );
  });
});

describe("sync protocol profession settings", () => {
  it("accepts a profile profession and invoice prefix without a vault", () => {
    const request = parseSyncBatchRequest(
      settingsMutation({
        profile: {
          profession: "pharmacist",
          doctorName: "Alex Example",
          tradingName: "Example Locums",
          address: "1 Example Road",
          email: "alex@example.test",
        },
        invoicePrefix: "INV",
      }),
    );

    expect(request.mutations[0].payload).toMatchObject({
      profile: { profession: "pharmacist" },
      invoicePrefix: "INV",
    });
  });

  it("accepts a complete valid encrypted vault group", () => {
    expect(() =>
      parseSyncBatchRequest(
        settingsMutation({
          profile: { profession: "gp" },
          ciphertext: "opaque-ciphertext",
          salt: "opaque-salt",
          initializationVector: "opaque-iv",
          kdfParameters: {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: 310000,
          },
          encryptionVersion: 1,
        }),
      ),
    ).not.toThrow();
  });

  it("accepts the exact server-managed version 2 payment envelope", () => {
    const request = parseSyncBatchRequest(settingsMutation({
      profile: { profession: "gp", doctorName: "Dr Demo" },
      ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      initializationVector: "EBESExQVFhcYGRob",
      kdfParameters: {
        name: "HKDF",
        hash: "SHA-256",
        info: "locum-manager-payment:v2",
      },
      encryptionVersion: 2,
    }));

    expect(request.mutations[0].payload.encryptionVersion).toBe(2);
  });

  it.each([
    { ciphertext: "not-base64" },
    { kdfParameters: { name: "HKDF", hash: "SHA-256", info: "wrong" } },
    { kdfParameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2", extra: true } },
  ])("rejects a malformed version 2 payment envelope", (replacement) => {
    expect(() => parseSyncBatchRequest(settingsMutation({
      profile: { profession: "gp" },
      ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      initializationVector: "EBESExQVFhcYGRob",
      kdfParameters: {
        name: "HKDF",
        hash: "SHA-256",
        info: "locum-manager-payment:v2",
      },
      encryptionVersion: 2,
      ...replacement,
    }))).toThrow("Invalid sync request.");
  });

  it.each([
    { ciphertext: "opaque-ciphertext" },
    {
      ciphertext: "opaque-ciphertext",
      salt: "opaque-salt",
      initializationVector: "opaque-iv",
      kdfParameters: { name: "PBKDF2" },
    },
    {
      ciphertext: "",
      salt: "opaque-salt",
      initializationVector: "opaque-iv",
      kdfParameters: { name: "PBKDF2" },
      encryptionVersion: 1,
    },
    {
      ciphertext: "opaque-ciphertext",
      salt: "opaque-salt",
      initializationVector: "opaque-iv",
      kdfParameters: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 1,
      },
      encryptionVersion: 1,
    },
    {
      ciphertext: "opaque-ciphertext",
      salt: "opaque-salt",
      initializationVector: "opaque-iv",
      kdfParameters: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 310000,
      },
      encryptionVersion: 2,
    },
  ])("rejects an incomplete or invalid encrypted vault group", (vault) => {
    expect(() =>
      parseSyncBatchRequest(
        settingsMutation({ profile: { profession: "gp" }, ...vault }),
      ),
    ).toThrow("Invalid sync request.");
  });

  it("rejects unknown settings fields", () => {
    expect(() =>
      parseSyncBatchRequest(
        settingsMutation({
          profile: { profession: "gp" },
          unexpectedSecret: "must-not-pass",
        }),
      ),
    ).toThrow("Invalid sync request.");
  });

  it.each([
    { profile: { profession: "doctor" } },
    { profile: "gp" },
    { profile: { profession: "gp" }, invoicePrefix: "not valid!" },
  ])("rejects invalid profile settings", (payload) => {
    expect(() => parseSyncBatchRequest(settingsMutation(payload))).toThrow(
      "Invalid sync request.",
    );
  });
});
