import { createCalendarRepository } from "@/features/calendar/server/calendarRepository";
import { readCalendarConfig } from "@/features/calendar/server/config";
import { revokeGoogleToken } from "@/features/calendar/server/oauth";
import { decryptSecret } from "@/features/calendar/server/secretEnvelope";
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

  try {
    const repository = createCalendarRepository(createAdminClient());
    const connection = await repository.getConnection(ownerId);
    if (connection?.refreshTokenEnvelope) {
      try {
        const config = readCalendarConfig();
        const refreshToken = decryptSecret(
          connection.refreshTokenEnvelope,
          config.tokenKey,
          "refresh-token",
        );
        await revokeGoogleToken({ token: refreshToken });
      } catch {
        // Revocation is best effort; local token removal remains authoritative.
      }
    }
    await repository.disconnect(ownerId, new Date().toISOString());
    return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch {
    return noStoreJson(
      { error: "Google Calendar could not be disconnected." },
      503,
    );
  }
}
