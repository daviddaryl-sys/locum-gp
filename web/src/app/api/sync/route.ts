import { NextResponse } from "next/server";

import { createCalendarRepository } from "@/features/calendar/server/calendarRepository";
import { calendarFeatureEnabled } from "@/features/calendar/server/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RecordPayload, RecordStoreName } from "@/offline/types";
import { createClient } from "@/lib/supabase/server";
import {
  parseSyncBatchRequest,
  processSyncBatch,
  type MutationExecutor,
  type PulledRecord,
  type SyncMutation,
  type SyncMutationResult,
} from "@/sync/protocol";
import { fromDatabasePayload, toDatabasePayload } from "./payloadMappings";
import { protectSettingsMutation } from "@/sync/settingsProtection";

export const dynamic = "force-dynamic";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const TABLES = {
  practices: "practice_records",
  sessions: "session_records",
  invoices: "invoice_records",
  invoiceItems: "invoice_item_records",
  settings: "encrypted_bank_settings",
  expenseCategories: "expense_category_records",
  expenses: "expense_records",
} as const;

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function isFinalResult(
  value: unknown,
  mutation: SyncMutation,
): value is SyncMutationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    (result.kind === "applied" || result.kind === "conflict") &&
    result.mutationId === mutation.idempotencyKey &&
    result.recordType === mutation.recordType &&
    result.recordId === mutation.recordId
  );
}

function payloadMatches(serverData: RecordPayload, mutationData: RecordPayload) {
  return Object.entries(mutationData).every(
    ([key, value]) => JSON.stringify(serverData[key]) === JSON.stringify(value),
  );
}

class SupabaseMutationExecutor implements MutationExecutor {
  constructor(private readonly client: SupabaseClient) {}

  async execute(ownerId: string, mutation: SyncMutation) {
    const stored = await this.findReceipt(ownerId, mutation);
    if (stored) return stored;

    const reservation = await this.client.from("sync_mutation_receipts").insert({
      id: crypto.randomUUID(),
      owner_id: ownerId,
      idempotency_key: mutation.idempotencyKey,
      mutation_type: `${mutation.recordType}:${mutation.operation}`,
      result: { kind: "processing" },
    });

    if (reservation.error && reservation.error.code !== "23505") {
      throw new Error("Could not reserve the sync mutation.");
    }
    if (reservation.error?.code === "23505") {
      const duplicate = await this.findReceipt(ownerId, mutation);
      if (duplicate) return duplicate;
    }

    const result = await this.applyReservedMutation(ownerId, mutation);
    const finalized = await this.client
      .from("sync_mutation_receipts")
      .update({ result: result as never })
      .eq("owner_id", ownerId)
      .eq("idempotency_key", mutation.idempotencyKey);
    if (finalized.error) throw new Error("Could not finalize the sync mutation.");
    return result;
  }

  async pull(ownerId: string, cursor: string | null) {
    const pulled: PulledRecord[] = [];

    for (const recordType of Object.keys(TABLES) as RecordStoreName[]) {
      const table = TABLES[recordType];
      let query = this.client
        .from(table)
        .select("*")
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: true })
        .limit(200);
      if (cursor) query = query.gte("updated_at", cursor);
      const { data, error } = await query;
      if (error) throw new Error("Could not pull cloud records.");

