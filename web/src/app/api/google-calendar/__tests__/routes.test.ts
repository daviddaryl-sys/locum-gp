import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  claims: {
    data: { claims: { sub: "11111111-1111-4111-8111-111111111111" } },
    error: null,
  } as {
    data: { claims: { sub?: string } } | null;
    error: unknown;
  },
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  calendarFeatureEnabled: vi.fn(() => true),
  readCalendarConfig: vi.fn(() => ({
    clientId: "fictional-client-id",
    clientSecret: "fictional-client-secret",
    redirectUri: "https://example.test/api/google-calendar/callback",
    tokenKey: Buffer.alloc(32, 7),
  })),
  cookieValue: "fictional-sealed-state",
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  createOAuthState: vi.fn(),
  consumeOAuthState: vi.fn(),
  createAuthorizationUrl: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  revokeGoogleToken: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  createGoogleCalendarGateway: vi.fn(),
  createCalendarRepository: vi.fn(),
  synchronizeOwnerCalendar: vi.fn(),
  repository: {
    getConnection: vi.fn(),
    saveConnection: vi.fn(),
    reconcileJobs: vi.fn(),
    disconnect: vi.fn(),
    status: vi.fn(),
    claimCalendarSetup: vi.fn(),
    stageCalendarSetup: vi.fn(),
    completeCalendarSetup: vi.fn(),
    releaseCalendarSetup: vi.fn(),
    claimCalendarReplacement: vi.fn(),
    stageCalendarReplacement: vi.fn(),
    completeCalendarReplacement: vi.fn(),
    releaseCalendarReplacement: vi.fn(),
  },
  gateway: {
    calendarExists: vi.fn(),
    createCalendar: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  })),
}));

vi.mock("@/features/calendar/server/config", () => ({
  CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.app.created",
  calendarFeatureEnabled: mocks.calendarFeatureEnabled,
  readCalendarConfig: mocks.readCalendarConfig,
}));

vi.mock("@/features/calendar/server/oauthState", () => ({
  createOAuthState: mocks.createOAuthState,
  consumeOAuthState: mocks.consumeOAuthState,
}));

vi.mock("@/features/calendar/server/oauth", () => ({
  createAuthorizationUrl: mocks.createAuthorizationUrl,
  exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  refreshGoogleAccessToken: vi.fn(),
  revokeGoogleToken: mocks.revokeGoogleToken,
}));

vi.mock("@/features/calendar/server/secretEnvelope", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: mocks.encryptSecret,
}));

vi.mock("@/features/calendar/server/googleCalendarApi", () => ({
  createGoogleCalendarGateway: mocks.createGoogleCalendarGateway,
}));

vi.mock("@/features/calendar/server/calendarRepository", () => ({
  createCalendarRepository: mocks.createCalendarRepository,
}));

vi.mock("@/features/calendar/server/syncCoordinator", () => ({
  synchronizeOwnerCalendar: mocks.synchronizeOwnerCalendar,
}));

import { POST as POST_CONNECT } from "../connect/route";
import { GET as GET_CALLBACK } from "../callback/route";
import { GET as GET_STATUS } from "../status/route";
import { POST as POST_DISCONNECT } from "../disconnect/route";
import { POST as POST_SYNC } from "../sync/route";

