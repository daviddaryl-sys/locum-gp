import type { RecordPayload } from "./types";
import type { OfflineRepository } from "./repository";
import type { ReceiptQueueEntry } from "./types";

export type ReceiptTransportResult = {
  data: RecordPayload;
  revision: number;
  updatedAt: string;
} | null;

export type ReceiptTransport = (
  entry: ReceiptQueueEntry,
) => Promise<ReceiptTransportResult>;

export const fetchReceiptOperation: ReceiptTransport = async (entry) => {
  const endpoint = `/api/expenses/${entry.expenseId}/receipt`;
  if (entry.operation === "delete") {
    const response = await fetch(`${endpoint}?objectKey=${encodeURIComponent(entry.objectKey)}`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Receipt deletion failed.");
    return null;
  }

  if (!entry.blob) throw new Error("Queued receipt content is unavailable.");
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": entry.mimeType,
      "X-Receipt-Object-Key": encodeURIComponent(entry.objectKey),
      "X-Receipt-Original-Name": encodeURIComponent(entry.originalName),
    },
    body: entry.blob,
  });
  if (!response.ok) throw new Error("Receipt upload failed.");
  return (await response.json()) as Exclude<ReceiptTransportResult, null>;
};

export async function flushReceiptQueue(
  repository: OfflineRepository,
  transport: ReceiptTransport = fetchReceiptOperation,
): Promise<{ uploaded: number; deleted: number; failed: number }> {
  const result = { uploaded: 0, deleted: 0, failed: 0 };

  for (const entry of await repository.pendingReceiptOperations()) {
    const expense = await repository.getRecord("expenses", entry.expenseId);
    if (!expense || expense.syncState !== "synced") continue;

    try {
      const response = await transport(entry);
      if (entry.operation === "upload") {
        if (!response) throw new Error("Receipt upload response was incomplete.");
        const completion = await repository.completeReceiptUpload(entry, response);
        if (completion.state !== "completed") {
          if (completion.state === "stale") {
            await repository.queueReceiptDeleteIfAbsent(entry.expenseId, entry.objectKey);
            result.uploaded += 1;
          }
          continue;
        }
        result.uploaded += 1;
        if (completion.cleanup) {
          try {
            await transport(completion.cleanup);
            if (await repository.acknowledgeReceiptOperation(completion.cleanup.id, completion.cleanup.version)) result.deleted += 1;
          } catch {
            await repository.failReceiptOperation(completion.cleanup.id, completion.cleanup.version);
            result.failed += 1;
          }
        }
      } else {
        if (await repository.acknowledgeReceiptOperation(entry.id, entry.version)) result.deleted += 1;
      }
    } catch {
      await repository.failReceiptOperation(entry.id, entry.version);
      result.failed += 1;
    }
  }

  return result;
}
