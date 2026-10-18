import { describe, expect, it, vi } from "vitest";

import {
  createSyncBarrier,
  synchronizeWithDemoSeed,
  synchronizeWorkspace,
} from "@/sync/SyncProvider";

describe("demo bootstrap synchronization", () => {
  it("pulls existing rows, seeds, then pulls the new demo rows", async () => {
    const calls: string[] = [];
    await synchronizeWithDemoSeed({
      flushReceipts: vi.fn(async () => { calls.push("receipts"); }),
      seedDemo: vi.fn(async () => { calls.push("seed"); return true; }),
      syncRecords: vi.fn(async () => { calls.push("sync"); }),
    });
    expect(calls).toEqual(["sync", "seed", "sync", "receipts"]);
  });

  it("keeps the app usable after a seed failure so the next sync can retry", async () => {
    const syncRecords = vi.fn().mockResolvedValue(undefined);
    const seedDemo = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(true);
    await expect(synchronizeWithDemoSeed({ flushReceipts: vi.fn(), seedDemo, syncRecords })).resolves.toBeUndefined();
    await expect(synchronizeWithDemoSeed({ flushReceipts: vi.fn(), seedDemo, syncRecords })).resolves.toBeUndefined();
    expect(seedDemo).toHaveBeenCalledTimes(2);
    expect(syncRecords).toHaveBeenCalledTimes(3);
  });
});

describe("workspace synchronization", () => {
  it("runs Calendar after canonical records, demo bootstrap, and receipts", async () => {
    const calls: string[] = [];
    await synchronizeWorkspace({
      flushReceipts: vi.fn(async () => { calls.push("receipts"); }),
      seedDemo: vi.fn(async () => { calls.push("seed"); return true; }),
      syncCalendar: vi.fn(async () => { calls.push("calendar"); }),
      syncRecords: vi.fn(async () => { calls.push("records"); }),
    });
    expect(calls).toEqual(["records", "seed", "records", "receipts", "calendar"]);
  });

  it("keeps canonical workspace sync successful when Calendar rejects", async () => {
    const flushReceipts = vi.fn();
    const seedDemo = vi.fn(async () => true);
    const syncCalendar = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const syncRecords = vi.fn();

    await expect(synchronizeWorkspace({
      flushReceipts,
      seedDemo,
      syncCalendar,
      syncRecords,
    })).resolves.toBeUndefined();
    expect(syncRecords).toHaveBeenCalledTimes(2);
    expect(flushReceipts).toHaveBeenCalledOnce();
    expect(syncCalendar).toHaveBeenCalledOnce();
  });

  it("returns canonical and financial sync before a slow Calendar settles", async () => {
    let settleCalendar: (() => void) | undefined;
    const calendar = new Promise<void>((resolve) => { settleCalendar = resolve; });
    const calls: string[] = [];
    const ordinaryStatus = { current: "saved" };
    const workspace = synchronizeWorkspace({
      flushReceipts: vi.fn(async () => { calls.push("receipts"); }),
      seedDemo: vi.fn(async () => { calls.push("seed"); return true; }),
      syncCalendar: vi.fn(() => { calls.push("calendar"); return calendar; }),
      syncRecords: vi.fn(async () => { calls.push("records"); }),
    });

    await expect(Promise.race([
      workspace.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 0)),
    ])).resolves.toBe("resolved");
    expect(calls).toEqual(["records", "seed", "records", "receipts", "calendar"]);
    expect(ordinaryStatus.current).toBe("saved");
    settleCalendar?.();
  });
});

describe("sign-out sync barrier", () => {
  it("drains an in-flight sync before stopping later sync writes", async () => {
    const barrier = createSyncBarrier();
    let finish: (() => void) | undefined;
    const running = barrier.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stopping = barrier.stop();
    const laterSync = vi.fn();

    await barrier.run(async () => { laterSync(); });
    expect(laterSync).not.toHaveBeenCalled();
    finish?.();
    await Promise.all([running, stopping]);
  });

  it("drains deferred initialization without starting runtime work after stop", async () => {
    const barrier = createSyncBarrier() as ReturnType<typeof createSyncBarrier> & { hasStopped?: () => boolean };
    let finishInitialize: (() => void) | undefined;
    const initialized = new Promise<void>((resolve) => { finishInitialize = resolve; });
    const runtimeWork = vi.fn();
    const synchronize = vi.fn();
    const starting = barrier.run(async () => {
      await initialized;
      if (barrier.hasStopped?.()) return;
      runtimeWork();
      await synchronize();
    });
    const stopping = barrier.stop();

    finishInitialize?.();
    await Promise.all([starting, stopping]);
    expect(runtimeWork).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  });
});
