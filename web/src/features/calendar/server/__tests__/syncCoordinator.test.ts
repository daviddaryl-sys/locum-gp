// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GoogleCalendarError } from "../googleCalendarApi";
import { GoogleOAuthError } from "../oauth";
import { eventIdForSession } from "../eventProjection";
import type { GoogleCalendarGateway } from "../googleCalendarApi";
import type {
  CalendarConnection,
  CalendarJob,
  CalendarJobRecord,
  CalendarRepository,
  CalendarSyncSummary,
} from "../calendarRepository";
import {
  synchronizeOwnerCalendar,
  type CalendarSyncDependencies,
} from "../syncCoordinator";

const ownerId = "owner-fixture";
const now = new Date("2026-08-05T10:00:00.000Z");
const envelope = {
  version: 1 as const,
  iv: "aXYtZml4dHVyZQ==",
  ciphertext: "Y2lwaGVydGV4dA==",
  tag: "dGFnLWZpeHR1cmU=",
};

const connection: CalendarConnection = {
  ownerId,
  status: "connected",
  calendarId: "calendar-fixture",
  refreshTokenEnvelope: envelope,
  connectedAt: "2026-08-05T09:00:00.000Z",
  lastSyncAt: null,
};

const job: CalendarJob = {
  ownerId,
  sessionId: "session-fixture",
  desiredAction: "upsert",
  targetRevision: 4,
  attempts: 0,
  nextAttemptAt: now.toISOString(),
  claimToken: "10000000-0000-4000-8000-000000000001",
  leaseExpiresAt: "2026-08-05T10:05:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function recordFor(
  status: CalendarJobRecord["session"]["status"],
  overrides: Partial<CalendarJobRecord["session"]> = {},
): CalendarJobRecord {
  return {
    session: {
      id: "session-fixture",
      practiceId: "practice-fixture",
      startsAt: "2026-08-11T09:00:00.000Z",
      endsAt: "2026-08-11T15:00:00.000Z",
      status,
      revision: 4,
      deletedAt: null,
      isDemo: false,
      ...overrides,
    },
    practice: {
      name: "Fictional Medical Centre",
      billingAddress: { formatted: "12 Sample Road, London" },
    },
  };
}

type RepositoryFake = CalendarRepository & {
  [K in keyof CalendarRepository]: ReturnType<typeof vi.fn>;
};

type GatewayFake = GoogleCalendarGateway & {
  [K in keyof GoogleCalendarGateway]: ReturnType<typeof vi.fn>;
};

function summary(
  values: Partial<CalendarSyncSummary> = {},
): CalendarSyncSummary {
  return {
    state: "connected",
    pendingCount: 0,
    lastSyncAt: now.toISOString(),
    nextRetryAt: null,
    ...values,
  };
}

