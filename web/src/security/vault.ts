export type BankDetails = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
};

export type VaultKdfParameters = {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
};

export type EncryptedVault = {
  version: 1;
  ciphertext: string;
  salt: string;
  initializationVector: string;
  kdfParameters: VaultKdfParameters;
};

const ITERATIONS = 310_000;
const MINIMUM_ITERATIONS = 300_000;
const MAXIMUM_ITERATIONS = 1_000_000;
const ADDITIONAL_DATA = new TextEncoder().encode("locum-manager-vault:v1");
const UNLOCK_ERROR = "Payment details could not be unlocked.";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function validBankDetails(value: unknown): value is BankDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accountName === "string" &&
    Boolean(candidate.accountName.trim()) &&
    typeof candidate.sortCode === "string" &&
    Boolean(candidate.sortCode.trim()) &&
    typeof candidate.accountNumber === "string" &&
    Boolean(candidate.accountNumber.trim())
  );
}

export function normalizedDetails(details: BankDetails): BankDetails {
  if (!validBankDetails(details)) throw new Error("Complete the payment details.");
  return {
    accountName: details.accountName.trim(),
    sortCode: details.sortCode.trim(),
    accountNumber: details.accountNumber.trim(),
  };
}

function validPasscode(passcode: string) {
  if (passcode.length < 8) throw new Error("Passcode must be at least 8 characters.");
}

async function deriveKey(
  passcode: string,
  salt: Uint8Array,
  parameters: VaultKdfParameters,
) {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: parameters.hash,
      iterations: parameters.iterations,
      salt: saltBuffer,
    },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVault(
  details: BankDetails,
  passcode: string,
): Promise<EncryptedVault> {
  validPasscode(passcode);
  const normalized = normalizedDetails(details);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const kdfParameters: VaultKdfParameters = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
  };
  const key = await deriveKey(passcode, salt, kdfParameters);
  const plaintext = new TextEncoder().encode(JSON.stringify(normalized));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: initializationVector,
      additionalData: ADDITIONAL_DATA,
      tagLength: 128,
    },
    key,
    plaintext,
  );

  return {
    version: 1,
    ciphertext: toBase64(new Uint8Array(encrypted)),
    salt: toBase64(salt),
    initializationVector: toBase64(initializationVector),
    kdfParameters,
  };
}

export async function decryptVault(
  envelope: EncryptedVault,
  passcode: string,
): Promise<BankDetails> {
  try {
    if (
      envelope.version !== 1 ||
      envelope.kdfParameters.name !== "PBKDF2" ||
      envelope.kdfParameters.hash !== "SHA-256" ||
      !Number.isSafeInteger(envelope.kdfParameters.iterations) ||
      envelope.kdfParameters.iterations < MINIMUM_ITERATIONS ||
      envelope.kdfParameters.iterations > MAXIMUM_ITERATIONS
    ) {
      throw new Error(UNLOCK_ERROR);
    }
    const salt = fromBase64(envelope.salt);
    const initializationVector = fromBase64(envelope.initializationVector);
    const ciphertext = fromBase64(envelope.ciphertext);
    if (salt.length !== 16 || initializationVector.length !== 12 || !ciphertext.length) {
      throw new Error(UNLOCK_ERROR);
    }
    const key = await deriveKey(passcode, salt, envelope.kdfParameters);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: initializationVector,
        additionalData: ADDITIONAL_DATA,
        tagLength: 128,
      },
      key,
      ciphertext,
    );
    const details: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    if (!validBankDetails(details)) throw new Error(UNLOCK_ERROR);
    return normalizedDetails(details);
  } catch {
    throw new Error(UNLOCK_ERROR);
  }
}
