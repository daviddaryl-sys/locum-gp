import { describe, expect, it } from "vitest";

import { protectSettingsMutation } from "../settingsProtection";

const staleV1Payload = {
  profile: { profession: "pharmacist", doctorName: "Dr Updated" },
  encryptionVersion: 1,
  ciphertext: "v1-ciphertext",
  salt: "v1-salt",
  initializationVector: "v1-iv",
  kdfParameters: { name: "PBKDF2" },
};

const version2DatabaseRow = {
  encryption_version: 2,
  ciphertext: "v2-ciphertext",
  salt: "v2-salt",
  initialization_vector: "v2-iv",
  kdf_parameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2" },
  profile: {
    profession: "gp",
    doctorName: "Dr Existing",
    paymentDetails: { accountNumber: "12345678" },
  },
  invoice_prefix: "SAFE",
};

describe("protectSettingsMutation", () => {
  it("preserves every version 2 encryption field while accepting public profile updates", () => {
    expect(protectSettingsMutation("upsert", staleV1Payload, version2DatabaseRow)).toEqual({
      blocked: false,
      payload: expect.objectContaining({
        encryptionVersion: 2,
        ciphertext: "v2-ciphertext",
        salt: "v2-salt",
        initializationVector: "v2-iv",
        kdfParameters: version2DatabaseRow.kdf_parameters,
        profile: { profession: "pharmacist", doctorName: "Dr Updated" },
      }),
    });
  });

  it("blocks deletion and strips readable or unknown profile fields", () => {
    expect(protectSettingsMutation("delete", {}, version2DatabaseRow)).toEqual({
      blocked: true,
      payload: {
        encryptionVersion: 2,
        ciphertext: "v2-ciphertext",
        salt: "v2-salt",
        initializationVector: "v2-iv",
        kdfParameters: version2DatabaseRow.kdf_parameters,
        profile: { profession: "gp", doctorName: "Dr Existing" },
        invoicePrefix: "SAFE",
      },
    });
  });

  it("leaves legacy and missing rows unchanged", () => {
    expect(protectSettingsMutation("upsert", staleV1Payload, { encryption_version: 1 })).toEqual({
      blocked: false,
      payload: staleV1Payload,
    });
    expect(protectSettingsMutation("delete", {}, null)).toEqual({ blocked: false, payload: {} });
  });
});
