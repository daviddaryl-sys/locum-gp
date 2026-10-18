import { parseServerPaymentEnvelope } from "@/security/paymentEnvelope";
import type { BankDetails } from "@/security/vault";
import {
  normalizeProfileAndPayments,
  validateProfileAndPayments,
  type ProfileAndPaymentsInput,
  type ProfilePaymentsReadyResponse,
  type ProfilePaymentsSetupResponse,
  type PublicProfile,
} from "./profilePaymentsDomain";

export type ProfilePaymentsLoadResult =
  | ProfilePaymentsReadyResponse
  | ProfilePaymentsSetupResponse
  | { state: "unauthenticated" | "error" };

export class ProfilePaymentsUnauthenticatedError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "ProfilePaymentsUnauthenticatedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function exactState(value: unknown, state: string) {
  return isRecord(value) && hasExactKeys(value, ["state"]) && value.state === state;
}

function parseSetupResponse(
  value: unknown,
  state: "missing" | "upgrade_required",
): ProfilePaymentsSetupResponse | null {
  if (exactState(value, state)) return { state };
  if (!isRecord(value) || !hasExactKeys(value, ["state", "profile", "invoicePrefix"]) || value.state !== state) {
    return null;
  }
  const profile = parseProfile(value.profile);
  if (!profile || typeof value.invoicePrefix !== "string") return null;
  const normalized = normalizeProfileAndPayments({ profile, invoicePrefix: value.invoicePrefix });
  if (
    Object.keys(validateProfileAndPayments(normalized, false)).length ||
    !sameProfile(normalized.profile, profile) || normalized.invoicePrefix !== value.invoicePrefix
  ) return null;
  return { state, profile, invoicePrefix: value.invoicePrefix };
}

function parseProfile(value: unknown): PublicProfile | null {
  if (!isRecord(value) || !hasExactKeys(value, ["doctorName", "tradingName", "address", "email"])) return null;
  if (
    typeof value.doctorName !== "string" || typeof value.tradingName !== "string" ||
    typeof value.address !== "string" || typeof value.email !== "string"
  ) return null;
  return {
    doctorName: value.doctorName,
    tradingName: value.tradingName,
    address: value.address,
    email: value.email,
  };
}

function parseStoredProfile(value: unknown): (PublicProfile & { profession?: "gp" | "pharmacist" }) | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  const validKeys = ["doctorName", "tradingName", "address", "email", "profession"];
  if (keys.some((key) => !validKeys.includes(key)) || keys.length < 4 || keys.length > 5) return null;
  const profile = parseProfile(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "profession")),
  );
  if (!profile) return null;
  if (value.profession === undefined) return profile;
  return value.profession === "gp" || value.profession === "pharmacist"
    ? { ...profile, profession: value.profession }
    : null;
}

function parsePaymentDetails(value: unknown): BankDetails | null {
  if (!isRecord(value) || !hasExactKeys(value, ["accountName", "sortCode", "accountNumber"])) return null;
  if (
    typeof value.accountName !== "string" || typeof value.sortCode !== "string" ||
    typeof value.accountNumber !== "string"
  ) return null;
  return {
    accountName: value.accountName,
    sortCode: value.sortCode,
    accountNumber: value.accountNumber,
  };
}

function sameProfile(left: PublicProfile, right: PublicProfile) {
  return left.doctorName === right.doctorName && left.tradingName === right.tradingName &&
    left.address === right.address && left.email === right.email;
}

