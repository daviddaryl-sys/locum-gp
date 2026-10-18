import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeProfileAndPayments,
  validateProfileAndPayments,
} from "@/features/settings/profilePaymentsDomain";
import {
  decryptPaymentDetailsV2,
  encryptPaymentDetailsV2,
} from "@/security/serverPaymentEnvelope";

import { GET, PUT } from "../route";

const details = {
  accountName: "Dr Demo",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};
const profile = {
  doctorName: "Dr Demo",
  tradingName: "Demo Locums",
  address: "Demo address",
  email: "demo@example.test",
};
const envelope = {
  version: 2 as const,
  ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
  salt: "AAECAwQFBgcICQoLDA0ODw==",
  initializationVector: "EBESExQVFhcYGRob",
  kdfParameters: {
    name: "HKDF" as const,
    hash: "SHA-256" as const,
    info: "locum-manager-payment:v2" as const,
  },
};
const readyRow = {
  id: "owner-1",
  owner_id: "owner-1",
  revision: 2,
  updated_at: "2026-08-09T09:00:00.000Z",
  deleted_at: null,
  profile,
  invoice_prefix: "INV",
  encryption_version: 2,
  ciphertext: envelope.ciphertext,
  salt: envelope.salt,
  initialization_vector: envelope.initializationVector,
  kdf_parameters: envelope.kdfParameters,
};

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  from: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: mocks.getClaims },
    from: mocks.from,
  })),
}));
vi.mock("@/security/serverPaymentEnvelope", () => ({
  decryptPaymentDetailsV2: vi.fn(),
  encryptPaymentDetailsV2: vi.fn(),
}));

function mockClaims(ownerId: string | null) {
  mocks.getClaims.mockResolvedValue(
    ownerId
      ? { data: { claims: { sub: ownerId } }, error: null }
      : { data: null, error: new Error("unauthorized") },
  );
}