function mockClaims(ownerId: string | null) {
  mocks.claims = ownerId
    ? { data: { claims: { sub: ownerId } }, error: null }
    : { data: { claims: {} }, error: null };
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaims(OWNER_A);
  mocks.createClient.mockResolvedValue({
    auth: { getClaims: vi.fn(async () => mocks.claims) },
  });
  mocks.createAdminClient.mockReturnValue({ kind: "admin" });
  mocks.createCalendarRepository.mockReturnValue(mocks.repository);
  mocks.createGoogleCalendarGateway.mockReturnValue(mocks.gateway);
  mocks.cookieGet.mockImplementation(() => ({ value: mocks.cookieValue }));
  mocks.createOAuthState.mockResolvedValue({
    state: "fictional-state",
    codeChallenge: "fictional-challenge",
    sealedState: "fictional-sealed-state",
  });
  mocks.consumeOAuthState.mockResolvedValue({
    verifier: "fictional-verifier",
    returnTo: "/settings/connected-services",
  });
  mocks.createAuthorizationUrl.mockReturnValue(
    new URL(
      "https://accounts.google.test/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.app.created",
    ),
  );
  mocks.exchangeAuthorizationCode.mockResolvedValue({
    accessToken: "fictional-access-token",
    expiresIn: 3600,
    refreshToken: "fictional-refresh-token",
  });
  mocks.encryptSecret.mockReturnValue({
    version: 1,
    iv: "fictional-iv",
    ciphertext: "fictional-ciphertext",
    tag: "fictional-tag",
  });
  mocks.decryptSecret.mockReturnValue("fictional-refresh-token");
  mocks.repository.getConnection.mockResolvedValue(null);
  mocks.repository.status.mockResolvedValue({
    state: "not_connected",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValue(true);
  mocks.gateway.createCalendar.mockResolvedValue("fictional-calendar-id");
  mocks.repository.claimCalendarSetup.mockResolvedValue({ state: "create" });
  mocks.repository.stageCalendarSetup.mockResolvedValue(true);
  mocks.repository.completeCalendarSetup.mockResolvedValue("completed");
  mocks.repository.releaseCalendarSetup.mockResolvedValue(true);
  mocks.repository.claimCalendarReplacement.mockResolvedValue({ state: "create" });
  mocks.repository.stageCalendarReplacement.mockResolvedValue(true);
  mocks.repository.completeCalendarReplacement.mockResolvedValue("completed");
  mocks.repository.releaseCalendarReplacement.mockResolvedValue(true);
  mocks.synchronizeOwnerCalendar.mockResolvedValue({
    state: "connected",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  mocks.revokeGoogleToken.mockResolvedValue(true);
  mocks.calendarFeatureEnabled.mockReturnValue(true);
});

it.each([
  ["status", () => GET_STATUS(new Request("https://example.test/api/google-calendar/status"))],
  ["connect", () => POST_CONNECT(new Request("https://example.test/api/google-calendar/connect", { method: "POST" }))],
  ["disconnect", () => POST_DISCONNECT(new Request("https://example.test/api/google-calendar/disconnect", { method: "POST" }))],
  ["sync", () => POST_SYNC(new Request("https://example.test/api/google-calendar/sync", { method: "POST" }))],
])("returns private 401 before admin or config for signed-out %s", async (_name, call) => {
  mockClaims(null);
  const response = await call();
  expect(response.status).toBe(401);
  expectPrivate(response);
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.readCalendarConfig).not.toHaveBeenCalled();
});

it("authenticates callback before admin or Calendar secrets", async () => {
  mockClaims(null);
  const response = await GET_CALLBACK(
    new Request("https://example.test/api/google-calendar/callback?state=x&code=y"),
  );
  expect(response.status).toBe(401);
  expectPrivate(response);
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.readCalendarConfig).not.toHaveBeenCalled();
  expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
});

it.each([
  ["status", () => GET_STATUS(new Request("https://example.test/api/google-calendar/status"))],
  ["connect", () => POST_CONNECT(new Request("https://example.test/api/google-calendar/connect", { method: "POST" }))],
  ["callback", () => GET_CALLBACK(new Request("https://example.test/api/google-calendar/callback?state=x&code=y"))],
  ["disconnect", () => POST_DISCONNECT(new Request("https://example.test/api/google-calendar/disconnect", { method: "POST" }))],
  ["sync", () => POST_SYNC(new Request("https://example.test/api/google-calendar/sync", { method: "POST" }))],
])("keeps an authentication-service failure private for %s", async (_name, call) => {
  mocks.createClient.mockRejectedValueOnce(new Error("private auth detail"));
  const response = await call();
  expect(response.status).toBe(401);
  expectPrivate(response);
  expect(await response.text()).not.toContain("private auth detail");
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.readCalendarConfig).not.toHaveBeenCalled();
});

