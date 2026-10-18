"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createLocumDatabase } from "@/offline/db";
import { useGoogleCalendar } from "@/features/calendar/GoogleCalendarProvider";
import { OfflineRepository } from "@/offline/repository";
import { flushReceiptQueue } from "@/offline/receiptQueue";
import type { StoredConflict } from "@/offline/types";
import {
  resolveConflict as resolveStoredConflict,
  SyncEngine,
  type SyncStatus,
} from "./client";

export function createSyncBarrier() {
  let stopped = false;
  let inFlight = 0;
  let resolveIdle: (() => void) | null = null;

  return {
    async run(work: () => Promise<void>) {
      if (stopped) return;
      inFlight += 1;
      try {
        await work();
      } finally {
        inFlight -= 1;
        if (inFlight === 0) resolveIdle?.();
      }
    },
    async stop() {
      stopped = true;
      if (inFlight === 0) return;
      await new Promise<void>((resolve) => { resolveIdle = resolve; });
    },
    hasStopped: () => stopped,
  };
}

type SyncContextValue = {
  ownerId: string;
  status: SyncStatus;
  conflicts: StoredConflict[];
  repository: OfflineRepository | null;
  ready: boolean;
  initializationError: boolean;
  markSaving: () => void;
  stopSync: () => Promise<void>;
  syncNow: () => Promise<void>;
  resolveConflict: (
    conflict: StoredConflict,
    choice: "local" | "server",
  ) => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export async function synchronizeWithDemoSeed({
  flushReceipts,
  seedDemo,
  syncRecords,
}: {
  flushReceipts: () => Promise<unknown> | unknown;
  seedDemo: () => Promise<boolean>;
  syncRecords: () => Promise<unknown>;
}) {
  await syncRecords();
  try {
    await seedDemo();
    await syncRecords();
  } catch {
    // Demo bootstrap is retried on the next successful online sync. It must
    // never make the owner's existing offline records unavailable.
  }
  await flushReceipts();
}

export async function synchronizeWorkspace({
  flushReceipts,
  seedDemo,
  syncCalendar,
  syncRecords,
}: {
  flushReceipts: () => Promise<unknown> | unknown;
  seedDemo: () => Promise<boolean>;
  syncCalendar: () => Promise<unknown>;
  syncRecords: () => Promise<unknown>;
}) {
  await synchronizeWithDemoSeed({ flushReceipts, seedDemo, syncRecords });
  try {
    void syncCalendar().catch(() => {
      // Google is optional and must never make canonical Locum Manager sync fail.
    });
  } catch {
    // Synchronous Calendar transport failures are optional too.
  }
}

export function SyncProvider({
  children,
  ownerId,
}: {
  children: ReactNode;
  ownerId: string;
}) {
  const { syncCalendarNow } = useGoogleCalendar();
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [conflicts, setConflicts] = useState<StoredConflict[]>([]);
  const [initializationError, setInitializationError] = useState(false);
  const syncBarrierRef = useRef<ReturnType<typeof createSyncBarrier> | null>(null);
  const [runtime, setRuntime] = useState<{
    engine: SyncEngine;
    repository: OfflineRepository;
    barrier: ReturnType<typeof createSyncBarrier>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const database = createLocumDatabase();
    const repository = new OfflineRepository(database, ownerId);
    const engine = new SyncEngine({ repository });
    const barrier = createSyncBarrier();
    syncBarrierRef.current = barrier;
    const unsubscribe = engine.subscribe((nextStatus) => {
      if (active) setStatus(nextStatus);
    });

    async function synchronize() {
      await synchronizeWorkspace({
        flushReceipts: () => flushReceiptQueue(repository),
        seedDemo: async () => {
          const response = await fetch("/api/demo-data", {
            cache: "no-store",
            credentials: "include",
            method: "POST",
          });
          if (!response.ok) throw new Error("Demo bootstrap is temporarily unavailable.");
          return true;
        },
        syncCalendar: syncCalendarNow,
        syncRecords: () => engine.syncNow(),
      });
    }

    async function start() {
      try {
        await barrier.run(async () => {
          await repository.initialize();
          if (!active || barrier.hasStopped()) return;
          setRuntime({ engine, repository, barrier });
          setConflicts(await repository.conflicts());
          if (!active || barrier.hasStopped()) return;
          await synchronize();
          if (active && !barrier.hasStopped()) setConflicts(await repository.conflicts());
        });
      } catch {
        if (active) {
          setInitializationError(true);
          setStatus("action-required");
        }
      }
    }

    const handleOnline = () => {
      void barrier.run(synchronize).then(async () => {
        if (active) setConflicts(await repository.conflicts());
      });
    };
    const handleOffline = () => void barrier.run(() => engine.syncNow());

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void start();

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (syncBarrierRef.current === barrier) syncBarrierRef.current = null;
      database.close();
    };
  }, [ownerId, syncCalendarNow]);

  const syncNow = useCallback(async () => {
    if (!runtime) return;
    await runtime.barrier.run(async () => synchronizeWorkspace({
      flushReceipts: () => flushReceiptQueue(runtime.repository),
      seedDemo: async () => {
        const response = await fetch("/api/demo-data", {
          cache: "no-store",
          credentials: "include",
          method: "POST",
        });
        if (!response.ok) throw new Error("Demo bootstrap is temporarily unavailable.");
        return true;
      },
      syncCalendar: syncCalendarNow,
      syncRecords: () => runtime.engine.syncNow(),
    }));
    setConflicts(await runtime.repository.conflicts());
  }, [runtime, syncCalendarNow]);

  const stopSync = useCallback(async () => {
    await syncBarrierRef.current?.stop();
  }, []);

  const resolveConflict = useCallback(
    async (conflict: StoredConflict, choice: "local" | "server") => {
      if (!runtime) return;
      await resolveStoredConflict(runtime.repository, conflict, choice);
      setConflicts(await runtime.repository.conflicts());
      if (choice === "local") {
        runtime.engine.markSaving();
        await runtime.barrier.run(() => runtime.engine.syncNow());
      }
    },
    [runtime],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      ownerId,
      status,
      conflicts,
      repository: runtime?.repository ?? null,
      ready: Boolean(runtime),
      initializationError,
      markSaving: () => runtime?.engine.markSaving(),
      stopSync,
      syncNow,
      resolveConflict,
    }),
    [conflicts, initializationError, ownerId, resolveConflict, runtime, status, stopSync, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync must be used inside SyncProvider.");
  return context;
}
