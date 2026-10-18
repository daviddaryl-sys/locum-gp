import "server-only";

import type { GoogleFailureCategory } from "./oauth";
import type { GoogleManagedEvent } from "./eventProjection";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GoogleCalendarGateway {
  createCalendar(accessToken: string): Promise<string>;
  calendarExists(accessToken: string, calendarId: string): Promise<boolean>;
  upsertEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleManagedEvent,
  ): Promise<void>;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void>;
}

export class GoogleCalendarError extends Error {
  constructor(
    readonly category: GoogleFailureCategory,
    readonly outcome: "known_failure" | "unknown" = "known_failure",
  ) {
    super("Google Calendar could not be synchronized.");
    this.name = "GoogleCalendarError";
  }
}

function categoryForStatus(status: number): GoogleFailureCategory {
  if (status === 401 || status === 403) return "authorization";
  if (status === 404) return "calendar_missing";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  return "permanent";
}

async function request<T>(
  fetchImpl: FetchImplementation,
  input: string,
  init: RequestInit,
  requestTimeoutMs: number,
  consume: (response: Response) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GoogleCalendarError("transient", "unknown"));
    }, requestTimeoutMs);
  });
  try {
    return await Promise.race([
      (async () =>
        consume(
          await fetchImpl(input, {
            ...init,
            cache: "no-store",
            signal: controller.signal,
          }),
        ))(),
      timedOut,
    ]);
  } catch (error) {
    if (error instanceof GoogleCalendarError) throw error;
    throw new GoogleCalendarError("transient", "unknown");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function headers(accessToken: string, body = false): HeadersInit {
  return body
    ? {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      }
    : { Authorization: `Bearer ${accessToken}` };
}

function calendarUrl(calendarId: string) {
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`;
}

function eventUrl(calendarId: string, eventId?: string) {
  const collection = `${calendarUrl(calendarId)}/events`;
  return eventId ? `${collection}/${encodeURIComponent(eventId)}` : collection;
}

function assertSuccess(response: Response) {
  if (!response.ok) {
    throw new GoogleCalendarError(categoryForStatus(response.status));
  }
}

export function createGoogleCalendarGateway(
  fetchImpl: FetchImplementation = fetch,
  options: { requestTimeoutMs?: number } = {},
): GoogleCalendarGateway {
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  if (
    !Number.isFinite(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > 30_000
  ) {
    throw new Error("Google Calendar request configuration is invalid.");
  }
  return {
    async createCalendar(accessToken) {
      return request(
        fetchImpl,
        `${CALENDAR_API}/calendars`,
        {
          method: "POST",
          headers: headers(accessToken, true),
          body: JSON.stringify({ summary: "Locum Manager" }),
        },
        requestTimeoutMs,
        async (response) => {
          assertSuccess(response);
          let value: unknown;
          try {
            value = await response.json();
          } catch {
            throw new GoogleCalendarError("transient", "unknown");
          }
          const calendarId =
            value && typeof value === "object"
              ? (value as Record<string, unknown>).id
              : undefined;
          if (typeof calendarId !== "string" || !calendarId.trim()) {
            throw new GoogleCalendarError("transient", "unknown");
          }
          return calendarId;
        },
      );
    },

    async calendarExists(accessToken, calendarId) {
      const response = await request(
        fetchImpl,
        calendarUrl(calendarId),
        {
          method: "GET",
          headers: headers(accessToken),
        },
        requestTimeoutMs,
        (response) => response,
      );
      if (response.status === 404) return false;
      assertSuccess(response);
      return true;
    },

    async upsertEvent(accessToken, calendarId, event) {
      const body = JSON.stringify(event);
      const init = {
        headers: headers(accessToken, true),
        body,
      } satisfies RequestInit;
      let response = await request(
        fetchImpl,
        eventUrl(calendarId, event.id),
        { ...init, method: "PUT" },
        requestTimeoutMs,
        (value) => value,
      );
      if (response.status !== 404) {
        assertSuccess(response);
        return;
      }

      response = await request(
        fetchImpl,
        eventUrl(calendarId),
        { ...init, method: "POST" },
        requestTimeoutMs,
        (value) => value,
      );
      if (response.status !== 409) {
        assertSuccess(response);
        return;
      }

      response = await request(
        fetchImpl,
        eventUrl(calendarId, event.id),
        { ...init, method: "PUT" },
        requestTimeoutMs,
        (value) => value,
      );
      assertSuccess(response);
    },

    async deleteEvent(accessToken, calendarId, eventId) {
      const response = await request(
        fetchImpl,
        eventUrl(calendarId, eventId),
        {
          method: "DELETE",
          headers: headers(accessToken),
        },
        requestTimeoutMs,
        (value) => value,
      );
      if (response.status === 404 || response.status === 204) return;
      assertSuccess(response);
    },
  };
}
