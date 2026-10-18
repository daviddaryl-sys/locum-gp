import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calendarFeatureEnabled: vi.fn(() => true),
  createAdminClient: vi.fn(() => ({ admin: true })),
  createCalendarRepository: vi.fn(),
  createClient: vi.fn(),
  parseSyncBatchRequest: vi.fn(),
  processSyncBatch: vi.fn(),
  reconcileJobs: vi.fn(),
}));

vi.mock("@/features/calendar/server/config", () => ({
  calendarFeatureEnabled: mocks.calendarFeatureEnabled,
}));
vi.mock("@/features/calendar/server/calendarRepository", () => ({
  createCalendarRepository: mocks.createCalendarRepository,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/sync/protocol", () => ({
  parseSyncBatchRequest: mocks.parseSyncBatchRequest,
  processSyncBatch: mocks.processSyncBatch,
}));

import { POST } from "../route";

const OWNER = "00000000-0000-4000-8000-000000000001";
const SESSION_MUTATION = {
  idempotencyKey: "00000000-0000-4000-8000-000000000011",
  recordType: "sessions",
  recordId: "00000000-0000-4000-8000-000000000012",
  operation: "upsert",
  payload: { isDemo: false },
  baseRevision: 0,
  localRevision: 1,
  updatedAt: "2026-08-05T10:00:00.000Z",
} as const;
const NORMAL_RESPONSE = {
  applied: [{
    mutationId: SESSION_MUTATION.idempotencyKey,
    recordType: "sessions",
    recordId: SESSION_MUTATION.recordId,
    data: { isDemo: false },
    serverRevision: 1,
    updatedAt: "2026-08-05T10:00:00.000Z",
  }],
  conflicts: [],
  pulled: [],
  nextCursor: null,
};

function request() {
  return new Request("https://example.test/api/sync", {
    method: "POST",
    body: JSON.stringify({ mutations: [], cursor: null }),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calendarFeatureEnabled.mockReturnValue(true);
  mocks.createClient.mockResolvedValue({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: OWNER } }, error: null })) },
  });
  mocks.parseSyncBatchRequest.mockReturnValue({
    mutations: [SESSION_MUTATION],
    cursor: null,
  });
  mocks.processSyncBatch.mockResolvedValue(NORMAL_RESPONSE);
  mocks.reconcileJobs.mockResolvedValue(undefined);
  mocks.createCalendarRepository.mockReturnValue({ reconcileJobs: mocks.reconcileJobs });
});

describe("best-effort Calendar reconciliation after canonical sync", () => {
  it("returns the unchanged applied response when Calendar reconciliation throws", async () => {
    mocks.reconcileJobs.mockRejectedValueOnce(new Error("private Calendar failure"));
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(NORMAL_RESPONSE);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.reconcileJobs).toHaveBeenCalledOnce();
    expect(mocks.reconcileJobs).toHaveBeenCalledWith(
      OWNER,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it.each([
    ["demo session", { ...SESSION_MUTATION, payload: { isDemo: true } }],
    ["non-session", { ...SESSION_MUTATION, recordType: "practices", payload: { isDemo: false } }],
  ])("does not reconcile an applied %s mutation", async (_label, mutation) => {
    mocks.parseSyncBatchRequest.mockReturnValue({ mutations: [mutation], cursor: null });
    mocks.processSyncBatch.mockResolvedValue({
      ...NORMAL_RESPONSE,
      applied: [{ ...NORMAL_RESPONSE.applied[0], mutationId: mutation.idempotencyKey, recordType: mutation.recordType }],
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.reconcileJobs).not.toHaveBeenCalled();
  });

  it("does not reconcile a conflicted original session mutation", async () => {
    mocks.processSyncBatch.mockResolvedValue({
      applied: [],
      conflicts: [{ mutationId: SESSION_MUTATION.idempotencyKey }],
      pulled: [],
      nextCursor: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not create an admin client while Calendar is disabled", async () => {
    mocks.calendarFeatureEnabled.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(NORMAL_RESPONSE);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createCalendarRepository).not.toHaveBeenCalled();
  });
});
