import type { RecordPayload } from "@/offline/types";

const PUBLIC_PROFILE_FIELDS = new Set([
  "profession",
  "doctorName",
  "tradingName",
  "address",
  "email",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicProfileMetadata(value: unknown) {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([field, fieldValue]) =>
      PUBLIC_PROFILE_FIELDS.has(field) &&
      (field === "profession"
        ? fieldValue === "gp" || fieldValue === "pharmacist"
        : typeof fieldValue === "string")),
  );
}

function mergedProfile(payload: RecordPayload, current: Record<string, unknown>) {
  const existing = publicProfileMetadata(current.profile);
  const incoming = publicProfileMetadata(payload.profile);
  if (Object.keys(existing).length === 0 && Object.keys(incoming).length === 0) return undefined;
  return { ...existing, ...incoming };
}

export function protectSettingsMutation(
  operation: "upsert" | "delete",
  payload: RecordPayload,
  current: Record<string, unknown> | null,
) {
  if (current?.encryption_version !== 2) return { blocked: false, payload };

  const profile = mergedProfile(payload, current);
  const invoicePrefix = typeof payload.invoicePrefix === "string"
    ? payload.invoicePrefix
    : typeof current.invoice_prefix === "string"
      ? current.invoice_prefix
      : undefined;
  const canonical = {
    ciphertext: current.ciphertext,
    salt: current.salt,
    initializationVector: current.initialization_vector,
    kdfParameters: current.kdf_parameters,
    encryptionVersion: 2,
    ...(profile ? { profile } : {}),
    ...(invoicePrefix ? { invoicePrefix } : {}),
  };

  return { blocked: operation === "delete", payload: canonical };
}
