import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretEnvelopeV1 = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

function additionalData(purpose: string) {
  return Buffer.from(`locum-manager:${purpose}:v1`);
}

function canonicalBase64(value: unknown) {
  if (typeof value !== "string") throw new Error();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error();
  return decoded;
}

export function encryptSecret(
  value: string,
  key: Buffer,
  purpose: string,
): SecretEnvelopeV1 {
  if (key.length !== 32 || !value) {
    throw new Error("Calendar secret configuration is invalid.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData(purpose));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(
  envelope: SecretEnvelopeV1,
  key: Buffer,
  purpose: string,
) {
  try {
    if (
      !envelope ||
      envelope.version !== 1 ||
      key.length !== 32 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.ciphertext !== "string" ||
      typeof envelope.tag !== "string"
    ) {
      throw new Error();
    }

    const iv = canonicalBase64(envelope.iv);
    const ciphertext = canonicalBase64(envelope.ciphertext);
    const tag = canonicalBase64(envelope.tag);
    if (iv.length !== 12 || ciphertext.length === 0 || tag.length !== 16) {
      throw new Error();
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      iv,
      { authTagLength: 16 },
    );
    decipher.setAAD(additionalData(purpose));
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted Calendar secret could not be opened.");
  }
}