function mockSettings(
  row: Record<string, unknown> | null,
  writeResult: Record<string, unknown> | null = row,
) {
  let writing = false;
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn((payload) => {
    writing = true;
    mocks.write(payload);
    return chain;
  });
  chain.insert = vi.fn((payload) => {
    writing = true;
    mocks.write(payload);
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => ({
    data: writing ? writeResult : row,
    error: null,
  }));
  mocks.from.mockReturnValue(chain);
  return chain;
}

function request(body: unknown) {
  return new Request("http://localhost/api/profile-and-payments", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
}

describe("profile and payments domain", () => {
  it("normalizes valid fields without a passcode", () => {
    const normalized = normalizeProfileAndPayments({
      profile: { ...profile, doctorName: " Dr Demo " },
      invoicePrefix: " inv ",
      paymentDetails: { ...details, sortCode: "123456" },
    });
    expect(normalized).toEqual({ profile, invoicePrefix: "INV", paymentDetails: details });
    expect(validateProfileAndPayments(normalized, true)).toEqual({});
    expect(normalized).not.toHaveProperty("passcode");
  });

  it("rejects invalid profile and bank fields", () => {
    expect(validateProfileAndPayments({
      profile: { doctorName: "", tradingName: "", address: "", email: "bad" },
      invoicePrefix: "bad prefix",
      paymentDetails: { accountName: "", sortCode: "123", accountNumber: "12" },
    }, true)).toMatchObject({
      doctorName: expect.any(String),
      address: expect.any(String),
      email: expect.any(String),
      invoicePrefix: expect.any(String),
      accountName: expect.any(String),
      sortCode: expect.any(String),
      accountNumber: expect.any(String),
    });
  });
});

describe("profile and payments API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptPaymentDetailsV2).mockResolvedValue(details);
    vi.mocked(encryptPaymentDetailsV2).mockResolvedValue(envelope);
  });

  it("rejects unauthenticated requests with no-store headers", async () => {
    mockClaims(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports missing and legacy settings without decrypting", async () => {
    mockClaims("owner-1");
    mockSettings(null);
    const missing = await GET();
    expect(await missing.json()).toEqual({ state: "missing" });
    expectNoStore(missing);

    mockSettings({ ...readyRow, encryption_version: 1 });
    const legacy = await GET();
    expect(legacy.status).toBe(409);
    expect(await legacy.json()).toEqual({
      state: "upgrade_required",
      profile,
      invoicePrefix: "INV",
    });
    expect(decryptPaymentDetailsV2).not.toHaveBeenCalled();
  });

  it("loads public profile fields from a metadata-only settings row", async () => {
    mockClaims("owner-1");
    mockSettings({
      ...readyRow,
      profile: { ...profile, profession: "pharmacist" },
      encryption_version: null,
      ciphertext: null,
      salt: null,
      initialization_vector: null,
      kdf_parameters: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "missing",
      profile,
      invoicePrefix: "INV",
    });
    expect(decryptPaymentDetailsV2).not.toHaveBeenCalled();
  });

  it("allows a profession-only settings row to continue payment setup", async () => {
    mockClaims("owner-1");
    mockSettings({
      id: "owner-1",
      owner_id: "owner-1",
      revision: 1,
      updated_at: "2026-08-09T09:00:00.000Z",
      profile: { profession: "gp" },
      invoice_prefix: "INV",
      encryption_version: null,
      ciphertext: null,
      salt: null,
      initialization_vector: null,
      kdf_parameters: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "missing" });
    expect(decryptPaymentDetailsV2).not.toHaveBeenCalled();
  });

  it("loads version 2 only for the authenticated owner", async () => {
    mockClaims("owner-1");
    const chain = mockSettings(readyRow);
    const response = await GET();
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(decryptPaymentDetailsV2).toHaveBeenCalledWith("owner-1", envelope);
    expect(await response.json()).toMatchObject({
      state: "ready",
      paymentDetails: details,
      paymentSummary: { accountName: "Dr Demo", accountNumberLast4: "5678" },
    });
    expectNoStore(response);
  });

  it("ignores a request owner and inserts only for the authenticated owner", async () => {
    mockClaims("owner-1");
    mockSettings(null, { ...readyRow, revision: 1 });
    const response = await PUT(request({
      ownerId: "owner-2",
      profile,
      invoicePrefix: "INV",
      paymentDetails: details,
    }));
    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner-1" }));
    expect(mocks.write).not.toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner-2" }));
  });

  it("requires payment details for missing or legacy settings", async () => {
    mockClaims("owner-1");
    mockSettings(null);
    const response = await PUT(request({ profile, invoicePrefix: "INV" }));
    expect(response.status).toBe(422);
    expectNoStore(response);
    expect(encryptPaymentDetailsV2).not.toHaveBeenCalled();
  });

  it("upgrades a metadata-only row and preserves its profession", async () => {
    mockClaims("owner-1");
    const metadataOnly = {
      ...readyRow,
      revision: 1,
      profile: { ...profile, profession: "pharmacist" },
      encryption_version: null,
      ciphertext: null,
      salt: null,
      initialization_vector: null,
      kdf_parameters: null,
    };
    mockSettings(metadataOnly, {
      ...readyRow,
      profile: metadataOnly.profile,
      revision: 2,
    });

    const missingPayment = await PUT(request({ profile, invoicePrefix: "INV" }));
    expect(missingPayment.status).toBe(422);

    mockSettings(metadataOnly, {
      ...readyRow,
      profile: metadataOnly.profile,
      revision: 2,
    });
    const response = await PUT(request({ profile, invoicePrefix: "INV", paymentDetails: details }));

    expect(response.status).toBe(200);
    expect(encryptPaymentDetailsV2).toHaveBeenCalledWith("owner-1", details);
    expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({
      encryption_version: 2,
      profile: expect.objectContaining({ profession: "pharmacist" }),
    }));
  });

  it("preserves a version 2 envelope on profile-only updates", async () => {
    mockClaims("owner-1");
    const chain = mockSettings(readyRow, { ...readyRow, revision: 3 });
    const response = await PUT(request({
      profile: { ...profile, tradingName: "Updated" },
      invoicePrefix: "DEMO",
    }));
    expect(response.status).toBe(200);
    expect(encryptPaymentDetailsV2).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      encryption_version: 2,
      ciphertext: envelope.ciphertext,
      salt: envelope.salt,
      initialization_vector: envelope.initializationVector,
    }));
    expect(chain.eq).toHaveBeenCalledWith("revision", 2);
  });

  it("preserves the saved profession while updating profile and payments", async () => {
    mockClaims("owner-1");
    mockSettings(
      { ...readyRow, profile: { ...profile, profession: "pharmacist" } },
      { ...readyRow, revision: 3, profile: { ...profile, profession: "pharmacist" } },
    );
    const response = await PUT(request({
      profile: { ...profile, tradingName: "Updated" },
      invoicePrefix: "INV",
    }));
    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ profession: "pharmacist", tradingName: "Updated" }),
    }));
  });

  it("fails generically without logging sensitive details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockClaims("owner-1");
    mockSettings(readyRow);
    vi.mocked(decryptPaymentDetailsV2).mockRejectedValue(new Error(details.accountNumber));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Profile and payments are temporarily unavailable",
    });
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