function dependenciesFor(
  status: CalendarJobRecord["session"]["status"],
  options: {
    connection?: CalendarConnection | null;
    dueJobs?: CalendarJob[];
    record?: CalendarJobRecord;
    statusSummary?: CalendarSyncSummary;
  } = {},
) {
  let claimCall = 0;
  const repository = {
    getConnection: vi.fn(async () =>
      options.connection === undefined ? connection : options.connection,
    ),
    saveConnection: vi.fn(async () => undefined),
    markReconnectRequired: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    reconcileJobs: vi.fn(async () => undefined),
    claimDueJobs: vi.fn(async () =>
      claimCall++ === 0 ? (options.dueJobs ?? [job]) : [],
    ),
    loadJobRecord: vi.fn(async () => options.record ?? recordFor(status)),
    eventLink: vi.fn(async () => null),
    completeUpsert: vi.fn(async () => "completed" as const),
    completeDelete: vi.fn(async () => "completed" as const),
    retry: vi.fn(async () => "scheduled" as const),
    claimCalendarReplacement: vi.fn(async () => ({ state: "create" as const })),
    stageCalendarReplacement: vi.fn(async () => true),
    completeCalendarReplacement: vi.fn(async () => "completed" as const),
    releaseCalendarReplacement: vi.fn(async () => true),
    status: vi.fn(async () => options.statusSummary ?? summary()),
  } as RepositoryFake;
  const gateway = {
    createCalendar: vi.fn(async () => "calendar-replacement"),
    calendarExists: vi.fn(async () => true),
    upsertEvent: vi.fn(async () => undefined),
    deleteEvent: vi.fn(async () => undefined),
  } as GatewayFake;
  const dependencies: CalendarSyncDependencies = {
    repository,
    gateway,
    now: () => new Date(now),
    eventIdKey: Buffer.alloc(32, 9),
    decryptRefreshToken: vi.fn(() => "refresh-fixture"),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: "access-fixture",
      expiresIn: 3600,
    })),
    newClaimToken: () => "20000000-0000-4000-8000-000000000001",
  };
  return { dependencies, repository, gateway };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("owner Calendar synchronization", () => {
  it.each([
    ["planned", "Locum session — Fictional Medical Centre"],
    ["completed", "Locum session — Fictional Medical Centre"],
    ["invoiced", "Locum session — Fictional Medical Centre"],
    ["cancelled", "Cancelled — Fictional Medical Centre"],
  ] as const)("upserts the latest canonical %s state once", async (status, expected) => {
    const { dependencies, repository, gateway } = dependenciesFor(status);

    const result = await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(result.state).toBe("connected");
    expect(gateway.upsertEvent).toHaveBeenCalledWith(
      "access-fixture",
      "calendar-fixture",
      expect.objectContaining({ summary: expected }),
    );
    expect(repository.completeUpsert).toHaveBeenCalledOnce();
  });

  it("removes the linked Google event for a soft-deleted session", async () => {
    const deletedJob = { ...job, desiredAction: "delete" as const };
    const { dependencies, repository, gateway } = dependenciesFor("cancelled", {
      dueJobs: [deletedJob],
      record: recordFor("cancelled", {
        deletedAt: "2026-08-05T09:30:00.000Z",
      }),
    });
    repository.eventLink.mockResolvedValue({
      ownerId,
      sessionId: job.sessionId,
      calendarId: "calendar-fixture",
      eventId: "event-fixture",
      lastAppliedRevision: 3,
      state: "delete_pending",
    });

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(gateway.deleteEvent).toHaveBeenCalledWith(
      "access-fixture",
      "calendar-fixture",
      "event-fixture",
    );
    expect(repository.completeDelete).toHaveBeenCalledWith(
      ownerId,
      deletedJob,
      "calendar-fixture",
      now.toISOString(),
    );
  });

  it("does not let a stale target revision overwrite the latest canonical state", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      dueJobs: [{ ...job, targetRevision: 3 }],
    });

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(gateway.upsertEvent).not.toHaveBeenCalled();
    expect(repository.completeUpsert).not.toHaveBeenCalled();
  });

  it("uses one deterministic id after a lost response so retries do not duplicate", async () => {
    let retryClock = now.getTime();
    let claimsIssued = 0;
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      statusSummary: summary({
        state: "pending",
        pendingCount: 1,
        nextRetryAt: "2026-08-05T10:00:30.000Z",
      }),
    });
    gateway.upsertEvent
      .mockRejectedValueOnce(new GoogleCalendarError("transient"))
      .mockResolvedValueOnce(undefined);
    repository.claimDueJobs
      .mockReset()
      .mockImplementation(async (_owner, claimedAt) => {
        if (claimsIssued === 0) {
          claimsIssued += 1;
          return [job];
        }
        if (
          claimsIssued === 1 &&
          Date.parse(claimedAt) >= now.getTime() + 30_000
        ) {
          claimsIssued += 1;
          return [
            {
              ...job,
              claimToken: "10000000-0000-4000-8000-000000000002",
              leaseExpiresAt: "2026-08-05T10:05:30.000Z",
            },
          ];
        }
        return [];
      });
    dependencies.now = () => new Date(retryClock);

    await synchronizeOwnerCalendar(ownerId, dependencies);
    retryClock += 30_000;
    await synchronizeOwnerCalendar(ownerId, dependencies);

    const ids = gateway.upsertEvent.mock.calls.map((call) => call[2].id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(repository.retry).toHaveBeenCalledOnce();
    expect(repository.completeUpsert).toHaveBeenCalledOnce();
  });

  it("recreates an absent dedicated calendar and reconciles current work once", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned");
    gateway.calendarExists.mockResolvedValue(false);

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(gateway.createCalendar).toHaveBeenCalledOnce();
    expect(repository.completeCalendarReplacement).toHaveBeenCalledWith(
      ownerId,
      "calendar-fixture",
      "20000000-0000-4000-8000-000000000001",
      "calendar-replacement",
      now.toISOString(),
    );
    expect(repository.reconcileJobs).toHaveBeenCalledOnce();
    expect(repository.reconcileJobs).toHaveBeenCalledWith(
      ownerId,
      now.toISOString(),
      now.toISOString(),
    );
    expect(gateway.upsertEvent).toHaveBeenCalledWith(
      "access-fixture",
      "calendar-replacement",
      expect.any(Object),
    );
  });

  it("marks the connection reconnect-required after invalid_grant", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      statusSummary: summary({ state: "reconnect_required" }),
    });
    dependencies.refreshAccessToken = vi.fn(async () => {
      throw new GoogleOAuthError("authorization");
    });

    const result = await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(repository.markReconnectRequired).toHaveBeenCalledWith(
      ownerId,
      now.toISOString(),
    );
    expect(gateway.upsertEvent).not.toHaveBeenCalled();
    expect(result.state).toBe("reconnect_required");
  });

  it.each([
    [0, 30_000],
    [1, 2 * 60_000],
    [2, 10 * 60_000],
    [3, 60 * 60_000],
    [8, 60 * 60_000],
  ])("schedules transient attempt %s after %s ms", async (attempts, delay) => {
    const retryJob = { ...job, attempts };
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      dueJobs: [retryJob],
      statusSummary: summary({ state: "pending", pendingCount: 1 }),
    });
    gateway.upsertEvent.mockRejectedValue(new GoogleCalendarError("transient"));

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(repository.retry).toHaveBeenCalledWith(
      ownerId,
      retryJob,
      "transient",
      new Date(now.getTime() + delay).toISOString(),
      now.toISOString(),
    );
  });

  it("never sends demo jobs to Google", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      record: recordFor("planned", { isDemo: true }),
    });

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(gateway.upsertEvent).not.toHaveBeenCalled();
    expect(repository.completeDelete).toHaveBeenCalledWith(
      ownerId,
      job,
      "calendar-fixture",
      now.toISOString(),
    );
  });

  it("returns disabled and not-connected summaries without provider access", async () => {
    const disabled = dependenciesFor("planned");
    disabled.dependencies.enabled = false;
    await expect(
      synchronizeOwnerCalendar(ownerId, disabled.dependencies),
    ).resolves.toEqual({
      state: "disabled",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    });
    expect(disabled.gateway.calendarExists).not.toHaveBeenCalled();

    const absent = dependenciesFor("planned", {
      connection: null,
      statusSummary: summary({
        state: "not_connected",
        pendingCount: 0,
        lastSyncAt: null,
      }),
    });
    await expect(
      synchronizeOwnerCalendar(ownerId, absent.dependencies),
    ).resolves.toMatchObject({ state: "not_connected" });
    expect(absent.gateway.calendarExists).not.toHaveBeenCalled();
  });

  it("contains an unexpected Google exception inside the public summary", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      statusSummary: summary({ state: "pending", pendingCount: 1 }),
    });
    gateway.calendarExists.mockRejectedValue(new Error("private provider text"));

    await expect(
      synchronizeOwnerCalendar(ownerId, dependencies),
    ).resolves.toEqual(summary({ state: "pending", pendingCount: 1 }));
    expect(repository.status).toHaveBeenCalledWith(ownerId);
  });

  it.each([
    ["upsert", "upsert"],
    ["delete", "upsert"],
  ] as const)(
    "durably serializes deferred revision 4 %s before revision 5 %s",
    async (initialAction, nextAction) => {
      let desired = { action: initialAction, revision: 4 };
      let claimed: CalendarJob | null = null;
      let jobExists = true;
      let claimSequence = 0;
      const providerGate = deferred<void>();
      const providerOrder: string[] = [];
      const makeJob = (action = desired.action, revision = desired.revision) => ({
        ...job,
        desiredAction: action,
        targetRevision: revision,
        claimToken: `10000000-0000-4000-8000-${String(++claimSequence).padStart(12, "0")}`,
        leaseExpiresAt: "2026-08-05T10:05:00.000Z",
      });
      const repository = {
        getConnection: vi.fn(async () => connection),
        saveConnection: vi.fn(async () => undefined),
        markReconnectRequired: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
        reconcileJobs: vi.fn(async () => undefined),
        dueJobs: vi.fn(async () => [makeJob()]),
        claimDueJobs: vi.fn(async () => {
          if (claimed || !jobExists) return [];
          claimed = makeJob();
          return [claimed];
        }),
        loadJobRecord: vi.fn(async () =>
          recordFor(desired.action === "delete" ? "cancelled" : "planned", {
            revision: desired.revision,
            deletedAt:
              desired.action === "delete"
                ? "2026-08-05T09:30:00.000Z"
                : null,
          }),
        ),
        eventLink: vi.fn(async () => ({
          ownerId,
          sessionId: job.sessionId,
          calendarId: "calendar-fixture",
          eventId: "event-fixture",
          lastAppliedRevision: 3,
          state: "active" as const,
        })),
        completeUpsert: vi.fn(async (_owner, completedJob) => {
          claimed = null;
          const isCurrent =
            completedJob.targetRevision === desired.revision &&
            completedJob.desiredAction === desired.action;
          if (isCurrent) jobExists = false;
          return isCurrent ? "completed" : "superseded";
        }),
        completeDelete: vi.fn(async (_owner, completedJob) => {
          claimed = null;
          const isCurrent =
            completedJob.targetRevision === desired.revision &&
            completedJob.desiredAction === desired.action;
          if (isCurrent) jobExists = false;
          return isCurrent ? "completed" : "superseded";
        }),
        retry: vi.fn(async () => undefined),
        replaceCalendar: vi.fn(async () => undefined),
        claimCalendarReplacement: vi.fn(async () => ({ state: "busy" as const })),
        stageCalendarReplacement: vi.fn(async () => false),
        completeCalendarReplacement: vi.fn(async () => "stale_claim" as const),
        releaseCalendarReplacement: vi.fn(async () => undefined),
        status: vi.fn(async () => summary()),
      };
      const gateway = {
        createCalendar: vi.fn(async () => "calendar-replacement"),
        calendarExists: vi.fn(async () => true),
        upsertEvent: vi.fn(async () => {
          providerOrder.push("upsert");
          if (providerOrder.length === 1) await providerGate.promise;
        }),
        deleteEvent: vi.fn(async () => {
          providerOrder.push("delete");
          if (providerOrder.length === 1) await providerGate.promise;
        }),
      };
      const dependencies = {
        repository,
        gateway,
        now: () => new Date(now),
        eventIdKey: Buffer.alloc(32, 9),
        decryptRefreshToken: () => "refresh-fixture",
        refreshAccessToken: async () => ({
          accessToken: "access-fixture",
          expiresIn: 3600,
        }),
      } as unknown as CalendarSyncDependencies;

      const first = synchronizeOwnerCalendar(ownerId, dependencies);
      await vi.waitFor(() => expect(providerOrder).toHaveLength(1));
      desired = { action: nextAction, revision: 5 };
      await synchronizeOwnerCalendar(ownerId, dependencies);
      const callsWhileOlderRequestWasDeferred = providerOrder.length;
      providerGate.resolve();
      await first;
      await synchronizeOwnerCalendar(ownerId, dependencies);

      expect(callsWhileOlderRequestWasDeferred).toBe(1);
      expect(providerOrder).toEqual([initialAction, nextAction]);
    },
  );

  it.each(["upsert", "delete"] as const)(
    "claims each slow %s operation immediately before Google without an expired later-job race",
    async (laterAction) => {
      let clock = now.getTime();
      let claimSequence = 0;
      const eventIdKey = Buffer.alloc(32, 9);
      const operations = Array.from({ length: 6 }, (_, index) => ({
        sessionId: `session-slow-${index + 1}`,
        action: (index === 4 ? laterAction : "upsert") as "upsert" | "delete",
      }));
      const laterSessionId = operations[4].sessionId;
      const finalSessionId = operations[5].sessionId;
      const completed = new Set<string>();
      const claims = new Map<string, { token: string; leaseUntil: number }>();
      const claimHistory: Array<{ sessionId: string; claimedAt: number }> = [];
      const providerCalls: Array<{
        sessionId: string;
        action: "upsert" | "delete";
      }> = [];
      const eventSessions = new Map(
        operations.map((operation) => [
          eventIdForSession(ownerId, operation.sessionId, eventIdKey),
          operation.sessionId,
        ]),
      );
      const laterGate = deferred<void>();
      const claimDueJobs = vi.fn(
        async (_owner: string, claimedAt: string, leaseUntil: string, limit: number) => {
          const claimedAtMs = Date.parse(claimedAt);
          return operations
            .filter((operation) => {
              const active = claims.get(operation.sessionId);
              return (
                !completed.has(operation.sessionId) &&
                (!active || active.leaseUntil <= claimedAtMs)
              );
            })
            .slice(0, limit)
            .map((operation) => {
              const token = `30000000-0000-4000-8000-${String(
                ++claimSequence,
              ).padStart(12, "0")}`;
              claims.set(operation.sessionId, {
                token,
                leaseUntil: Date.parse(leaseUntil),
              });
              claimHistory.push({
                sessionId: operation.sessionId,
                claimedAt: claimedAtMs,
              });
              return {
                ...job,
                sessionId: operation.sessionId,
                desiredAction: operation.action,
                claimToken: token,
                nextAttemptAt: claimedAt,
                leaseExpiresAt: leaseUntil,
              };
            });
        },
      );
      const complete = async (_owner: string, completedJob: CalendarJob) => {
        if (claims.get(completedJob.sessionId)?.token !== completedJob.claimToken) {
          return "stale_claim" as const;
        }
        completed.add(completedJob.sessionId);
        claims.delete(completedJob.sessionId);
        return "completed" as const;
      };
      const repository = {
        getConnection: vi.fn(async () => connection),
        saveConnection: vi.fn(async () => undefined),
        markReconnectRequired: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
        reconcileJobs: vi.fn(async () => undefined),
        claimDueJobs,
        loadJobRecord: vi.fn(async (_owner: string, sessionId: string) => {
          const operation = operations.find((value) => value.sessionId === sessionId);
          if (!operation) throw new Error("missing fictional operation");
          return recordFor(operation.action === "delete" ? "cancelled" : "planned", {
            id: sessionId,
            deletedAt:
              operation.action === "delete"
                ? "2026-08-05T09:30:00.000Z"
                : null,
          });
        }),
        eventLink: vi.fn(async (_owner: string, sessionId: string) => ({
          ownerId,
          sessionId,
          calendarId: "calendar-fixture",
          eventId: `linked-${sessionId}`,
          lastAppliedRevision: 3,
          state: "active" as const,
        })),
        completeUpsert: vi.fn(complete),
        completeDelete: vi.fn(complete),
        retry: vi.fn(async () => "scheduled" as const),
        claimCalendarReplacement: vi.fn(async () => ({ state: "busy" as const })),
        stageCalendarReplacement: vi.fn(async () => false),
        completeCalendarReplacement: vi.fn(async () => "stale_claim" as const),
        releaseCalendarReplacement: vi.fn(async () => true),
        status: vi.fn(async () => summary()),
      };
      const waitIfLater = async (
        sessionId: string,
        action: "upsert" | "delete",
      ) => {
        providerCalls.push({ sessionId, action });
        clock += 91_000;
        const sameLaterCalls = providerCalls.filter(
          (call) => call.sessionId === laterSessionId,
        ).length;
        if (sessionId === laterSessionId && sameLaterCalls === 1) {
          await laterGate.promise;
        }
      };
      const gateway = {
        createCalendar: vi.fn(async () => "calendar-replacement"),
        calendarExists: vi.fn(async () => true),
        upsertEvent: vi.fn(async (_token, _calendar, event) => {
          const sessionId = eventSessions.get(event.id);
          if (!sessionId) throw new Error("unknown fictional event");
          await waitIfLater(sessionId, "upsert");
        }),
        deleteEvent: vi.fn(async (_token, _calendar, eventId) => {
          await waitIfLater(eventId.replace(/^linked-/, ""), "delete");
        }),
      };
      const dependencies = {
        repository,
        gateway,
        now: () => new Date(clock),
        eventIdKey,
        decryptRefreshToken: () => "refresh-fixture",
        refreshAccessToken: async () => ({
          accessToken: "access-fixture",
          expiresIn: 3600,
        }),
      } as unknown as CalendarSyncDependencies;

      const first = synchronizeOwnerCalendar(ownerId, dependencies);
      await vi.waitFor(() =>
        expect(
          providerCalls.filter((call) => call.sessionId === laterSessionId),
        ).toHaveLength(1),
      );
      const second = synchronizeOwnerCalendar(ownerId, dependencies);
      await vi.waitFor(() =>
        expect(
          providerCalls.some((call) => call.sessionId === finalSessionId),
        ).toBe(true),
      );

      expect(
        providerCalls.filter((call) => call.sessionId === laterSessionId),
      ).toHaveLength(1);
      expect(
        claimHistory.filter((claim) => claim.sessionId === laterSessionId),
      ).toHaveLength(1);
      expect(claimDueJobs.mock.calls.every((call) => call[3] === 1)).toBe(true);

      laterGate.resolve();
      await Promise.all([first, second]);
    },
  );

  it.each([401, 403])(
    "requires reconnect when replacement create returns authorization status %s",
    async () => {
      const { dependencies, repository, gateway } = dependenciesFor("planned", {
        statusSummary: summary({ state: "reconnect_required" }),
      });
      gateway.upsertEvent.mockRejectedValue(
        new GoogleCalendarError("calendar_missing"),
      );
      gateway.createCalendar.mockRejectedValue(
        new GoogleCalendarError("authorization"),
      );

      const result = await synchronizeOwnerCalendar(ownerId, dependencies);

      expect(repository.markReconnectRequired).toHaveBeenCalledWith(
        ownerId,
        now.toISOString(),
      );
      expect(repository.retry).not.toHaveBeenCalled();
      expect(result.state).toBe("reconnect_required");
    },
  );

  it.each([
    ["rate_limited", "known_failure", 30_000],
    ["transient", "known_failure", 30_000],
    ["permanent", "known_failure", 30_000],
    ["transient", "unknown", 5 * 60_000],
  ] as const)(
    "preserves replacement %s/%s and schedules the claimed job exactly",
    async (category, outcome, delay) => {
      const { dependencies, repository, gateway } = dependenciesFor("planned", {
        statusSummary: summary({ state: "pending", pendingCount: 1 }),
      });
      gateway.upsertEvent.mockRejectedValue(
        new GoogleCalendarError("calendar_missing"),
      );
      gateway.createCalendar.mockRejectedValue(
        new GoogleCalendarError(category, outcome),
      );

      await synchronizeOwnerCalendar(ownerId, dependencies);

      expect(repository.retry).toHaveBeenCalledWith(
        ownerId,
        job,
        category,
        new Date(now.getTime() + delay).toISOString(),
        now.toISOString(),
      );
    },
  );

  it("lets only the durable replacement-claim winner create a calendar", async () => {
    const first = dependenciesFor("planned", { dueJobs: [] });
    const createGate = deferred<string>();
    first.gateway.calendarExists.mockResolvedValue(false);
    first.gateway.createCalendar.mockImplementationOnce(() => createGate.promise);
    first.repository.claimCalendarReplacement = vi
      .fn()
      .mockResolvedValueOnce({ state: "create" })
      .mockResolvedValueOnce({ state: "busy" });
    first.repository.stageCalendarReplacement = vi.fn(async () => true);
    first.repository.completeCalendarReplacement = vi.fn(
      async () => "completed" as const,
    );
    first.repository.releaseCalendarReplacement = vi.fn(async () => true);

    const winner = synchronizeOwnerCalendar(ownerId, first.dependencies);
    await vi.waitFor(() => expect(first.gateway.createCalendar).toHaveBeenCalledOnce());
    await synchronizeOwnerCalendar(ownerId, first.dependencies);
    const callsBeforeWinnerCompleted = first.gateway.createCalendar.mock.calls.length;
    createGate.resolve("calendar-replacement");
    await winner;

    expect(callsBeforeWinnerCompleted).toBe(1);
  });

  it("resumes a durably staged replacement id without another create", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      dueJobs: [],
    });
    gateway.calendarExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    repository.claimCalendarReplacement = vi.fn(async () => ({
      state: "resume" as const,
      calendarId: "calendar-staged",
    }));
    repository.stageCalendarReplacement = vi.fn(async () => true);
    repository.completeCalendarReplacement = vi.fn(
      async () => "completed" as const,
    );
    repository.releaseCalendarReplacement = vi.fn(async () => true);

    await synchronizeOwnerCalendar(ownerId, dependencies);

    expect(gateway.createCalendar).not.toHaveBeenCalled();
    expect(gateway.calendarExists).toHaveBeenLastCalledWith(
      "access-fixture",
      "calendar-staged",
    );
    expect(repository.completeCalendarReplacement).toHaveBeenCalledWith(
      ownerId,
      "calendar-fixture",
      expect.any(String),
      "calendar-staged",
      now.toISOString(),
    );
  });

  it("keeps an inaccessible resumed replacement fail-closed", async () => {
    const { dependencies, repository, gateway } = dependenciesFor("planned", {
      dueJobs: [],
      statusSummary: summary({ state: "pending", pendingCount: 1 }),
    });
    gateway.calendarExists.mockResolvedValue(false);
    repository.claimCalendarReplacement = vi.fn(async () => ({
      state: "resume" as const,
      calendarId: "calendar-other-account",
    }));

    await expect(synchronizeOwnerCalendar(ownerId, dependencies)).resolves.toEqual(
      expect.objectContaining({ state: "pending" }),
    );

    expect(gateway.calendarExists).toHaveBeenLastCalledWith(
      "access-fixture",
      "calendar-other-account",
    );
    expect(gateway.createCalendar).not.toHaveBeenCalled();
    expect(repository.completeCalendarReplacement).not.toHaveBeenCalled();
    expect(repository.releaseCalendarReplacement).not.toHaveBeenCalled();
    expect(repository.reconcileJobs).not.toHaveBeenCalled();
  });

  it("releases a known failed create but keeps an unknown outcome fail-closed", async () => {
    for (const outcome of ["known_failure", "unknown"] as const) {
      const { dependencies, repository, gateway } = dependenciesFor("planned", {
        dueJobs: [],
      });
      gateway.calendarExists.mockResolvedValue(false);
      repository.claimCalendarReplacement = vi.fn(async () => ({
        state: "create" as const,
      }));
      repository.stageCalendarReplacement = vi.fn(async () => true);
      repository.completeCalendarReplacement = vi.fn(
        async () => "completed" as const,
      );
      repository.releaseCalendarReplacement = vi.fn(async () => true);
      gateway.createCalendar.mockRejectedValue(
        new GoogleCalendarError("transient", outcome),
      );

      await expect(
        synchronizeOwnerCalendar(ownerId, dependencies),
      ).resolves.toMatchObject({ state: expect.any(String) });

      expect(repository.releaseCalendarReplacement).toHaveBeenCalledTimes(
        outcome === "known_failure" ? 1 : 0,
      );
    }
  });
});
