import "server-only";

export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

export type CalendarServerConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: Buffer;
};

const CONFIGURATION_ERROR = "Google Calendar configuration is unavailable.";

export function calendarFeatureEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.GOOGLE_CALENDAR_ENABLED === "true";
}

export function readCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
): CalendarServerConfig {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const origin = env.GOOGLE_CALENDAR_REDIRECT_ORIGIN;
  const tokenKey = env.GOOGLE_CALENDAR_TOKEN_KEY
    ? Buffer.from(env.GOOGLE_CALENDAR_TOKEN_KEY, "base64")
    : Buffer.alloc(0);

  if (
    !calendarFeatureEnabled(env) ||
    !clientId ||
    !clientSecret ||
    !origin ||
    tokenKey.length !== 32
  ) {
    throw new Error(CONFIGURATION_ERROR);
  }

  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "https:" ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error();
    }

    return {
      clientId,
      clientSecret,
      redirectUri: new URL("/api/google-calendar/callback", parsed).toString(),
      tokenKey,
    };
  } catch {
    throw new Error(CONFIGURATION_ERROR);
  }
}
