import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptPaymentDetailsV2,
  encryptPaymentDetailsV2,
  paymentMasterKey,
} from "../serverPaymentEnvelope";

vi.mock("server-only", () => ({}));

const details = {
  accountName: "Dr Demo",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};
const owner = "00000000-0000-4000-8000-000000000001";
const key = new Uint8Array(32).fill(7);

afterEach(() => delete process.env.PAYMENT_DETAILS_MASTER_KEY);

describe("server-managed payment envelope", () => {
  it("round-trips details only for the bound owner", async () => {
    const envelope = await encryptPaymentDetailsV2(owner, details, key);
    expect(envelope).toMatchObject({
      version: 2,
      kdfParameters: { name: "HKDF", hash: "SHA-256" },
    });
    expect(await decryptPaymentDetailsV2(owner, envelope, key)).toEqual(details);
    await expect(
      decryptPaymentDetailsV2(
        "00000000-0000-4000-8000-000000000002",
        envelope,
        key,
      ),
    ).rejects.toThrow("Payment details are unavailable.");
  });

  it("stores no readable payment data and randomizes every save", async () => {
    const first = await encryptPaymentDetailsV2(owner, details, key);
    const second = await encryptPaymentDetailsV2(owner, details, key);
    const persisted = JSON.stringify(first);
    expect(persisted).not.toContain(details.accountName);
    expect(persisted).not.toContain(details.sortCode);
    expect(persisted).not.toContain(details.accountNumber);
    expect(second.salt).not.toBe(first.salt);
    expect(second.initializationVector).not.toBe(first.initializationVector);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("fails generically for wrong keys, tampering, malformed base64, and unsupported versions", async () => {
    const envelope = await encryptPaymentDetailsV2(owner, details, key);
    const wrong = new Uint8Array(32).fill(8);
    const tamperedCiphertext = `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
    await expect(decryptPaymentDetailsV2(owner, envelope, wrong)).rejects.toThrow(
      "Payment details are unavailable.",
    );
    await expect(
      decryptPaymentDetailsV2(owner, { ...envelope, ciphertext: tamperedCiphertext }, key),
    ).rejects.toThrow("Payment details are unavailable.");
    await expect(
      decryptPaymentDetailsV2(owner, { ...envelope, ciphertext: "not-base64" }, key),
    ).rejects.toThrow("Payment details are unavailable.");
    await expect(
      decryptPaymentDetailsV2(owner, { ...envelope, initializationVector: "AA==" }, key),
    ).rejects.toThrow("Payment details are unavailable.");
    await expect(
      decryptPaymentDetailsV2(owner, { ...envelope, version: 3 } as never, key),
    ).rejects.toThrow("Payment details are unavailable.");
  });

  it("accepts only a canonical base64 encoded 32-byte configured key", () => {
    process.env.PAYMENT_DETAILS_MASTER_KEY = Buffer.from(key).toString("base64");
    expect(paymentMasterKey()).toEqual(key);
    process.env.PAYMENT_DETAILS_MASTER_KEY = "invalid";
    expect(() => paymentMasterKey()).toThrow("Payment encryption is unavailable.");
    process.env.PAYMENT_DETAILS_MASTER_KEY = Buffer.from(
      new Uint8Array(31).fill(7),
    ).toString("base64");
    expect(() => paymentMasterKey()).toThrow("Payment encryption is unavailable.");
  });
});
