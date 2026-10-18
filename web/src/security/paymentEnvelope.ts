import type { EncryptedVault } from "./vault";

export type ServerPaymentEnvelope = {
  version: 2;
  ciphertext: string;
  salt: string;
  initializationVector: string;
  kdfParameters: {
    name: "HKDF";
    hash: "SHA-256";
    info: "locum-manager-payment:v2";
  };
};

export type EncryptedPaymentEnvelope = EncryptedVault | ServerPaymentEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function canonicalBase64DecodedLength(value: string): number | null {
  try {
    const decoded = atob(value);
    return btoa(decoded) === value ? decoded.length : null;
  } catch {
    return null;
  }
}

export function parseServerPaymentEnvelope(
  value: unknown,
): ServerPaymentEnvelope | null {
  if (!isRecord(value)) return null;
  if (!hasExactKeys(value, [
    "version",
    "ciphertext",
    "salt",
    "initializationVector",
    "kdfParameters",
  ])) return null;

  const kdf = value.kdfParameters;
  if (!isRecord(kdf) || !hasExactKeys(kdf, ["name", "hash", "info"])) {
    return null;
  }

  if (
    value.version !== 2 ||
    typeof value.ciphertext !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.initializationVector !== "string" ||
    kdf.name !== "HKDF" ||
    kdf.hash !== "SHA-256" ||
    kdf.info !== "locum-manager-payment:v2"
  ) {
    return null;
  }

  const ciphertextLength = canonicalBase64DecodedLength(value.ciphertext);
  const saltLength = canonicalBase64DecodedLength(value.salt);
  const initializationVectorLength = canonicalBase64DecodedLength(
    value.initializationVector,
  );

  return ciphertextLength !== null &&
    ciphertextLength > 16 &&
    saltLength === 16 &&
    initializationVectorLength === 12
    ? (value as ServerPaymentEnvelope)
    : null;
}