it("connect sets one hardened ten-minute cookie and exact narrow-scope redirect", async () => {
  const response = await POST_CONNECT(
    new Request("https://example.test/api/google-calendar/connect", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(303);
  expectPrivate(response);
  expect(mocks.createOAuthState).toHaveBeenCalledWith(
    OWNER_A,
    "/settings/connected-services",
  );
  expect(mocks.cookieSet).toHaveBeenCalledOnce();
  expect(mocks.cookieSet).toHaveBeenCalledWith(
    "google_calendar_oauth_state",
    "fictional-sealed-state",
    expect.objectContaining({
      httpOnly: true,
      maxAge: 600,
      path: "/api/google-calendar/callback",
      sameSite: "lax",
      secure: true,
    }),
  );
  expect(mocks.createAuthorizationUrl).toHaveBeenCalledWith({
    clientId: "fictional-client-id",
    codeChallenge: "fictional-challenge",
    redirectUri: "https://example.test/api/google-calendar/callback",
    state: "fictional-state",
  });
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe("https://accounts.google.test");
  expect(location.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/calendar.app.created",
  );
  expect(location.search).not.toMatch(/gmail|calendar\.events|calendar\.readonly/i);
});

it("clears the callback cookie before consuming state or exchanging a code", async () => {
  const order: string[] = [];
  mocks.cookieSet.mockImplementation(() => order.push("clear"));
  mocks.consumeOAuthState.mockImplementation(async () => {
    order.push("consume");
    return { verifier: "fictional-verifier", returnTo: "/settings/connected-services" };
  });
  mocks.exchangeAuthorizationCode.mockImplementation(async () => {
    order.push("exchange");
    return {
      accessToken: "fictional-access-token",
      expiresIn: 3600,
      refreshToken: "fictional-refresh-token",
    };
  });

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(order.slice(0, 3)).toEqual(["clear", "consume", "exchange"]);
  expect(mocks.cookieSet).toHaveBeenCalledWith(
    "google_calendar_oauth_state",
    "",
    expect.objectContaining({
      httpOnly: true,
      maxAge: 0,
      path: "/api/google-calendar/callback",
      sameSite: "lax",
      secure: true,
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
  expectPrivate(response);
});

it.each(["read", "clear"])(
  "sanitizes a callback cookie %s failure before state or provider work",
  async (stage) => {
    if (stage === "read") {
      mocks.cookieGet.mockImplementationOnce(() => {
        throw new Error("private cookie read detail");
      });
    } else {
      mocks.cookieSet.mockImplementationOnce(() => {
        throw new Error("private cookie clear detail");
      });
    }

    const response = await GET_CALLBACK(
      new Request(
        "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/settings/connected-services?calendar=error",
    );
    expectPrivate(response);
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled();
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    if (stage === "read") expect(mocks.cookieSet).toHaveBeenCalledOnce();
  },
);

it.each([
  ["missing cookie", "", "fictional-state"],
  ["missing state", "fictional-sealed-state", ""],
  ["wrong or expired state", "fictional-sealed-state", "fictional-state"],
])("rejects %s with a generic relative redirect", async (_name, cookie, state) => {
  mocks.cookieValue = cookie;
  if (cookie && state) {
    mocks.consumeOAuthState.mockRejectedValueOnce(new Error("private state detail"));
  }
  const response = await GET_CALLBACK(
    new Request(
      `https://example.test/api/google-calendar/callback?state=${state}&code=fictional-code`,
    ),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(await response.text()).not.toMatch(/private|state|fictional/i);
  expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
  expectPrivate(response);
  mocks.cookieValue = "fictional-sealed-state";
});

it("validates provider denial state and redirects without exchanging", async () => {
  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&error=access_denied&error_description=private-provider-detail",
    ),
  );
  expect(mocks.consumeOAuthState).toHaveBeenCalledWith(
    "fictional-sealed-state",
    "fictional-state",
    OWNER_A,
  );
  expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=not-connected",
  );
  expect(response.headers.get("location")).not.toContain("private-provider-detail");
});

it.each([null, "disconnected", "reconnect_required"])(
  "requires a fresh refresh token when prior status is %s",
  async (status) => {
    mocks.repository.getConnection.mockResolvedValue(
      status
        ? {
            ownerId: OWNER_A,
            status,
            calendarId: "old-calendar",
            refreshTokenEnvelope: null,
            connectedAt: "2026-08-01T10:00:00.000Z",
            lastSyncAt: null,
          }
        : null,
    );
    mocks.exchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: "fictional-access-token",
      expiresIn: 3600,
    });
    const response = await GET_CALLBACK(
      new Request(
        "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "/settings/connected-services?calendar=error",
    );
    expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  },
);

it("preserves an existing refresh envelope only for an already connected owner", async () => {
  const existingEnvelope = {
    version: 1 as const,
    iv: "existing-iv",
    ciphertext: "existing-ciphertext",
    tag: "existing-tag",
  };
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "existing-calendar",
    refreshTokenEnvelope: existingEnvelope,
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: "2026-08-02T10:00:00.000Z",
  });
  mocks.exchangeAuthorizationCode.mockResolvedValueOnce({
    accessToken: "fictional-access-token",
    expiresIn: 3600,
  });
  mocks.gateway.calendarExists.mockResolvedValueOnce(true);

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.encryptSecret).not.toHaveBeenCalled();
  expect(mocks.repository.saveConnection).toHaveBeenCalledWith(
    OWNER_A,
    expect.objectContaining({
      calendarId: "existing-calendar",
      refreshTokenEnvelope: existingEnvelope,
      lastSyncAt: "2026-08-02T10:00:00.000Z",
    }),
  );
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
});

