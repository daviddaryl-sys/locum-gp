import { NextResponse } from "next/server";

import {
  normalizeProfileAndPayments,
  type ProfileAndPaymentsInput,
  type ProfilePaymentsReadyResponse,
  type PublicProfile,
  validateProfileAndPayments,
} from "@/features/settings/profilePaymentsDomain";
import { createClient } from "@/lib/supabase/server";
import type { RecordPayload } from "@/offline/types";
import {
  parseServerPaymentEnvelope,
  type ServerPaymentEnvelope,
} from "@/security/paymentEnvelope";
import {
  decryptPaymentDetailsV2,
  encryptPaymentDetailsV2,
} from "@/security/serverPaymentEnvelope";

export const dynamic = "force-dynamic";

type SettingsRow = Record<string, unknown>;

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseProfile(value: unknown): PublicProfile | null {
  if (!isRecord(value)) return null;
  const doctorName = stringValue(value.doctorName);
  const tradingName = stringValue(value.tradingName);
  const address = stringValue(value.address);
  const email = stringValue(value.email);
  return doctorName !== null && tradingName !== null && address !== null && email !== null
    ? { doctorName, tradingName, address, email }
    : null;
}

function preservedProfession(value: unknown): "gp" | "pharmacist" | null {
  if (!isRecord(value)) return null;
  return value.profession === "gp" || value.profession === "pharmacist"
    ? value.profession
    : null;
}

function profileForStorage(profile: PublicProfile, existing: unknown) {
  const profession = preservedProfession(existing);
  return profession ? { ...profile, profession } : profile;
}

function parseInput(value: unknown): ProfileAndPaymentsInput | null {
  if (!isRecord(value)) return null;
  const profile = parseProfile(value.profile);
  const invoicePrefix = stringValue(value.invoicePrefix);
  if (!profile || invoicePrefix === null) return null;
  if (value.paymentDetails === undefined) return { profile, invoicePrefix };
  if (!isRecord(value.paymentDetails)) return null;
  const accountName = stringValue(value.paymentDetails.accountName);
  const sortCode = stringValue(value.paymentDetails.sortCode);
  const accountNumber = stringValue(value.paymentDetails.accountNumber);
  if (accountName === null || sortCode === null || accountNumber === null) return null;
  return { profile, invoicePrefix, paymentDetails: { accountName, sortCode, accountNumber } };
}

function envelopeFromRow(row: SettingsRow): ServerPaymentEnvelope | null {
  return parseServerPaymentEnvelope({
    version: row.encryption_version,
    ciphertext: row.ciphertext,
    salt: row.salt,
    initializationVector: row.initialization_vector,
    kdfParameters: row.kdf_parameters,
  });
}

function recordPayload(row: SettingsRow, envelope: ServerPaymentEnvelope): RecordPayload {
  return {
    ciphertext: envelope.ciphertext,
    salt: envelope.salt,
    initializationVector: envelope.initializationVector,
    kdfParameters: envelope.kdfParameters,
    encryptionVersion: envelope.version,
    profile: row.profile,
    invoicePrefix: row.invoice_prefix,
  };
}

function setupResponse(
  state: "missing" | "upgrade_required",
  row: SettingsRow,
) {
  const profile = parseProfile(row.profile);
  const invoicePrefix = stringValue(row.invoice_prefix);
  return profile && invoicePrefix !== null
    ? { state, profile, invoicePrefix }
    : { state };
}

async function readyResponse(
  ownerId: string,
  row: SettingsRow,
): Promise<ProfilePaymentsReadyResponse> {
  const envelope = envelopeFromRow(row);
  const profile = parseProfile(row.profile);
  const invoicePrefix = stringValue(row.invoice_prefix);
  const id = stringValue(row.id);
  const updatedAt = stringValue(row.updated_at);
  const revision = row.revision;
  if (
    !envelope || !profile || invoicePrefix === null || id === null ||
    updatedAt === null || typeof revision !== "number" || !Number.isSafeInteger(revision)
  ) {
    throw new Error("Invalid profile and payments record.");
  }
  const paymentDetails = await decryptPaymentDetailsV2(ownerId, envelope);
  return {
    state: "ready",
    profile,
    invoicePrefix,
    paymentDetails,
    paymentSummary: {
      accountName: paymentDetails.accountName,
      accountNumberLast4: paymentDetails.accountNumber.slice(-4),
    },
    encryptedSnapshot: envelope,
    settingsRecord: {
      id,
      data: recordPayload(row, envelope),
      revision,
      updatedAt,
    },
  };
}

