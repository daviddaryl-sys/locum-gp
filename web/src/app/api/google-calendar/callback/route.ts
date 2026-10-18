import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import {
  createCalendarRepository,
  type CalendarRepository,
} from "@/features/calendar/server/calendarRepository";
import { readCalendarConfig } from "@/features/calendar/server/config";
import { createGoogleCalendarGateway } from "@/features/calendar/server/googleCalendarApi";
import type { GoogleCalendarGateway } from "@/features/calendar/server/googleCalendarApi";
import { exchangeAuthorizationCode } from "@/features/calendar/server/oauth";
import { consumeOAuthState } from "@/features/calendar/server/oauthState";
import { encryptSecret } from "@/features/calendar/server/secretEnvelope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_calendar_oauth_state";
const RETURN_PATH = "/settings/connected-services";
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Expires: "0",
  Pragma: "no-cache",
};

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

function noStoreRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: { ...PRIVATE_HEADERS, Location: location },
  });
}

function calendarRedirect(value: "connected" | "error" | "not-connected") {
  return noStoreRedirect(`${RETURN_PATH}?calendar=${value}`);
}

async function authenticatedOwner() {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const ownerId = data?.claims?.sub;
    return error || typeof ownerId !== "string" || !ownerId ? null : ownerId;
  } catch {
    return null;
  }
}

function isKnownProviderFailure(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "outcome" in error &&
      (error as { outcome?: unknown }).outcome === "known_failure",
  );
}

async function initialCalendar(
  ownerId: string,
  accessToken: string,
  refreshTokenEnvelope: Parameters<CalendarRepository["completeCalendarSetup"]>[3],
  at: string,
  repository: CalendarRepository,
  gateway: GoogleCalendarGateway,
) {
  const claimToken = randomUUID();
  const claim = await repository.claimCalendarSetup(ownerId, claimToken, at);
  if (claim.state === "busy") throw new Error();

  let calendarId: string;
  if (claim.state === "resume") {
    calendarId = claim.calendarId;
    if (!(await gateway.calendarExists(accessToken, calendarId))) {
      throw new Error();
    }
  } else {
    try {
      calendarId = await gateway.createCalendar(accessToken);
    } catch (error) {
      if (isKnownProviderFailure(error)) {
        await repository.releaseCalendarSetup(ownerId, claimToken);
      }
      throw error;
    }
    const staged = await repository.stageCalendarSetup(
      ownerId,
      claimToken,
      calendarId,
      at,
    );
    if (!staged) throw new Error();
  }

  const completed = await repository.completeCalendarSetup(
    ownerId,
    claimToken,
    calendarId,
    refreshTokenEnvelope,
    at,
  );
  if (completed !== "completed") throw new Error();
  return calendarId;
}

async function replacementCalendar(
  ownerId: string,
  expectedCalendarId: string,
  accessToken: string,
  at: string,
  repository: CalendarRepository,
  gateway: GoogleCalendarGateway,
) {
  const claimToken = randomUUID();
  const claim = await repository.claimCalendarReplacement(
    ownerId,
    expectedCalendarId,
    claimToken,
    at,
  );
  if (claim.state === "busy" || claim.state === "stale") throw new Error();

  let calendarId: string;
  if (claim.state === "resume") {
    calendarId = claim.calendarId;
    if (!(await gateway.calendarExists(accessToken, calendarId))) {
      throw new Error();
    }
  } else {
    try {
      calendarId = await gateway.createCalendar(accessToken);
    } catch (error) {
      if (isKnownProviderFailure(error)) {
        await repository.releaseCalendarReplacement(
          ownerId,
          expectedCalendarId,
          claimToken,
          at,
        );
      }
      throw error;
    }
    const staged = await repository.stageCalendarReplacement(
      ownerId,
      expectedCalendarId,
      claimToken,
      calendarId,
      at,
    );
    if (!staged) throw new Error();
  }

  const completed = await repository.completeCalendarReplacement(
    ownerId,
    expectedCalendarId,
    claimToken,
    calendarId,
    at,
  );
  if (completed !== "completed") throw new Error();
  return calendarId;
}

export async function GET(request: Request) {
  const ownerId = await authenticatedOwner();
  if (!ownerId) return noStoreJson({ error: "Unauthorized" }, 401);

  let sealedState = "";
  try {
    const cookieStore = await cookies();
    try {
      sealedState = cookieStore.get(STATE_COOKIE)?.value ?? "";
    } finally {
      cookieStore.set(STATE_COOKIE, "", {
        httpOnly: true,
        maxAge: 0,
        path: "/api/google-calendar/callback",
        sameSite: "lax",
        secure: true,
      });
    }
  } catch {
    return calendarRedirect("error");
  }

  try {
    const url = new URL(request.url);
    const returnedState = url.searchParams.get("state") ?? "";
    if (!sealedState || !returnedState) throw new Error();

    const consumed = await consumeOAuthState(
      sealedState,
      returnedState,
      ownerId,
    );
    if (consumed.returnTo !== RETURN_PATH) throw new Error();
    if (url.searchParams.has("error")) {
      return calendarRedirect("not-connected");
    }

    const code = url.searchParams.get("code");
    if (!code) throw new Error();
    const config = readCalendarConfig();
    const token = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      codeVerifier: consumed.verifier,
      redirectUri: config.redirectUri,
    });

    const repository = createCalendarRepository(createAdminClient());
    const existing = await repository.getConnection(ownerId);
    const canPreserveRefreshToken =
      existing?.status === "connected" && existing.refreshTokenEnvelope;
    const refreshTokenEnvelope = token.refreshToken
      ? encryptSecret(token.refreshToken, config.tokenKey, "refresh-token")
      : canPreserveRefreshToken;
    if (!refreshTokenEnvelope) throw new Error();

    const gateway = createGoogleCalendarGateway();
    const connectedAt = new Date().toISOString();
    let calendarId: string;
    if (!existing) {
      calendarId = await initialCalendar(
        ownerId,
        token.accessToken,
        refreshTokenEnvelope,
        connectedAt,
        repository,
        gateway,
      );
    } else {
      calendarId = existing.calendarId;
      const exists = await gateway.calendarExists(token.accessToken, calendarId);
      if (!exists) {
        calendarId = await replacementCalendar(
          ownerId,
          calendarId,
          token.accessToken,
          connectedAt,
          repository,
          gateway,
        );
      }
      await repository.saveConnection(ownerId, {
        calendarId,
        connectedAt:
          existing.status === "connected" ? existing.connectedAt : connectedAt,
        lastSyncAt: existing.lastSyncAt,
        refreshTokenEnvelope,
        status: "connected",
      });
    }
    await repository.reconcileJobs(ownerId, connectedAt, connectedAt);
    return calendarRedirect("connected");
  } catch {
    return calendarRedirect("error");
  }
}