it("recovers the retained dedicated calendar after a disconnected owner reconnects", async () => {
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "disconnected",
    calendarId: "retained-calendar",
    refreshTokenEnvelope: null,
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValueOnce(true);

  await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.gateway.calendarExists).toHaveBeenCalledWith(
    "fictional-access-token",
    "retained-calendar",
  );
  expect(mocks.gateway.createCalendar).not.toHaveBeenCalled();
  expect(mocks.repository.saveConnection).toHaveBeenCalledWith(
    OWNER_A,
    expect.objectContaining({ calendarId: "retained-calendar" }),
  );
});

it("encrypts a new refresh token, creates the dedicated calendar, and reconciles owner jobs", async () => {
  await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );
  expect(mocks.encryptSecret).toHaveBeenCalledWith(
    "fictional-refresh-token",
    Buffer.alloc(32, 7),
    "refresh-token",
  );
  expect(mocks.gateway.createCalendar).toHaveBeenCalledWith(
    "fictional-access-token",
  );
  expect(mocks.repository.stageCalendarSetup).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
    "fictional-calendar-id",
    expect.any(String),
  );
  expect(mocks.repository.completeCalendarSetup).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
    "fictional-calendar-id",
    expect.objectContaining({ version: 1 }),
    expect.any(String),
  );
  expect(mocks.repository.reconcileJobs).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
    expect.any(String),
  );
});

