"use client";

import { useLiveQuery } from "dexie-react-hooks";

import type { RecordStoreName } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

export function useOfflineRecords(recordType: RecordStoreName) {
  const { repository } = useSync();

  return useLiveQuery(async () => {
    if (!repository) return [];
    const records = await repository
      .tableFor(recordType)
      .where("ownerId")
      .equals(repository.ownerId)
      .toArray();
    return records
      .filter((record) => !record.deletedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [recordType, repository]);
}

export function useOfflineRecord(recordType: RecordStoreName, id: string) {
  const { repository } = useSync();

  return useLiveQuery(
    async () => (repository ? repository.getRecord(recordType, id) : undefined),
    [id, recordType, repository],
  );
}
