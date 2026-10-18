// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  GoogleOAuthError,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "../oauth";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const client = {
  clientId: "fictional-client-id",
  clientSecret: "fictional-client-secret",
  redirectUri: "https://locum-manager.example/api/google-calendar/callback",
};

function providerResponse(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => value),
  } as unknown as Response;
}

function refreshWith(value: unknown, status = 200) {
  const fetchImpl = vi.fn<FetchImplementation>(async () =>
    providerResponse(value, status),
  );
  return refreshGoogleAccessToken({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken: "fictional-refresh-token",
    fetchImpl,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google OAuth", () => {
  it("requests only the app-created Calendar scope with offline PKCE consent", () => {
    const authorization = createAuthorizationUrl({
      clientId: "fictional-client-id",
      codeChallenge: "fictional-challenge",
      redirectUri:
        "https://locum-manager.example/api/google-calendar/callback",
      state: "fictional-state",
    });

    expect(authorization.origin + authorization.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorization.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.searchParams.get("prompt")).toBe("consent");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.toString()).not.toMatch(
      /gmail|calendar\.events|calendar\.readonly/,
    );
  });

  it("exchanges an authorization code using the verifier and strict form fields", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      Response.json({
        access_token: "fictional-access-token",
        expires_in: 3600,
        refresh_token: "fictional-refresh-token",
        ignored_provider_field: "not-returned",
      }),
    );

    await expect(
      exchangeAuthorizationCode({
        ...client,
        code: "fictional-code",
        codeVerifier: "fictional-verifier",
        fetchImpl,
      }),
    ).resolves.toEqual({
      accessToken: "fictional-access-token",
      expiresIn: 3600,
      refreshToken: "fictional-refresh-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: "fictional-code",
        code_verifier: "fictional-verifier",
        grant_type: "authorization_code",
        redirect_uri: client.redirectUri,
      }),
    );
  });

  it("refreshes with the stored refresh token and does not broaden fields", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      Response.json({ access_token: "next-fictional-access", expires_in: 1800 }),
    );

    await expect(
      refreshGoogleAccessToken({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken: "fictional-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({
      accessToken: "next-fictional-access",
      expiresIn: 1800,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
        refresh_token: "fictional-refresh-token",
      }),
    );
  });

  it("returns a fixed categorized error without logging request or response bodies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "fictional provider response body",
        },
        { status: 400 },
      ),
    );

    const result = exchangeAuthorizationCode({
      ...client,
      code: "fictional-code-body",
      codeVerifier: "fictional-verifier-body",
      fetchImpl,
    });

    await expect(result).rejects.toMatchObject({
      category: "authorization",
      message: "Google authorization could not be completed.",
      name: "GoogleOAuthError",
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("does not expose malformed or provider-supplied token responses", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      Response.json({
        access_token: 123,
        expires_in: "never",
        provider_message: "fictional sensitive provider message",
      }),
    );

    await expect(
      refreshGoogleAccessToken({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken: "fictional-refresh-token",
        fetchImpl,
      }),
    ).rejects.toEqual(new GoogleOAuthError("transient"));
  });

  it("rejects a non-2xx response even when its body looks successful", async () => {
    await expect(
      refreshWith({ access_token: "fictional-access", expires_in: 3600 }, 400),
    ).rejects.toEqual(new GoogleOAuthError("permanent"));
  });

  it.each([
    [401, "authorization"],
    [403, "authorization"],
    [429, "rate_limited"],
    [500, "transient"],
    [503, "transient"],
    [400, "permanent"],
  ] as const)("maps provider HTTP %s to %s", async (status, category) => {
    await expect(
      refreshWith({ error: "fictional_provider_error" }, status),
    ).rejects.toEqual(new GoogleOAuthError(category));
  });

  it.each(["", "   "])("rejects an empty access token", async (accessToken) => {
    await expect(
      refreshWith({ access_token: accessToken, expires_in: 3600 }),
    ).rejects.toEqual(new GoogleOAuthError("transient"));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "rejects an invalid expiry: %s",
    async (expiresIn) => {
      await expect(
        refreshWith({ access_token: "fictional-access", expires_in: expiresIn }),
      ).rejects.toEqual(new GoogleOAuthError("transient"));
    },
  );

  it.each(["", "   ", 123])(
    "rejects an invalid optional refresh token: %s",
    async (refreshToken) => {
      await expect(
        refreshWith({
          access_token: "fictional-access",
          expires_in: 3600,
          refresh_token: refreshToken,
        }),
      ).rejects.toEqual(new GoogleOAuthError("transient"));
    },
  );

  it("treats revocation as best effort and reports only 2xx success", async () => {
    const successfulFetch = vi.fn<FetchImplementation>(async () =>
      new Response(null, { status: 204 }),
    );
    const rejectedFetch = vi.fn<FetchImplementation>(async () =>
      new Response(null, { status: 400 }),
    );
    const unavailableFetch = vi.fn<FetchImplementation>(async () => {
      throw new Error("fictional network failure");
    });

    await expect(
      revokeGoogleToken({
        token: "fictional-token",
        fetchImpl: successfulFetch,
      }),
    ).resolves.toBe(true);
    await expect(
      revokeGoogleToken({
        token: "fictional-token",
        fetchImpl: rejectedFetch,
      }),
    ).resolves.toBe(false);
    await expect(
      revokeGoogleToken({
        token: "fictional-token",
        fetchImpl: unavailableFetch,
      }),
    ).resolves.toBe(false);
    expect(successfulFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