it("serializes two valid initial callbacks so only one creates and adopts a calendar", async () => {
  let resolveCreate: (value: string) => void = () => undefined;
  const deferredCreate = new Promise<string>((resolve) => {
    resolveCreate = resolve;
  });
  mocks.gateway.createCalendar.mockReturnValueOnce(deferredCreate);
  mocks.repository.claimCalendarSetup
    .mockResolvedValueOnce({ state: "create" })
    .mockResolvedValueOnce({ state: "busy" });

  const first = GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-one&code=code-one",
    ),
  );
  await vi.waitFor(() => expect(mocks.gateway.createCalendar).toHaveBeenCalledOnce());
  const second = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-two&code=code-two",
    ),
  );

  expect(second.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.gateway.createCalendar).toHaveBeenCalledOnce();
  expect(mocks.repository.stageCalendarSetup).not.toHaveBeenCalled();
  expect(mocks.repository.completeCalendarSetup).not.toHaveBeenCalled();
  expect(mocks.repository.reconcileJobs).not.toHaveBeenCalled();

  resolveCreate("durable-calendar");
  const winner = await first;
  expect(winner.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
  expect(mocks.repository.stageCalendarSetup).toHaveBeenCalledOnce();
  expect(mocks.repository.completeCalendarSetup).toHaveBeenCalledOnce();
  expect(mocks.repository.reconcileJobs).toHaveBeenCalledOnce();
  expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
});

it("resumes an expired staged initial setup only after the new access token can see it", async () => {
  mocks.repository.claimCalendarSetup.mockResolvedValue({
    state: "resume",
    calendarId: "staged-calendar",
  });
  mocks.gateway.calendarExists.mockResolvedValue(true);

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.gateway.calendarExists).toHaveBeenCalledWith(
    "fictional-access-token",
    "staged-calendar",
  );
  expect(mocks.gateway.createCalendar).not.toHaveBeenCalled();
  expect(mocks.repository.completeCalendarSetup).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
    "staged-calendar",
    expect.objectContaining({ version: 1 }),
    expect.any(String),
  );
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
});

it("keeps an inaccessible staged initial setup fail-closed for another Google account", async () => {
  mocks.repository.claimCalendarSetup.mockResolvedValue({
    state: "resume",
    calendarId: "other-account-calendar",
  });
  mocks.gateway.calendarExists.mockResolvedValue(false);

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.gateway.createCalendar).not.toHaveBeenCalled();
  expect(mocks.repository.completeCalendarSetup).not.toHaveBeenCalled();
  expect(mocks.repository.releaseCalendarSetup).not.toHaveBeenCalled();
  expect(mocks.repository.reconcileJobs).not.toHaveBeenCalled();
});

it("keeps a loser busy after the winner stages and before it finalizes", async () => {
  let finishCompletion: (value: "completed") => void = () => undefined;
  mocks.repository.completeCalendarSetup.mockReturnValueOnce(
    new Promise((resolve) => {
      finishCompletion = resolve;
    }),
  );
  mocks.repository.claimCalendarSetup
    .mockResolvedValueOnce({ state: "create" })
    .mockResolvedValueOnce({ state: "busy" });

  const winner = GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-one&code=code-one",
    ),
  );
  await vi.waitFor(() =>
    expect(mocks.repository.completeCalendarSetup).toHaveBeenCalledOnce(),
  );
  const loser = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-two&code=code-two",
    ),
  );

  expect(loser.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.gateway.createCalendar).toHaveBeenCalledOnce();
  finishCompletion("completed");
  await expect(winner).resolves.toHaveProperty(
    "headers",
    expect.objectContaining({}),
  );
});

it("serializes missing-calendar replacement and preserves the retained token on an unknown create failure", async () => {
  const retainedEnvelope = {
    version: 1 as const,
    iv: "retained-iv",
    ciphertext: "retained-ciphertext",
    tag: "retained-tag",
  };
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "missing-calendar",
    refreshTokenEnvelope: retainedEnvelope,
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValue(false);
  mocks.repository.claimCalendarReplacement
    .mockResolvedValueOnce({ state: "create" })
    .mockResolvedValueOnce({ state: "busy" });
  let rejectCreate: (reason?: unknown) => void = () => undefined;
  mocks.gateway.createCalendar.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectCreate = reject;
    }),
  );

  const first = GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-one&code=code-one",
    ),
  );
  await vi.waitFor(() => expect(mocks.gateway.createCalendar).toHaveBeenCalledOnce());
  const loser = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=state-two&code=code-two",
    ),
  );
  expect(loser.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.gateway.createCalendar).toHaveBeenCalledOnce();
  expect(mocks.repository.saveConnection).not.toHaveBeenCalled();

  rejectCreate(new Error("unknown provider outcome"));
  const failedWinner = await first;
  expect(failedWinner.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.repository.releaseCalendarReplacement).not.toHaveBeenCalled();
  expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  expect(mocks.repository.reconcileJobs).not.toHaveBeenCalled();
});

