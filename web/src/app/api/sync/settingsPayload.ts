import type { RecordPayload } from "@/offline/types";

const SETTINGS_FIELDS = {
  ciphertext: "ciphertext",
  salt: "salt",
  initializationVector: "initialization_vector",
  kdfParameters: "kdf_parameters",
  encryptionVersion: "encryption_version",
  profile: "profile",
  invoicePrefix: "invoice_prefix",
} as const;

export function toDatabaseSettingsPayload(payload: RecordPayload) {
  return Object.fromEntries(
    Object.entries(SETTINGS_FIELDS)
      .filter(([clientField]) => Object.hasOwn(payload, clientField))
      .map(([clientField, databaseField]) => [
        databaseField,
        payload[clientField],
      ]),
  );
}

export function fromDatabaseSettingsPayload(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(SETTINGS_FIELDS)
      .filter(([, databaseField]) => row[databaseField] != null)
      .map(([clientField, databaseField]) => [
        clientField,
        row[databaseField],
      ]),
  );
}
