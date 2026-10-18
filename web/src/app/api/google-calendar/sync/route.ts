import { createCalendarRepository, type CalendarSyncSummary } from "@/features/calendar/server/calendarRepository";
import { calendarFeatureEnabled, readCalendarConfig } from "@/features/calendar/server/config";
import { createGoogleCalendarGateway } from "@/features/calendar/server/googleCalendarApi";
import { refreshGoogleAccessToken } from "@/features/calendar/server/oauth";
import { decryptSecret } from "@/features/calendar/server/secretEnvelope";
import { synchronizeOwnerCalendar } from "@/features/calendar/server/syncCoordinator";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Expires: "0",
  Pragma: "no-cache",
};

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

const PENDING: CalendarSyncSummary = {
  state: "pending",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};

function canonicalSummary(summary: CalendarSyncSummary): CalendarSyncSummary {
  const instant = (value: string | null) =>
    value === null ? null : new Date(value).toISOString();
  return {
    ...summary,
    lastSyncAt: instant(summary.lastSyncAt),
    nextRetryAt: instant(summary.nextRetryAt),
  };
}

export async function POST(request: Request) {
  void request;
  let ownerId: string | null = null;
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const subject = data?.claims?.sub;
    if (!error && typeof subject === "string" && subject) ownerId = subject;
  } catch {
    // Authentication failures are exposed only as a private unauthorized result.
  }
  if (!ownerId) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }
  if (!calendarFeatureEnabled()) {
    return noStoreJson({ ...PENDING, state: "disabled" });
  }

  let repository: ReturnType<typeof createCalendarRepository> | undefined;
  try {
    const config = readCalendarConfig();
    repository = createCalendarRepository(createAdminClient());
    const summary = await synchronizeOwnerCalendar(ownerId, {
      repository,
      gateway: createGoogleCalendarGateway(),
      eventIdKey: config.tokenKey,
      decryptRefreshToken: (envelope) =>
        decryptSecret(envelope, config.tokenKey, "refresh-token"),
      refreshAccessToken: (refreshToken) =>
        refreshGoogleAccessToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          refreshToken,
        }),
    });
    return noStoreJson(canonicalSummary(summary));
  } catch {
    if (repository) {
      try {
        return noStoreJson(canonicalSummary(await repository.status(ownerId)));
      } catch {
        // Ordinary app sync must remain available when Calendar is unavailable.
      }
    }
    return noStoreJson(PENDING);
  }
}
