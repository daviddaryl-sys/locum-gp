import { describe, expect, it } from "vitest";

import {
  mergeProfession,
  parseProfession,
  PROFESSIONS,
  readProfession,
} from "@/domain/profession";

describe("profession preference", () => {
  it("parses only the supported profession values", () => {
    expect(parseProfession("gp")).toBe("gp");
    expect(parseProfession("pharmacist")).toBe("pharmacist");
    expect(parseProfession("doctor")).toBeNull();
    expect(parseProfession("GP")).toBeNull();
    expect(parseProfession(undefined)).toBeNull();
  });

  it("provides the approved profession labels", () => {
    expect(PROFESSIONS).toEqual([
      { value: "gp", label: "GP" },
      { value: "pharmacist", label: "Pharmacist" },
    ]);
  });

  it("keeps legacy settings unconfirmed instead of assuming GP", () => {
    expect(readProfession({ profile: { doctorName: "Dr Alex Example" } })).toBeNull();
    expect(readProfession({})).toBeNull();
    expect(readProfession(null)).toBeNull();
  });

  it("reads a valid profession from the profile", () => {
    expect(readProfession({ profile: { profession: "pharmacist" } })).toBe(
      "pharmacist",
    );
    expect(readProfession({ profile: { profession: "doctor" } })).toBeNull();
  });

  it("merges a profession while preserving every existing profile and vault field", () => {
    const existingSettings = {
      profile: {
        doctorName: "Dr Alex Example",
        tradingName: "Example Locums",
        address: "1 Example Road",
        email: "alex@example.test",
      },
      invoicePrefix: "INV",
      ciphertext: "encrypted-vault",
      salt: "vault-salt",
      initializationVector: "vault-iv",
      kdfParameters: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 310000,
      },
      encryptionVersion: 1,
      futureField: { preserve: true },
    };

    expect(mergeProfession(existingSettings, "pharmacist")).toEqual({
      ...existingSettings,
      profile: {
        ...existingSettings.profile,
        profession: "pharmacist",
      },
    });
    expect(existingSettings.profile).not.toHaveProperty("profession");
  });
});