async function readSettings() {
  const client = await createClient();
  const { data: auth, error: authError } = await client.auth.getClaims();
  const ownerId = auth?.claims?.sub;
  if (authError || !ownerId) return { client, ownerId: null, row: null };
  const { data, error } = await client
    .from("encrypted_bank_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error("Could not read profile and payments.");
  return { client, ownerId, row: data as unknown as SettingsRow | null };
}

export async function GET() {
  try {
    const { ownerId, row } = await readSettings();
    if (!ownerId) return noStoreJson({ error: "Unauthorized" }, 401);
    if (!row) return noStoreJson({ state: "missing" });
    if (row.encryption_version === null) return noStoreJson(setupResponse("missing", row));
    if (row.encryption_version === 1) return noStoreJson(setupResponse("upgrade_required", row), 409);
    if (row.encryption_version !== 2) throw new Error("Unsupported encryption version.");
    return noStoreJson(await readyResponse(ownerId, row));
  } catch {
    return noStoreJson({ error: "Profile and payments are temporarily unavailable" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    const { client, ownerId, row } = await readSettings();
    if (!ownerId) return noStoreJson({ error: "Unauthorized" }, 401);
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return noStoreJson({ error: "Invalid profile and payments request" }, 400);
    }
    const parsed = parseInput(rawBody);
    if (!parsed) {
      return noStoreJson({ errors: { request: "Enter valid profile and payment details." } }, 422);
    }
    const paymentRequired = !row || row.encryption_version !== 2;
    if (row && row.encryption_version !== null && row.encryption_version !== 1 && row.encryption_version !== 2) {
      throw new Error("Unsupported encryption version.");
    }
    const errors = validateProfileAndPayments(parsed, paymentRequired);
    if (Object.keys(errors).length) return noStoreJson({ errors }, 422);
    const input = normalizeProfileAndPayments(parsed);

    let envelope: ServerPaymentEnvelope;
    if (input.paymentDetails) {
      envelope = await encryptPaymentDetailsV2(ownerId, input.paymentDetails);
    } else if (row) {
      const existing = envelopeFromRow(row);
      if (!existing) throw new Error("Invalid payment envelope.");
      envelope = existing;
    } else {
      throw new Error("Payment details are required.");
    }

    const payload = {
      profile: profileForStorage(input.profile, row?.profile),
      invoice_prefix: input.invoicePrefix,
      encryption_version: 2,
      ciphertext: envelope.ciphertext,
      salt: envelope.salt,
      initialization_vector: envelope.initializationVector,
      kdf_parameters: envelope.kdfParameters,
      deleted_at: null,
    };
    const write = row
      ? await client
          .from("encrypted_bank_settings")
          .update({
            ...payload,
            revision: Number(row.revision) + 1,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("owner_id", ownerId)
          .eq("revision", Number(row.revision))
          .select("*")
          .maybeSingle()
      : await client
          .from("encrypted_bank_settings")
          .insert({ id: ownerId, owner_id: ownerId, revision: 1, ...payload } as never)
          .select("*")
          .maybeSingle();
    if (write.error) {
      if (write.error.code === "23505") {
        return noStoreJson({ error: "Profile and payments changed elsewhere" }, 409);
      }
      throw new Error("Could not save profile and payments.");
    }
    if (!write.data) return noStoreJson({ error: "Profile and payments changed elsewhere" }, 409);
    return noStoreJson(await readyResponse(ownerId, write.data as unknown as SettingsRow));
  } catch {
    return noStoreJson({ error: "Profile and payments are temporarily unavailable" }, 503);
  }
}
