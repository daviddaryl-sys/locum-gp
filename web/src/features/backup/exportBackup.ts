import { RECORD_STORES, type RecordStoreName } from "@/offline/types";
import type { OfflineRepository } from "@/offline/repository";

type BackupRecords = Record<string, unknown>;

export type EncryptedBackup = {
  version: 1;
  cipher: "AES-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  initializationVector: string;
  ciphertext: string;
};

type BackupPlaintext = {
  version: 1;
  createdAt: string;
  records: BackupRecords;
};

const ITERATIONS = 310_000;
const AAD = new TextEncoder().encode("locum-manager-backup:v1");
const UNLOCK_ERROR = "Backup could not be unlocked.";
const FORBIDDEN_CANONICAL_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "providertoken",
  "providerrefreshtoken",
  "signedurl",
  "signeduri",
  "blob",
  "receiptfilebytes",
  "receiptbytes",
]);

const BACKUP_RECORD_STORES = new Set<string>(RECORD_STORES);

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array) {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

async function backupKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt: arrayBuffer(salt) },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function isBinaryValue(value: unknown) {
  return (
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function canonicalKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function keyWords(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string) {
  if (FORBIDDEN_CANONICAL_KEYS.has(canonicalKey(key))) return true;
  const words = keyWords(key);
  const isSignedAddress =
    words.includes("signed") && (words.includes("url") || words.includes("uri"));
  const isReceiptPayload =
    words.includes("receipt") &&
    (!words.includes("size") ||
      ["payload", "content", "base64", "blob", "file", "data"].some(
        (word) => words.includes(word),
      )) &&
    ["payload", "content", "base64", "bytes", "byte", "blob", "file", "data"].some(
      (word) => words.includes(word),
    );
  return words.includes("token") || isSignedAddress || isReceiptPayload;
}

function isByteMatrix(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        (Number.isSafeInteger(entry) && entry >= 0 && entry <= 255) ||
        isByteMatrix(entry),
    )
  );
}

function isEncodedBinaryValue(value: unknown) {
  if (typeof value === "string") {
    return /^data:[^,]*;base64,/i.test(value);
  }
  return isByteMatrix(value);
}

function isExcludedValue(value: unknown) {
  return isBinaryValue(value) || isEncodedBinaryValue(value);
}

function scrubSecrets(value: unknown): unknown {
  if (isExcludedValue(value)) return undefined;
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          !isSensitiveKey(key) && !isExcludedValue(entry),
      )
      .map(([key, entry]) => [key, scrubSecrets(entry)]),
  );
}

function scrubBackupRecords(records: BackupRecords) {
  return Object.fromEntries(
    Object.entries(records)
      .filter(([recordType]) => BACKUP_RECORD_STORES.has(recordType))
      .map(([recordType, recordsForType]) => [recordType, scrubSecrets(recordsForType)]),
  ) as BackupRecords;
}

export async function exportEncryptedBackup(
  records: BackupRecords,
  passphrase: string,
  createdAt = new Date().toISOString(),
): Promise<EncryptedBackup> {
  if (passphrase.length < 12) {
    throw new Error("Backup passphrase must be at least 12 characters.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(passphrase, salt, ITERATIONS);
  const plaintext: BackupPlaintext = {
    version: 1,
    createdAt,
    records: scrubBackupRecords(records),
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: initializationVector,
      additionalData: AAD,
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  return {
    version: 1,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    initializationVector: bytesToBase64(initializationVector),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackupForRecovery(
  envelope: EncryptedBackup,
  passphrase: string,
): Promise<BackupPlaintext> {
  try {
    if (
      envelope.version !== 1 ||
      envelope.cipher !== "AES-GCM" ||
      envelope.kdf !== "PBKDF2-SHA-256" ||
      !Number.isSafeInteger(envelope.iterations) ||
      envelope.iterations < 300_000 ||
      envelope.iterations > 1_000_000
    ) {
      throw new Error(UNLOCK_ERROR);
    }
    const salt = base64ToBytes(envelope.salt);
    const initializationVector = base64ToBytes(envelope.initializationVector);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    if (salt.length !== 16 || initializationVector.length !== 12 || !ciphertext.length) {
      throw new Error(UNLOCK_ERROR);
    }
    const key = await backupKey(passphrase, salt, envelope.iterations);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: arrayBuffer(initializationVector),
        additionalData: AAD,
        tagLength: 128,
      },
      key,
      arrayBuffer(ciphertext),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    if (!parsed || typeof parsed !== "object" || (parsed as BackupPlaintext).version !== 1) {
      throw new Error(UNLOCK_ERROR);
    }
    return parsed as BackupPlaintext;
  } catch {
    throw new Error(UNLOCK_ERROR);
  }
}

export async function collectBackupRecords(repository: OfflineRepository) {
  const entries = await Promise.all(
    RECORD_STORES.map(async (recordType) => [
      recordType,
      (await repository
        .tableFor(recordType as RecordStoreName)
        .where("ownerId")
        .equals(repository.ownerId)
        .toArray()).map(({ id, data, updatedAt, deletedAt }) => ({
        id,
        data,
        updatedAt,
        deletedAt: deletedAt ?? null,
      })),
    ] as const),
  );
  return Object.fromEntries(entries);
}

export function downloadEncryptedBackup(envelope: EncryptedBackup) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `locum-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
