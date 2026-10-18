import type { OfflineRepository } from "@/offline/repository";
import type { OutboxMutation, StoredConflict } from "@/offline/types";

import type {
  SyncBatchRequest,
  SyncBatchResponse,
  SyncMutation,
} from "./protocol";

export type SyncStatus =
  | "offline"
  | "saving"
  | "syncing"
  | "synced"
  | "action-required";

export class SyncTransportError extends Error {
  constructor(readonly status: number, message = "Sync request failed") {
    super(message);
    this.name = "SyncTransportError";
  }
}

export type SyncTransport = (
  request: SyncBatchRequest,
) => Promise<SyncBatchResponse>;

type SyncEngineOptions = {
  repository: OfflineRepository;
  transport?: SyncTransport;
  isOnline?: () => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
  maxAttempts?: number;
};

const defaultTransport: SyncTransport = async (body) => {
  const response = await fetch("/api/sync", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new SyncTransportError(response.status);
  return (await response.json()) as SyncBatchResponse;
};

export class SyncEngine {
  private currentStatus: SyncStatus = "synced";
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly repository: OfflineRepository;
  private readonly transport: SyncTransport;
  private readonly isOnline: () => boolean;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => string;
  private readonly maxAttempts: number;
  private syncInProgress: Promise<void> | null = null;

  constructor(options: SyncEngineOptions) {
    this.repository = options.repository;
    this.transport = options.transport ?? defaultTransport;
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => window.setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  }

  get status() {
    return this.currentStatus;
  }

  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => this.listeners.delete(listener);
  }

  markSaving() {
    this.setStatus(this.isOnline() ? "saving" : "offline");
  }

  async syncNow() {
    if (this.syncInProgress) return this.syncInProgress;
    const sync = this.performSync();
    this.syncInProgress = sync;
    try {
      await sync;
    } finally {
      if (this.syncInProgress === sync) this.syncInProgress = null;
    }
  }

  private async performSync() {
    if (!this.isOnline()) {
      this.setStatus("offline");
      return;
    }

    const sendable = await this.repository.claimPendingMutations();
    const inFlightIds = sendable.map((mutation) => mutation.id);
    this.repository.markMutationsInFlight(inFlightIds);
    try {
      const cursor = await this.repository.syncCursor();
      const request: SyncBatchRequest = {
        cursor,
        mutations: sendable.map<SyncMutation>((mutation) => ({
          idempotencyKey: mutation.id,
          recordType: mutation.recordType,
          recordId: mutation.recordId,
          operation: mutation.operation,
          payload: mutation.payload,
          baseRevision: mutation.baseRevision,
          localRevision: mutation.localRevision,
          updatedAt: mutation.createdAt,
        })),
      };

      this.setStatus("syncing");
      const response = await this.sendWithRetry(request);
      if (!response) return;

      for (const applied of response.applied) {
        await this.repository.acknowledgeMutation(
          applied.mutationId,
          applied.serverRevision,
          applied.data,
          applied.updatedAt,
        );
      }

      for (const conflict of response.conflicts) {
        const storedConflict: StoredConflict = {
          ...conflict,
          ownerId: this.repository.ownerId,
          id: conflict.mutationId,
          createdAt: this.now(),
        };
        await this.repository.recordConflict(storedConflict);
      }

      for (const pulled of response.pulled) {
        await this.repository.applyServerRecordIfSynced(
          pulled.recordType,
          pulled.recordId,
          pulled.data,
          pulled.serverRevision,
          pulled.updatedAt,
          pulled.deletedAt ?? null,
        );
      }

      await this.repository.setSyncCursor(response.nextCursor);
      const [remaining, conflicts] = await Promise.all([
        this.repository.pendingMutations(),
        this.repository.conflicts(),
      ]);

      if (conflicts.length > 0) this.setStatus("action-required");
      else if (remaining.length > 0) this.setStatus("saving");
      else this.setStatus("synced");
    } finally {
      this.repository.releaseMutationsInFlight(inFlightIds);
    }
  }

  private async sendWithRetry(request: SyncBatchRequest) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.transport(request);
      } catch (error) {
        const status = error instanceof SyncTransportError ? error.status : 0;
        if (status === 401 || status === 403) {
          this.setStatus("action-required");
          return null;
        }

        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt === this.maxAttempts) {
          this.setStatus("saving");
          return null;
        }

        await this.sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }

    return null;
  }

  private setStatus(status: SyncStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.listeners.forEach((listener) => listener(status));
  }
}

export async function resolveConflict(
  repository: OfflineRepository,
  conflict: StoredConflict,
  choice: "local" | "server",
  dependencies: {
    now?: () => string;
    uuid?: () => string;
  } = {},
) {
  if (conflict.ownerId !== repository.ownerId) {
    throw new Error("The conflict does not belong to the active account.");
  }

  const now = dependencies.now?.() ?? new Date().toISOString();
  const table = repository.tableFor(conflict.recordType);
  await repository.database.transaction(
    "rw",
    table,
    repository.database.conflicts,
    repository.database.outbox,
    async () => {
      const current = await table.get([repository.ownerId, conflict.recordId]);
      if (!current) throw new Error("The conflicted record no longer exists.");

      await repository.database.conflicts.delete([
        repository.ownerId,
        conflict.id,
      ]);
      await repository.database.outbox.delete([
        repository.ownerId,
        conflict.mutationId,
      ]);

      if (choice === "server") {
        await table.put({
          ...current,
          data: conflict.serverData,
          serverRevision: conflict.serverRevision,
          syncState: "synced",
          updatedAt: conflict.serverUpdatedAt,
        });
        return;
      }

      const localRevision = current.localRevision + 1;
      const mutation: OutboxMutation = {
        ownerId: repository.ownerId,
        id: dependencies.uuid?.() ?? crypto.randomUUID(),
        recordType: conflict.recordType,
        recordId: conflict.recordId,
        operation: "upsert",
        payload: conflict.localData,
        baseRevision: conflict.serverRevision,
        localRevision,
        state: "pending",
        attempts: 0,
        createdAt: now,
        nextAttemptAt: null,
      };
      await table.put({
        ...current,
        data: conflict.localData,
        localRevision,
        serverRevision: conflict.serverRevision,
        syncState: "pending",
        updatedAt: now,
      });
      await repository.database.outbox.add(mutation);
    },
  );
}
