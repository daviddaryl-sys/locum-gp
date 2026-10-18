import { describe, expect, it } from "vitest";

import {
  decryptVault,
  encryptVault,
  type BankDetails,
} from "@/security/vault";

const bankDetails: BankDetails = {
  accountName: "Dr Example",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};

describe("private payment-details vault", () => {
  it("round-trips encrypted bank details with versioned PBKDF2 and AES-GCM metadata", async () => {
    const envelope = await encryptVault(bankDetails, "correct horse battery staple");

    expect(envelope).toMatchObject({
      version: 1,
      kdfParameters: {
        name: "PBKDF2",
        hash: "SHA-256",
      },
    });
    expect(envelope.kdfParameters.iterations).toBeGreaterThanOrEqual(300_000);
    expect(await decryptVault(envelope, "correct horse battery staple")).toEqual(
      bankDetails,
    );
  });

  it("never places plaintext payment details in the persisted envelope", async () => {
    const envelope = await encryptVault(bankDetails, "long private passcode");
    const persisted = JSON.stringify(envelope);

    expect(persisted).not.toContain(bankDetails.accountName);
    expect(persisted).not.toContain(bankDetails.sortCode);
    expect(persisted).not.toContain(bankDetails.accountNumber);
    expect(persisted).not.toContain("long private passcode");
  });

  it("uses a fresh random salt and IV for every encryption", async () => {
    const first = await encryptVault(bankDetails, "long private passcode");
    const second = await encryptVault(bankDetails, "long private passcode");

    expect(second.salt).not.toBe(first.salt);
    expect(second.initializationVector).not.toBe(first.initializationVector);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("rejects a wrong passcode without exposing crypto details", async () => {
    const envelope = await encryptVault(bankDetails, "correct private passcode");

    await expect(decryptVault(envelope, "wrong private passcode")).rejects.toThrow(
      "Payment details could not be unlocked.",
    );
  });

  it("rejects malformed or weakened persisted KDF parameters", async () => {
    const envelope = await encryptVault(bankDetails, "correct private passcode");

    await expect(
      decryptVault(
        {
          ...envelope,
          kdfParameters: { ...envelope.kdfParameters, iterations: 1 },
        },
        "correct private passcode",
      ),
    ).rejects.toThrow("Payment details could not be unlocked.");
  });
});
