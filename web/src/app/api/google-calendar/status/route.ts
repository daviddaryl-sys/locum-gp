import { createCalendarRepository, type CalendarSyncSummary } from "@/features/calendar/server/calendarRepository";
import { calendarFeatureEnabled } from "@/features/calendar/server/config";
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

const DISABLED: CalendarSyncSummary = {
  state: "disabled",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};

export async function GET(request: Request) {
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

  if (!calendarFeatureEnabled()) return noStoreJson(DISABLED);
  try {
    const repository = createCalendarRepository(createAdminClient());
    return noStoreJson(await repository.status(ownerId));
  } catch {
    return noStoreJson(
      {
        state: "pending",
        pendingCount: 0,
        lastSyncAt: null,
        nextRetryAt: null,
      } satisfies CalendarSyncSummary,
    );
  }
}