it("calendar-binds the sole winning replacement before adopting its new token", async () => {
  const retainedEnvelope = {
    version: 1 as const,
    iv: "retained-iv",
    ciphertext: "retained-ciphertext",
    tag: "retained-tag",
  };
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "missing-calendar",
    refreshTokenEnvelope: retainedEnvelope,
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValue(false);
  mocks.repository.claimCalendarReplacement.mockResolvedValue({ state: "create" });

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.repository.stageCalendarReplacement).toHaveBeenCalledWith(
    OWNER_A,
    "missing-calendar",
    expect.any(String),
    "fictional-calendar-id",
    expect.any(String),
  );
  expect(mocks.repository.completeCalendarReplacement).toHaveBeenCalledWith(
    OWNER_A,
    "missing-calendar",
    expect.any(String),
    "fictional-calendar-id",
    expect.any(String),
  );
  expect(mocks.repository.saveConnection.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.repository.completeCalendarReplacement.mock.invocationCallOrder[0],
  );
  expect(mocks.repository.saveConnection).toHaveBeenCalledWith(
    OWNER_A,
    expect.objectContaining({ calendarId: "fictional-calendar-id" }),
  );
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
});

it("resumes an expired staged replacement only when the new access token can see it", async () => {
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "missing-calendar",
    refreshTokenEnvelope: {
      version: 1,
      iv: "retained-iv",
      ciphertext: "retained-ciphertext",
      tag: "retained-tag",
    },
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  mocks.repository.claimCalendarReplacement.mockResolvedValue({
    state: "resume",
    calendarId: "staged-replacement",
  });

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.gateway.calendarExists).toHaveBeenLastCalledWith(
    "fictional-access-token",
    "staged-replacement",
  );
  expect(mocks.gateway.createCalendar).not.toHaveBeenCalled();
  expect(mocks.repository.completeCalendarReplacement).toHaveBeenCalledWith(
    OWNER_A,
    "missing-calendar",
    expect.any(String),
    "staged-replacement",
    expect.any(String),
  );
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
});

it("keeps an inaccessible staged replacement fail-closed for another Google account", async () => {
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "missing-calendar",
    refreshTokenEnvelope: {
      version: 1,
      iv: "retained-iv",
      ciphertext: "retained-ciphertext",
      tag: "retained-tag",
    },
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValue(false);
  mocks.repository.claimCalendarReplacement.mockResolvedValue({
    state: "resume",
    calendarId: "other-account-calendar",
  });

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.gateway.createCalendar).not.toHaveBeenCalled();
  expect(mocks.repository.completeCalendarReplacement).not.toHaveBeenCalled();
  expect(mocks.repository.releaseCalendarReplacement).not.toHaveBeenCalled();
  expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  expect(mocks.repository.reconcileJobs).not.toHaveBeenCalled();
});

it("adopts a reconnect-required missing calendar only after replacement completion", async () => {
  mocks.repository.getConnection.mockResolvedValue({
    ownerId: OWNER_A,
    status: "reconnect_required",
    calendarId: "missing-calendar",
    refreshTokenEnvelope: {
      version: 1,
      iv: "unusable-iv",
      ciphertext: "unusable-ciphertext",
      tag: "unusable-tag",
    },
    connectedAt: "2026-08-01T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.gateway.calendarExists.mockResolvedValue(false);

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.repository.saveConnection).toHaveBeenCalledOnce();
  expect(mocks.repository.saveConnection.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.repository.completeCalendarReplacement.mock.invocationCallOrder[0],
  );
  expect(mocks.repository.saveConnection).toHaveBeenCalledWith(
    OWNER_A,
    expect.objectContaining({
      calendarId: "fictional-calendar-id",
      refreshTokenEnvelope: expect.objectContaining({ version: 1 }),
    }),
  );
  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=connected",
  );
});

