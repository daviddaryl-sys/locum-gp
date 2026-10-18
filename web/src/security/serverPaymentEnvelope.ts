import "server-only";

import { Buffer } from "node:buffer";

import {
  parseServerPaymentEnvelope,
  type ServerPaymentEnvelope,
} from "./paymentEnvelope";
import {
  normalizedDetails,
  validBankDetails,
  type BankDetails,
} from "./vault";

const KDF = {
  name: "HKDF",
  hash: "SHA-256",
  info: "locum-manager-payment:v2",
} as const;
const ENCRYPTION_ERROR = "Payment encryption is unavailable.";
const DETAILS_ERROR = "Payment details are unavailable.";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromCanonicalBase64(value: string): Uint8Array {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(DETAILS_ERROR);
  return Uint8Array.from(decoded);
}

function checkedMasterKey(masterKey: Uint8Array, errorMessage: string): Uint8Array {
  if (masterKey.byteLength !== 32) throw new Error(errorMessage);
  return Uint8Array.from(masterKey);
}

function ownerContext(ownerId: string): Uint8Array {
  return new TextEncoder().encode(`${KDF.info}:${ownerId}`);
}

async function deriveKey(
  ownerId: string,
  salt: Uint8Array,
  masterKey: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(masterKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(ownerContext(ownerId)),
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export function paymentMasterKey(): Uint8Array {
  try {
    const configured = process.env.PAYMENT_DETAILS_MASTER_KEY;
    if (!configured) throw new Error(ENCRYPTION_ERROR);
    return checkedMasterKey(fromCanonicalBase64(configured), ENCRYPTION_ERROR);
  } catch {
    throw new Error(ENCRYPTION_ERROR);
  }
}

export async function encryptPaymentDetailsV2(
  ownerId: string,
  details: BankDetails,
  masterKey = paymentMasterKey(),
): Promise<ServerPaymentEnvelope> {
  const normalized = normalizedDetails(details);
  const checkedKey = checkedMasterKey(masterKey, ENCRYPTION_ERROR);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(ownerId, salt, checkedKey, "encrypt");
  const plaintext = new TextEncoder().encode(JSON.stringify(normalized));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(initializationVector),
      additionalData: toArrayBuffer(ownerContext(ownerId)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext),
  );
  return {
    version: 2,
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    salt: toBase64(salt),
    initializationVector: toBase64(initializationVector),
    kdfParameters: KDF,
  };
}

export async function decryptPaymentDetailsV2(
  ownerId: string,
  envelope: ServerPaymentEnvelope,
  masterKey = paymentMasterKey(),
): Promise<BankDetails> {
  try {
    const parsed = parseServerPaymentEnvelope(envelope);
    if (!parsed) throw new Error(DETAILS_ERROR);
    const checkedKey = checkedMasterKey(masterKey, DETAILS_ERROR);
    const salt = fromCanonicalBase64(parsed.salt);
    const initializationVector = fromCanonicalBase64(parsed.initializationVector);
    const ciphertext = fromCanonicalBase64(parsed.ciphertext);
    if (
      salt.byteLength !== 16 ||
      initializationVector.byteLength !== 12 ||
      ciphertext.byteLength <= 16
    ) {
      throw new Error(DETAILS_ERROR);
    }
    const key = await deriveKey(ownerId, salt, checkedKey, "decrypt");
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(initializationVector),
        additionalData: toArrayBuffer(ownerContext(ownerId)),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertext),
    );
    const details: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    if (!validBankDetails(details)) throw new Error(DETAILS_ERROR);
    return normalizedDetails(details);
  } catch {
    throw new Error(DETAILS_ERROR);
  }
}
