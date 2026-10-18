import { cookies } from "next/headers";

import { calendarFeatureEnabled, readCalendarConfig } from "@/features/calendar/server/config";
import { createAuthorizationUrl } from "@/features/calendar/server/oauth";
import { createOAuthState } from "@/features/calendar/server/oauthState";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_calendar_oauth_state";
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

export async function POST(request: Request) {
  void request;
  const ownerId = await authenticatedOwner();
  if (!ownerId) return noStoreJson({ error: "Unauthorized" }, 401);

  try {
    if (!calendarFeatureEnabled()) {
      return noStoreJson({ error: "Google Calendar is unavailable." }, 404);
    }
    const config = readCalendarConfig();
    const state = await createOAuthState(
      ownerId,
      "/settings/connected-services",
    );
    const authorization = createAuthorizationUrl({
      clientId: config.clientId,
      codeChallenge: state.codeChallenge,
      redirectUri: config.redirectUri,
      state: state.state,
    });
    const cookieStore = await cookies();
    cookieStore.set(STATE_COOKIE, state.sealedState, {
      httpOnly: true,
      maxAge: 600,
      path: "/api/google-calendar/callback",
      sameSite: "lax",
      secure: true,
    });
    return noStoreRedirect(authorization.toString());
  } catch {
    return noStoreJson(
      { error: "Google Calendar connection could not be started." },
      503,
    );
  }
}