function parseReadyResponse(value: unknown): ProfilePaymentsReadyResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "state", "profile", "invoicePrefix", "paymentDetails", "paymentSummary",
    "encryptedSnapshot", "settingsRecord",
  ]) || value.state !== "ready") return null;
  const profile = parseProfile(value.profile);
  const paymentDetails = parsePaymentDetails(value.paymentDetails);
  const envelope = parseServerPaymentEnvelope(value.encryptedSnapshot);
  if (!profile || !paymentDetails || !envelope || typeof value.invoicePrefix !== "string") return null;
  const normalized = normalizeProfileAndPayments({ profile, invoicePrefix: value.invoicePrefix, paymentDetails });
  const normalizedDetails = normalized.paymentDetails;
  if (
    Object.keys(validateProfileAndPayments(normalized, true)).length ||
    !sameProfile(normalized.profile, profile) || normalized.invoicePrefix !== value.invoicePrefix ||
    !normalizedDetails || normalizedDetails.accountName !== paymentDetails.accountName ||
    normalizedDetails.sortCode !== paymentDetails.sortCode ||
    normalizedDetails.accountNumber !== paymentDetails.accountNumber
  ) return null;
  const summary = value.paymentSummary;
  if (
    !isRecord(summary) || !hasExactKeys(summary, ["accountName", "accountNumberLast4"]) ||
    summary.accountName !== paymentDetails.accountName ||
    summary.accountNumberLast4 !== paymentDetails.accountNumber.slice(-4)
  ) return null;
  const record = value.settingsRecord;
  if (
    !isRecord(record) || !hasExactKeys(record, ["id", "data", "revision", "updatedAt"]) ||
    typeof record.id !== "string" || !record.id || !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 1 || typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.updatedAt)) || !isRecord(record.data)
  ) return null;
  const data = record.data;
  if (!hasExactKeys(data, [
    "ciphertext", "salt", "initializationVector", "kdfParameters",
    "encryptionVersion", "profile", "invoicePrefix",
  ])) return null;
  const storedEnvelope = parseServerPaymentEnvelope({
    version: data.encryptionVersion,
    ciphertext: data.ciphertext,
    salt: data.salt,
    initializationVector: data.initializationVector,
    kdfParameters: data.kdfParameters,
  });
  const storedProfile = parseStoredProfile(data.profile);
  if (
    !storedEnvelope || !storedProfile || typeof data.invoicePrefix !== "string" ||
    !sameProfile(storedProfile, profile) || data.invoicePrefix !== value.invoicePrefix ||
    storedEnvelope.ciphertext !== envelope.ciphertext || storedEnvelope.salt !== envelope.salt ||
    storedEnvelope.initializationVector !== envelope.initializationVector
  ) return null;
  return {
    state: "ready",
    profile,
    invoicePrefix: value.invoicePrefix,
    paymentDetails,
    paymentSummary: {
      accountName: paymentDetails.accountName,
      accountNumberLast4: paymentDetails.accountNumber.slice(-4),
    },
    encryptedSnapshot: envelope,
    settingsRecord: {
      id: record.id,
      data,
      revision: Number(record.revision),
      updatedAt: record.updatedAt,
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export async function getProfileAndPayments(signal?: AbortSignal): Promise<ProfilePaymentsLoadResult> {
  const response = await fetch("/api/profile-and-payments", {
    cache: "no-store",
    credentials: "include",
    signal,
  });
  const body = await responseBody(response);
  if (response.status === 401) return { state: "unauthenticated" };
  if (response.status === 200 || response.status === 404) {
    const missing = parseSetupResponse(body, "missing");
    if (missing) return missing;
  }
  if (response.status === 409) {
    const upgrade = parseSetupResponse(body, "upgrade_required");
    if (upgrade) return upgrade;
  }
  if (!response.ok) return { state: "error" };
  return parseReadyResponse(body) ?? { state: "error" };
}

export async function putProfileAndPayments(input: ProfileAndPaymentsInput, signal?: AbortSignal) {
  const response = await fetch("/api/profile-and-payments", {
    method: "PUT",
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const body = await responseBody(response);
  if (response.status === 401) throw new ProfilePaymentsUnauthenticatedError();
  if (!response.ok) {
    throw new Error(response.status === 422 ? "Check the highlighted details." : "Settings could not be saved.");
  }
  const ready = parseReadyResponse(body);
  if (!ready) throw new Error("Settings could not be saved.");
  return ready;
}
