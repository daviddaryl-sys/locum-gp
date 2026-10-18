// @vitest-environment node

import { createCipheriv } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptSecret, encryptSecret } from "../secretEnvelope";

const key = Buffer.alloc(32, 7);
const purpose = "refresh-token";

function encryptFixture(value: string, iv: Buffer, authTagLength = 16) {
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength });
  cipher.setAAD(Buffer.from(`locum-manager:${purpose}:v1`));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1 as const,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

describe("Calendar secret envelopes", () => {
  it("encrypts and authenticates a secret without exposing its plaintext", () => {
    const envelope = encryptSecret(
      "fictional-refresh-token",
      Buffer.alloc(32, 7),
      "refresh-token",
    );

    expect(envelope).toMatchObject({ version: 1 });
    expect(JSON.stringify(envelope)).not.toContain("fictional-refresh-token");
    expect(
      decryptSecret(envelope, Buffer.alloc(32, 7), "refresh-token"),
    ).toBe("fictional-refresh-token");
  });

  it("rejects a different key with one fixed error", () => {
    const envelope = encryptSecret(
      "fictional-refresh-token",
      Buffer.alloc(32, 7),
      "refresh-token",
    );

    expect(() =>
      decryptSecret(envelope, Buffer.alloc(32, 8), "refresh-token"),
    ).toThrow("Encrypted Calendar secret could not be opened.");
  });

  it("binds ciphertext to its stated purpose", () => {
    const envelope = encryptSecret(
      "fictional-refresh-token",
      Buffer.alloc(32, 7),
      "refresh-token",
    );

    expect(() =>
      decryptSecret(envelope, Buffer.alloc(32, 7), "oauth-state"),
    ).toThrow("Encrypted Calendar secret could not be opened.");
  });

  it.each([
    [Buffer.alloc(31, 7), "fictional-refresh-token"],
    [Buffer.alloc(32, 7), ""],
  ])("rejects invalid encryption inputs", (key, value) => {
    expect(() => encryptSecret(value, key, "refresh-token")).toThrow(
      "Calendar secret configuration is invalid.",
    );
  });

  it.each([
    ["unpadded", (tag: string) => tag.replace(/=+$/, "")],
    ["whitespace", (tag: string) => `${tag}\n`],
  ])("rejects %s noncanonical base64", (_name, mutate) => {
    const envelope = encryptSecret("fictional-refresh-token", key, purpose);

    expect(() =>
      decryptSecret({ ...envelope, tag: mutate(envelope.tag) }, key, purpose),
    ).toThrow("Encrypted Calendar secret could not be opened.");
  });

  it("rejects an authenticated envelope whose IV is not exactly 12 bytes", () => {
    const envelope = encryptFixture(
      "fictional-refresh-token",
      Buffer.alloc(11, 3),
    );

    expect(() => decryptSecret(envelope, key, purpose)).toThrow(
      "Encrypted Calendar secret could not be opened.",
    );
  });

  it("rejects a valid but truncated authentication tag", () => {
    const envelope = encryptSecret("fictional-refresh-token", key, purpose);
    const truncatedTag = Buffer.from(envelope.tag, "base64")
      .subarray(0, 15)
      .toString("base64");

    expect(() =>
      decryptSecret({ ...envelope, tag: truncatedTag }, key, purpose),
    ).toThrow("Encrypted Calendar secret could not be opened.");
  });

  it("rejects an authenticated empty ciphertext", () => {
    const envelope = encryptFixture("", Buffer.alloc(12, 3));

    expect(() => decryptSecret(envelope, key, purpose)).toThrow(
      "Encrypted Calendar secret could not be opened.",
    );
  });

  it.each([
    null,
    { version: 1, iv: 123, ciphertext: "value", tag: "value" },
    { version: 1, iv: "value", ciphertext: null, tag: "value" },
    { version: 1, iv: "value", ciphertext: "value", tag: {} },
  ])("rejects malformed envelope fields", (envelope) => {
    expect(() =>
      decryptSecret(envelope as never, key, purpose),
    ).toThrow("Encrypted Calendar secret could not be opened.");
  });
});
