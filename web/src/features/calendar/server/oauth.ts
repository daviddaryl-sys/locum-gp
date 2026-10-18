import "server-only";

import { CALENDAR_SCOPE } from "./config";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOCATION_URL = "https://oauth2.googleapis.com/revoke";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GoogleFailureCategory =
  | "authorization"
  | "rate_limited"
  | "transient"
  | "calendar_missing"
  | "permanent";

export class GoogleOAuthError extends Error {
  constructor(readonly category: GoogleFailureCategory) {
    super("Google authorization could not be completed.");
    this.name = "GoogleOAuthError";
  }
}

export type GoogleTokenResult = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
};

type OAuthClient = {
  clientId: string;
  clientSecret: string;
};

type AuthorizationCodeRequest = OAuthClient & {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: FetchImplementation;
};

type RefreshTokenRequest = OAuthClient & {
  refreshToken: string;
  fetchImpl?: FetchImplementation;
};

type RevokeTokenRequest = {
  token: string;
  fetchImpl?: FetchImplementation;
};

export function createAuthorizationUrl({
  clientId,
  codeChallenge,
  redirectUri,
  state,
}: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}) {
  const authorization = new URL(AUTHORIZATION_URL);
  authorization.search = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    state,
  }).toString();
  return authorization;
}

function parseTokenResponse(value: unknown): GoogleTokenResult {
  if (!value || typeof value !== "object") {
    throw new GoogleOAuthError("transient");
  }

  const row = value as Record<string, unknown>;
  if (
    typeof row.access_token !== "string" ||
    !row.access_token.trim() ||
    typeof row.expires_in !== "number" ||
    !Number.isFinite(row.expires_in) ||
    row.expires_in <= 0 ||
    ("refresh_token" in row &&
      (typeof row.refresh_token !== "string" || !row.refresh_token.trim()))
  ) {
    throw new GoogleOAuthError(
      row.error === "invalid_grant" ? "authorization" : "transient",
    );
  }

  return {
    accessToken: row.access_token,
    expiresIn: row.expires_in,
    refreshToken:
      typeof row.refresh_token === "string" ? row.refresh_token : undefined,
  };
}

function failureCategory(
  response: Response,
  value: unknown,
): GoogleFailureCategory {
  const providerError =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).error
      : undefined;
  if (
    providerError === "invalid_grant" ||
    response.status === 401 ||
    response.status === 403
  ) {
    return "authorization";
  }
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "transient";
  if (response.status >= 400) return "permanent";
  return "transient";
}

async function requestToken(
  body: URLSearchParams,
  fetchImpl: FetchImplementation,
) {
  let response: Response;
  let value: unknown;

  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new GoogleOAuthError("transient");
  }

  try {
    value = await response.json();
  } catch {
    value = undefined;
  }

  if (!response.ok) {
    throw new GoogleOAuthError(failureCategory(response, value));
  }

  return parseTokenResponse(value);
}

export function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
  fetchImpl = fetch,
}: AuthorizationCodeRequest) {
  return requestToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    fetchImpl,
  );
}

export function refreshGoogleAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
}: RefreshTokenRequest) {
  return requestToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    fetchImpl,
  );
}

export async function revokeGoogleToken({
  token,
  fetchImpl = fetch,
}: RevokeTokenRequest) {
  try {
    const response = await fetchImpl(REVOCATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