      for (const rawRow of data ?? []) {
        const row = rawRow as unknown as Record<string, unknown>;
        pulled.push({
          recordType,
          recordId: String(row.id),
          data: fromDatabasePayload(recordType, row),
          serverRevision: Number(row.revision),
          updatedAt: String(row.updated_at),
          deletedAt: row.deleted_at ? String(row.deleted_at) : null,
        });
      }
    }

    pulled.sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.recordId.localeCompare(right.recordId),
    );
    const bounded = pulled.slice(0, 200);
    return {
      pulled: bounded,
      nextCursor: bounded.at(-1)?.updatedAt ?? cursor,
    };
  }

  private async findReceipt(ownerId: string, mutation: SyncMutation) {
    const { data, error } = await this.client
      .from("sync_mutation_receipts")
      .select("result")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", mutation.idempotencyKey)
      .maybeSingle();
    if (error) throw new Error("Could not check the sync mutation receipt.");
    return isFinalResult(data?.result, mutation) ? data.result : null;
  }

  private async applyReservedMutation(
    ownerId: string,
    mutation: SyncMutation,
  ): Promise<SyncMutationResult> {
    const table = TABLES[mutation.recordType];
    const { data: rawCurrent, error: readError } = await this.client
      .from(table)
      .select("*")
      .eq("owner_id", ownerId)
      .eq("id", mutation.recordId)
      .maybeSingle();
    if (readError) throw new Error("Could not read the cloud record.");

    const current = rawCurrent as unknown as Record<string, unknown> | null;
    const currentRevision = current ? Number(current.revision) : 0;
    const serverData = current
      ? fromDatabasePayload(mutation.recordType, current)
      : {};
    const protection = mutation.recordType === "settings"
      ? protectSettingsMutation(mutation.operation, mutation.payload, current)
      : { blocked: false, payload: mutation.payload };
    const canonicalServerData =
      mutation.recordType === "settings" && current?.encryption_version === 2
        ? protectSettingsMutation("delete", {}, current).payload
        : serverData;

    if (protection.blocked) {
      return this.conflictResult(
        mutation,
        current,
        canonicalServerData,
        currentRevision,
        protection.payload,
      );
    }

    if (
      current &&
      currentRevision === mutation.baseRevision + 1 &&
      ((mutation.operation === "delete" && Boolean(current.deleted_at)) ||
        (mutation.operation === "upsert" &&
          payloadMatches(serverData, protection.payload)))
    ) {
      return {
        kind: "applied",
        mutationId: mutation.idempotencyKey,
        recordType: mutation.recordType,
        recordId: mutation.recordId,
        data: serverData,
        serverRevision: currentRevision,
        updatedAt: String(current.updated_at),
      };
    }

    if (currentRevision !== mutation.baseRevision) {
      return this.conflictResult(
        mutation,
        current,
        canonicalServerData,
        currentRevision,
        protection.payload,
      );
    }

    const now = new Date().toISOString();
    if (!current && mutation.operation === "delete") {
      return {
        kind: "applied",
        mutationId: mutation.idempotencyKey,
        recordType: mutation.recordType,
        recordId: mutation.recordId,
        data: {},
        serverRevision: 0,
        updatedAt: now,
      };
    }

    const payload = {
      ...toDatabasePayload(mutation.recordType, protection.payload),
      revision: currentRevision + 1,
      updated_at: now,
      deleted_at: mutation.operation === "delete" ? now : null,
    };

    const write = current
      ? await this.client
          .from(table)
          .update(payload as never)
          .eq("owner_id", ownerId)
          .eq("id", mutation.recordId)
          .eq("revision", mutation.baseRevision)
          .select("*")
          .maybeSingle()
      : await this.client
          .from(table)
          .insert({
            ...payload,
            id: mutation.recordId,
            owner_id: ownerId,
          } as never)
          .select("*")
          .maybeSingle();

    if (write.error && write.error.code !== "23505") {
      throw new Error("Could not apply the cloud record.");
    }
    if (!write.data) {
      const reread = await this.client
        .from(table)
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", mutation.recordId)
        .maybeSingle();
      if (reread.error) throw new Error("Could not verify the cloud record.");
      const row = reread.data as unknown as Record<string, unknown> | null;
      const data = row ? fromDatabasePayload(mutation.recordType, row) : {};
      if (
        row &&
        Number(row.revision) === mutation.baseRevision + 1 &&
        payloadMatches(data, protection.payload)
      ) {
        return {
          kind: "applied",
          mutationId: mutation.idempotencyKey,
          recordType: mutation.recordType,
          recordId: mutation.recordId,
          data,
          serverRevision: Number(row.revision),
          updatedAt: String(row.updated_at),
        };
      }
      return this.conflictResult(
        mutation,
        row,
        mutation.recordType === "settings" && row?.encryption_version === 2
          ? protectSettingsMutation("delete", {}, row).payload
          : data,
        row ? Number(row.revision) : 0,
        mutation.recordType === "settings" && row?.encryption_version === 2
          ? protectSettingsMutation(mutation.operation, mutation.payload, row).payload
          : mutation.payload,
      );
    }

    const row = write.data as unknown as Record<string, unknown>;
    return {
      kind: "applied",
      mutationId: mutation.idempotencyKey,
      recordType: mutation.recordType,
      recordId: mutation.recordId,
      data: fromDatabasePayload(mutation.recordType, row),
      serverRevision: Number(row.revision),
      updatedAt: String(row.updated_at),
    };
  }

  private conflictResult(
    mutation: SyncMutation,
    current: Record<string, unknown> | null,
    serverData: RecordPayload,
    serverRevision: number,
    localData: RecordPayload = mutation.payload,
  ): SyncMutationResult {
    return {
      kind: "conflict",
      mutationId: mutation.idempotencyKey,
      recordType: mutation.recordType,
      recordId: mutation.recordId,
      localData,
      localUpdatedAt: mutation.updatedAt,
      serverData,
      serverRevision,
      serverUpdatedAt: current
        ? String(current.updated_at)
        : new Date(0).toISOString(),
    };
  }
}

export async function POST(request: Request) {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const ownerId = data?.claims?.sub;
    if (error || !ownerId) return noStoreJson({ error: "Unauthorized" }, 401);

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return noStoreJson({ error: "Invalid sync request" }, 400);
    }

    let syncRequest;
    try {
      syncRequest = parseSyncBatchRequest(parsedBody);
    } catch {
      return noStoreJson({ error: "Invalid sync request" }, 400);
    }

    const response = await processSyncBatch(
      ownerId,
      syncRequest,
      new SupabaseMutationExecutor(client),
    );
    const appliedMutationIds = new Set(
      response.applied.map((mutation) => mutation.mutationId),
    );
    const shouldReconcileCalendar = syncRequest.mutations.some(
      (mutation) =>
        mutation.recordType === "sessions" &&
        mutation.payload.isDemo !== true &&
        appliedMutationIds.has(mutation.idempotencyKey),
    );
    if (calendarFeatureEnabled() && shouldReconcileCalendar) {
      try {
        const at = new Date().toISOString();
        await createCalendarRepository(createAdminClient()).reconcileJobs(
          ownerId,
          at,
          at,
        );
      } catch {
        // Calendar reconciliation is best effort and never changes sync results.
      }
    }
    return noStoreJson(response);
  } catch {
    return noStoreJson({ error: "Sync is temporarily unavailable" }, 503);
  }
}
