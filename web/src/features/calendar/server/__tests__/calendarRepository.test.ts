// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("an injected client is required in tests");
  }),
}));

import { createCalendarRepository } from "../calendarRepository";

const ownerId = "00000000-0000-4000-8000-000000000001";
const otherOwnerId = "00000000-0000-4000-8000-000000000002";
const claimToken = "10000000-0000-4000-8000-000000000001";
const at = "2026-08-05T10:00:00.000Z";

describe("owner-scoped Calendar repository", () => {
  it("loads a connection with an explicit owner filter and narrow projection", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        owner_id: ownerId,
        status: "connected",
        calendar_id: "calendar-fixture",
        refresh_token_envelope: {
          version: 1,
          iv: "aXYtZml4dHVyZQ==",
          ciphertext: "Y2lwaGVydGV4dA==",
          tag: "dGFnLWZpeHR1cmU=",
        },
        connected_at: at,
        last_sync_at: null,
      },
      error: null,
    }));
    const ownerEq = vi.fn<
      (field: string, value: string) => { maybeSingle: typeof maybeSingle }
    >();
    ownerEq.mockReturnValue({ maybeSingle });
    const select = vi.fn<(fields: string) => { eq: typeof ownerEq }>();
    select.mockReturnValue({ eq: ownerEq });
    const client = { from: vi.fn(() => ({ select })) };

    await expect(
      createCalendarRepository(client as never).getConnection(ownerId),
    ).resolves.toMatchObject({
      ownerId,
      calendarId: "calendar-fixture",
      status: "connected",
      connectedAt: at,
      lastSyncAt: null,
    });

    expect(client.from).toHaveBeenCalledWith("google_calendar_connections");
    expect(ownerEq).toHaveBeenCalledWith("owner_id", ownerId);
    const selected = String(select.mock.calls[0][0]);
    expect(selected).toContain("refresh_token_envelope");
    expect(selected).not.toMatch(/rate|notes|invoice|receipt|tax|payment/i);
  });

  it("queues only real upcoming sessions and newer retained linked edits", async () => {
    const selected: Array<[string, string]> = [];
    const upsert = vi.fn<
      (rows: unknown, options?: unknown) => Promise<{ error: null }>
    >();
    upsert.mockResolvedValue({ error: null });
    const conditionalLt = vi.fn(async () => ({ error: null }));
    const conditionalEq = vi.fn();
    const conditionalChain = { eq: conditionalEq, lt: conditionalLt };
    conditionalEq.mockReturnValue(conditionalChain);
    const update = vi.fn(() => conditionalChain);
    const rows = {
      session_records: [
        {
          id: "future-real",
          practice_id: "practice-a",
          starts_at: "2026-08-11T09:00:00.000Z",
          ends_at: "2026-08-11T15:00:00.000Z",
          status: "planned",
          revision: 2,
          deleted_at: null,
          is_demo: false,
        },
        {
          id: "past-unlinked",
          practice_id: "practice-a",
          starts_at: "2026-08-01T09:00:00.000Z",
          ends_at: "2026-08-01T15:00:00.000Z",
          status: "completed",
          revision: 3,
          deleted_at: null,
          is_demo: false,
        },
        {
          id: "past-linked",
          practice_id: "practice-a",
          starts_at: "2026-08-01T09:00:00.000Z",
          ends_at: "2026-08-01T15:00:00.000Z",
          status: "completed",
          revision: 5,
          deleted_at: null,
          is_demo: false,
        },
        {
          id: "deleted-linked",
          practice_id: "practice-a",
          starts_at: "2026-08-01T09:00:00.000Z",
          ends_at: "2026-08-01T15:00:00.000Z",
          status: "cancelled",
          revision: 6,
          deleted_at: "2026-08-05T09:00:00.000Z",
          is_demo: false,
        },
        {
          id: "future-demo",
          practice_id: "practice-a",
          starts_at: "2026-08-12T09:00:00.000Z",
          ends_at: "2026-08-12T15:00:00.000Z",
          status: "planned",
          revision: 2,
          deleted_at: null,
          is_demo: true,
        },
      ],
      google_calendar_event_links: [
        {
          owner_id: ownerId,
          session_id: "past-linked",
          calendar_id: "calendar-fixture",
          event_id: "event-past",
          last_applied_revision: 4,
          state: "active",
        },
        {
          owner_id: ownerId,
          session_id: "deleted-linked",
          calendar_id: "calendar-fixture",
          event_id: "event-delete",
          last_applied_revision: 5,
          state: "active",
        },
      ],
      google_calendar_sync_jobs: [],
    };
    const client = {
      from: vi.fn((table: keyof typeof rows) => ({
        select: (fields: string) => {
          selected.push([table, fields]);
          return {
            eq: vi.fn(async (field: string, value: string) => {
              expect([field, value]).toEqual(["owner_id", ownerId]);
              return { data: rows[table], error: null };
            }),
          };
        },
        upsert,
        update,
      })),
    };

    await createCalendarRepository(client as never).reconcileJobs(
      ownerId,
      at,
      at,
    );

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toEqual([
      {
        owner_id: ownerId,
        session_id: "future-real",
        desired_action: "upsert",
        target_revision: 2,
        attempts: 0,
        next_attempt_at: at,
        last_failure_category: null,
        updated_at: at,
      },
      {
        owner_id: ownerId,
        session_id: "past-linked",
        desired_action: "upsert",
        target_revision: 5,
        attempts: 0,
        next_attempt_at: at,
        last_failure_category: null,
        updated_at: at,
      },
      {
        owner_id: ownerId,
        session_id: "deleted-linked",
        desired_action: "delete",
        target_revision: 6,
        attempts: 0,
        next_attempt_at: at,
        last_failure_category: null,
        updated_at: at,
      },
    ]);
    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: "owner_id,session_id",
      ignoreDuplicates: true,
    });
    expect(update).toHaveBeenCalledTimes(3);
    expect(selected.map(([table]) => table)).toEqual([
      "session_records",
      "google_calendar_event_links",
      "google_calendar_sync_jobs",
    ]);
    expect(selected.map(([, fields]) => fields).join(",")).not.toMatch(
      /hourly|rate|notes|invoice|receipt|tax|payment/i,
    );
  });

  it("does not replace a newer queued revision with stale canonical work", async () => {
    const upsert = vi.fn<
      (rows: unknown, options?: unknown) => Promise<{ error: null }>
    >();
    upsert.mockResolvedValue({ error: null });
    const rows = {
      session_records: [
        {
          id: "session-fixture",
          practice_id: "practice-fixture",
          starts_at: "2026-08-11T09:00:00.000Z",
          ends_at: "2026-08-11T15:00:00.000Z",
          status: "planned",
          revision: 8,
          deleted_at: null,
          is_demo: false,
        },
      ],
      google_calendar_event_links: [],
      google_calendar_sync_jobs: [
        {
          owner_id: ownerId,
          session_id: "session-fixture",
          desired_action: "upsert",
          target_revision: 9,
          attempts: 0,
          next_attempt_at: at,
        },
      ],
    };
    const client = {
      from: vi.fn((table: keyof typeof rows) => ({
        select: () => ({
          eq: vi.fn(async () => ({ data: rows[table], error: null })),
        }),
        upsert,
      })),
    };

    await createCalendarRepository(client as never).reconcileJobs(
      ownerId,
      at,
      at,
    );

    expect(upsert).not.toHaveBeenCalled();
  });

  it("conditionally advances an older job without a stale-writer race", async () => {
    const update = vi.fn(() => {
      const filters: Array<[string, string | number]> = [];
      const chain = {
        eq: vi.fn((field: string, value: string) => {
          filters.push([field, value]);
          return chain;
        }),
        lt: vi.fn(async (field: string, value: number) => {
          filters.push([field, value]);
          expect(filters).toEqual([
            ["owner_id", ownerId],
            ["session_id", "session-fixture"],
            ["target_revision", 8],
          ]);
          return { error: null };
        }),
      };
      return chain;
    });
    const upsert = vi.fn<
      (rows: unknown, options?: unknown) => Promise<{ error: null }>
    >();
    upsert.mockResolvedValue({ error: null });
    const rows = {
      session_records: [
        {
          id: "session-fixture",
          practice_id: "practice-fixture",
          starts_at: "2026-08-11T09:00:00.000Z",
          ends_at: "2026-08-11T15:00:00.000Z",
          status: "planned",
          revision: 8,
          deleted_at: null,
          is_demo: false,
        },
      ],
      google_calendar_event_links: [],
      google_calendar_sync_jobs: [
        {
          owner_id: ownerId,
          session_id: "session-fixture",
          desired_action: "upsert",
          target_revision: 7,
          attempts: 2,
          next_attempt_at: at,
        },
      ],
    };
    const client = {
      from: vi.fn((table: keyof typeof rows) => ({
        select: () => ({
          eq: vi.fn(async () => ({ data: rows[table], error: null })),
        }),
        update,
        upsert,
      })),
    };

    await createCalendarRepository(client as never).reconcileJobs(
      ownerId,
      at,
      at,
    );

    expect(update).toHaveBeenCalledWith({
      desired_action: "upsert",
      target_revision: 8,
      attempts: 0,
      next_attempt_at: at,
      last_failure_category: null,
      updated_at: at,
    });
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: "owner_id,session_id",
      ignoreDuplicates: true,
    });
  });

  it("loads canonical session and practice fields through owner-scoped queries", async () => {
    const selections: string[] = [];
    const filters: Array<[string, string]> = [];
    const dataByTable = {
      session_records: {
        id: "session-fixture",
        practice_id: "practice-fixture",
        starts_at: "2026-08-11T09:00:00.000Z",
        ends_at: "2026-08-11T15:00:00.000Z",
        status: "planned",
        revision: 4,
        deleted_at: null,
        is_demo: false,
      },
      practice_records: {
        name: "Fictional Medical Centre",
        billing_address: { formatted: "12 Sample Road, London" },
      },
    };
    const client = {
      from: vi.fn((table: keyof typeof dataByTable) => ({
        select: (fields: string) => {
          selections.push(fields);
          let filterCount = 0;
          const chain = {
            eq: vi.fn((field: string, value: string) => {
              filters.push([field, value]);
              filterCount += 1;
              return filterCount === 2
                ? {
                    single: vi.fn(async () => ({ data: dataByTable[table], error: null })),
                    maybeSingle: vi.fn(async () => ({ data: dataByTable[table], error: null })),
                  }
                : chain;
            }),
          };
          return chain;
        },
      })),
    };

    await expect(
      createCalendarRepository(client as never).loadJobRecord(
        ownerId,
        "session-fixture",
      ),
    ).resolves.toEqual({
      session: {
        id: "session-fixture",
        practiceId: "practice-fixture",
        startsAt: "2026-08-11T09:00:00.000Z",
        endsAt: "2026-08-11T15:00:00.000Z",
        status: "planned",
        revision: 4,
        deletedAt: null,
        isDemo: false,
      },
      practice: {
        name: "Fictional Medical Centre",
        billingAddress: { formatted: "12 Sample Road, London" },
      },
    });
    expect(filters).toEqual([
      ["owner_id", ownerId],
      ["id", "session-fixture"],
      ["owner_id", ownerId],
      ["id", "practice-fixture"],
    ]);
    expect(selections.join(",")).not.toMatch(
      /hourly|rate|notes|invoice|receipt|tax|payment/i,
    );
  });

  it("passes owner and target revision to transactional completion functions", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "complete_google_calendar_upsert"
          ? "completed"
          : "superseded",
      error: null,
    }));
    const repository = createCalendarRepository({ rpc } as never);
    const upsertJob = {
      ownerId,
      sessionId: "session-fixture",
      desiredAction: "upsert" as const,
      targetRevision: 7,
      attempts: 0,
      nextAttemptAt: at,
      claimToken: "10000000-0000-4000-8000-000000000001",
      leaseExpiresAt: "2026-08-05T10:05:00.000Z",
    };

    await repository.completeUpsert(
      ownerId,
      upsertJob,
      "calendar-fixture",
      "event-fixture",
      "active",
      at,
    );
    await repository.completeDelete(
      otherOwnerId,
      { ...upsertJob, ownerId: otherOwnerId, desiredAction: "delete" },
      "calendar-fixture",
      at,
    );

    expect(rpc).toHaveBeenNthCalledWith(1, "complete_google_calendar_upsert", {
      requested_owner: ownerId,
      requested_session: "session-fixture",
      requested_claim: "10000000-0000-4000-8000-000000000001",
      requested_calendar: "calendar-fixture",
      requested_event: "event-fixture",
      requested_revision: 7,
      requested_state: "active",
      completed_at: at,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_google_calendar_delete", {
      requested_owner: otherOwnerId,
      requested_session: "session-fixture",
      requested_claim: "10000000-0000-4000-8000-000000000001",
      requested_calendar: "calendar-fixture",
      requested_revision: 7,
      completed_at: at,
    });
  });

  it("atomically claims no more than 25 due jobs with a bounded lease", async () => {
    const rpc = vi.fn(async () => ({
      data: Array.from({ length: 25 }, (_, index) => ({
        owner_id: ownerId,
        session_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        desired_action: "upsert",
        target_revision: index + 1,
        attempts: 0,
        next_attempt_at: at,
        claim_token: claimToken,
        lease_expires_at: "2026-08-05T10:05:00.000Z",
      })),
      error: null,
    }));
    const repository = createCalendarRepository({ rpc } as never);

    const jobs = await repository.claimDueJobs(
      ownerId,
      at,
      "2026-08-05T10:05:00.000Z",
      99,
    );

    expect(jobs).toHaveLength(25);
    expect(rpc).toHaveBeenCalledWith("claim_google_calendar_sync_jobs", {
      requested_owner: ownerId,
      claimed_at: at,
      lease_until: "2026-08-05T10:05:00.000Z",
      requested_limit: 25,
    });
    expect(jobs[0]).toMatchObject({ claimToken, targetRevision: 1 });
  });

  it("returns an observable superseded completion bound to the actual calendar", async () => {
    const rpc = vi.fn(async () => ({ data: "superseded", error: null }));
    const repository = createCalendarRepository({ rpc } as never);
    const claimedJob = {
      ownerId,
      sessionId: "session-fixture",
      desiredAction: "upsert" as const,
      targetRevision: 4,
      attempts: 0,
      nextAttemptAt: at,
      claimToken,
      leaseExpiresAt: "2026-08-05T10:05:00.000Z",
    };

    await expect(
      repository.completeUpsert(
        ownerId,
        claimedJob,
        "calendar-actually-used",
        "event-fixture",
        "active",
        at,
      ),
    ).resolves.toBe("superseded");
    expect(rpc).toHaveBeenCalledWith("complete_google_calendar_upsert", {
      requested_owner: ownerId,
      requested_session: "session-fixture",
      requested_claim: claimToken,
      requested_calendar: "calendar-actually-used",
      requested_event: "event-fixture",
      requested_revision: 4,
      requested_state: "active",
      completed_at: at,
    });
  });

  it("uses only durable RPC transitions for replacement ordering", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ disposition: "create", calendar_id: null }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "completed", error: null });
    const from = vi.fn(() => {
      throw new Error("replacement must not perform direct table deletes");
    });
    const repository = createCalendarRepository({ rpc, from } as never);

    await expect(
      repository.claimCalendarReplacement(
        ownerId,
        "calendar-old",
        claimToken,
        at,
      ),
    ).resolves.toEqual({ state: "create" });
    await expect(
      repository.stageCalendarReplacement(
        ownerId,
        "calendar-old",
        claimToken,
        "calendar-new",
        at,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.completeCalendarReplacement(
        ownerId,
        "calendar-old",
        claimToken,
        "calendar-new",
        at,
      ),
    ).resolves.toBe("completed");

    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_google_calendar_replacement",
      "stage_google_calendar_replacement",
      "complete_google_calendar_replacement",
    ]);
  });

  it("releases a known failed replacement only through its owner claim", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));

    await createCalendarRepository({ rpc } as never).releaseCalendarReplacement(
      ownerId,
      "calendar-old",
      claimToken,
      at,
    );

    expect(rpc).toHaveBeenCalledWith("release_google_calendar_replacement", {
      requested_owner: ownerId,
      requested_calendar: "calendar-old",
      requested_claim: claimToken,
      released_at: at,
    });
  });

  it("uses only observable owner-scoped RPC transitions for initial setup", async () => {
    const envelope = {
      version: 1 as const,
      iv: "fictional-iv",
      ciphertext: "fictional-ciphertext",
      tag: "fictional-tag",
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ disposition: "create", calendar_id: null }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "completed", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createCalendarRepository({ rpc } as never);

    await expect(
      repository.claimCalendarSetup(ownerId, claimToken, at),
    ).resolves.toEqual({ state: "create" });
    await expect(
      repository.stageCalendarSetup(
        ownerId,
        claimToken,
        "calendar-initial",
        at,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.completeCalendarSetup(
        ownerId,
        claimToken,
        "calendar-initial",
        envelope,
        at,
      ),
    ).resolves.toBe("completed");
    await expect(
      repository.releaseCalendarSetup(ownerId, claimToken),
    ).resolves.toBe(true);

    expect(rpc.mock.calls).toEqual([
      ["claim_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        claimed_at: at,
      }],
      ["stage_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        requested_calendar: "calendar-initial",
        staged_at: at,
      }],
      ["complete_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        requested_calendar: "calendar-initial",
        requested_envelope: envelope,
        completed_at: at,
      }],
      ["release_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
      }],
    ]);
  });
});