it("keeps an unknown initial create outcome fail-closed", async () => {
  mocks.gateway.createCalendar.mockRejectedValueOnce(
    new Error("unknown provider outcome"),
  );

  const response = await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(response.headers.get("location")).toBe(
    "/settings/connected-services?calendar=error",
  );
  expect(mocks.repository.releaseCalendarSetup).not.toHaveBeenCalled();
  expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
  expect(mocks.repository.reconcileJobs).not.toHaveBeenCalled();
});

it("releases only a known failed initial create claim", async () => {
  mocks.gateway.createCalendar.mockRejectedValueOnce({
    outcome: "known_failure",
  });

  await GET_CALLBACK(
    new Request(
      "https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code",
    ),
  );

  expect(mocks.repository.releaseCalendarSetup).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
  );
});

it("status exposes only the sanitized owner summary", async () => {
  const summary = {
    state: "connected",
    pendingCount: 2,
    lastSyncAt: "2026-08-05T10:00:00.000Z",
    nextRetryAt: null,
  };
  mocks.repository.status.mockResolvedValueOnce(summary);
  const response = await GET_STATUS(
    new Request("https://example.test/api/google-calendar/status"),
  );
  const body = await response.text();
  expect(JSON.parse(body)).toEqual(summary);
  expect(body).not.toMatch(/token|calendarId|ownerId|eventId/i);
  expectPrivate(response);
});

it("disconnect best-effort revokes, clears persistence, retains mappings, and returns private 204", async () => {
  const envelope = {
    version: 1 as const,
    iv: "fictional-iv",
    ciphertext: "fictional-ciphertext",
    tag: "fictional-tag",
  };
  mocks.repository.getConnection.mockResolvedValueOnce({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "fictional-calendar-id",
    refreshTokenEnvelope: envelope,
    connectedAt: "2026-08-05T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.revokeGoogleToken.mockResolvedValueOnce(false);
  const response = await POST_DISCONNECT(
    new Request("https://example.test/api/google-calendar/disconnect", {
      method: "POST",
    }),
  );
  expect(mocks.decryptSecret).toHaveBeenCalledWith(
    envelope,
    Buffer.alloc(32, 7),
    "refresh-token",
  );
  expect(mocks.revokeGoogleToken).toHaveBeenCalledWith({
    token: "fictional-refresh-token",
  });
  expect(mocks.repository.disconnect).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
  );
  expect(response.status).toBe(204);
  expectPrivate(response);
});

it("disconnect still clears persistence when revocation configuration is unavailable", async () => {
  mocks.repository.getConnection.mockResolvedValueOnce({
    ownerId: OWNER_A,
    status: "connected",
    calendarId: "fictional-calendar-id",
    refreshTokenEnvelope: {
      version: 1,
      iv: "fictional-iv",
      ciphertext: "fictional-ciphertext",
      tag: "fictional-tag",
    },
    connectedAt: "2026-08-05T10:00:00.000Z",
    lastSyncAt: null,
  });
  mocks.readCalendarConfig.mockImplementationOnce(() => {
    throw new Error("private configuration detail");
  });

  const response = await POST_DISCONNECT(
    new Request("https://example.test/api/google-calendar/disconnect", {
      method: "POST",
    }),
  );

  expect(mocks.repository.disconnect).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
  );
  expect(response.status).toBe(204);
  expectPrivate(response);
});

it("disconnect clears a reconnect-required retained token without OAuth consent", async () => {
  mocks.repository.getConnection.mockResolvedValueOnce({
    ownerId: OWNER_A,
    status: "reconnect_required",
    calendarId: "retained-calendar",
    refreshTokenEnvelope: {
      version: 1,
      iv: "retained-iv",
      ciphertext: "retained-ciphertext",
      tag: "retained-tag",
    },
    connectedAt: "2026-08-05T10:00:00.000Z",
    lastSyncAt: null,
  });

  const response = await POST_DISCONNECT(
    new Request("https://example.test/api/google-calendar/disconnect", {
      method: "POST",
    }),
  );

  expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
  expect(mocks.repository.disconnect).toHaveBeenCalledWith(
    OWNER_A,
    expect.any(String),
  );
  expect(response.status).toBe(204);
});

it("sync sanitizes every provider or coordinator failure", async () => {
  mocks.synchronizeOwnerCalendar.mockRejectedValueOnce(
    new Error("private-provider-token-body"),
  );
  mocks.repository.status.mockRejectedValueOnce(new Error("private-row"));
  const response = await POST_SYNC(
    new Request("https://example.test/api/google-calendar/sync", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    state: "pending",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  expectPrivate(response);
});

it("sync canonicalizes database timestamp offsets for the strict client boundary", async () => {
  mocks.synchronizeOwnerCalendar.mockResolvedValueOnce({
    state: "pending",
    pendingCount: 1,
    lastSyncAt: "2026-08-05T10:00:00+00:00",
    nextRetryAt: "2026-08-05T10:00:30+00:00",
  });
  const response = await POST_SYNC(
    new Request("https://example.test/api/google-calendar/sync", {
      method: "POST",
    }),
  );
  expect(await response.json()).toEqual({
    state: "pending",
    pendingCount: 1,
    lastSyncAt: "2026-08-05T10:00:00.000Z",
    nextRetryAt: "2026-08-05T10:00:30.000Z",
  });
  expectPrivate(response);
});

describe("owner isolation", () => {
  it("ignores foreign owner and session UUIDs in all request input", async () => {
    const foreign = JSON.stringify({ ownerId: OWNER_B, sessionId: OWNER_B });
    await POST_CONNECT(
      new Request("https://example.test/api/google-calendar/connect", {
        method: "POST",
        body: foreign,
      }),
    );
    await GET_STATUS(
      new Request(
        `https://example.test/api/google-calendar/status?ownerId=${OWNER_B}`,
      ),
    );
    await GET_CALLBACK(
      new Request(
        `https://example.test/api/google-calendar/callback?state=fictional-state&code=fictional-code&ownerId=${OWNER_B}&sessionId=${OWNER_B}`,
      ),
    );
    await POST_DISCONNECT(
      new Request("https://example.test/api/google-calendar/disconnect", {
        method: "POST",
        body: foreign,
      }),
    );
    await POST_SYNC(
      new Request("https://example.test/api/google-calendar/sync", {
        method: "POST",
        body: foreign,
      }),
    );

    expect(mocks.createOAuthState).toHaveBeenCalledWith(
      OWNER_A,
      "/settings/connected-services",
    );
    expect(mocks.repository.status).toHaveBeenCalledWith(OWNER_A);
    expect(mocks.consumeOAuthState).toHaveBeenCalledWith(
      "fictional-sealed-state",
      "fictional-state",
      OWNER_A,
    );
    expect(mocks.repository.reconcileJobs).toHaveBeenCalledWith(
      OWNER_A,
      expect.any(String),
      expect.any(String),
    );
    expect(mocks.repository.disconnect).toHaveBeenCalledWith(
      OWNER_A,
      expect.any(String),
    );
    expect(mocks.synchronizeOwnerCalendar).toHaveBeenCalledWith(
      OWNER_A,
      expect.any(Object),
    );
    expect(JSON.stringify(mocks.repository.status.mock.calls)).not.toContain(
      OWNER_B,
    );
    expect(JSON.stringify(mocks.repository.reconcileJobs.mock.calls)).not.toContain(
      OWNER_B,
    );
    expect(JSON.stringify(mocks.repository.disconnect.mock.calls)).not.toContain(
      OWNER_B,
    );
    expect(JSON.stringify(mocks.synchronizeOwnerCalendar.mock.calls)).not.toContain(
      OWNER_B,
    );
  });
});
