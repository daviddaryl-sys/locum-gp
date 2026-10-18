// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGoogleCalendarGateway,
  GoogleCalendarError,
} from "../googleCalendarApi";
import type { GoogleManagedEvent } from "../eventProjection";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function mockFetch(implementation: FetchImplementation) {
  return vi.fn(implementation);
}

const event: GoogleManagedEvent = {
  id: "event-fixture",
  summary: "Locum session — Fictional Medical Centre",
  description: "Managed by Locum Manager",
  location: "12 Sample Road, London",
  start: {
    dateTime: "2026-08-11T09:00:00.000Z",
    timeZone: "Europe/London",
  },
  end: {
    dateTime: "2026-08-11T15:00:00.000Z",
    timeZone: "Europe/London",
  },
};

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

describe("Google Calendar API boundary", () => {
  it("creates exactly one dedicated Locum Manager calendar", async () => {
    const fetchImpl = mockFetch(async () =>
      response(200, { id: "calendar-fixture" }),
    );

    await expect(
      createGoogleCalendarGateway(fetchImpl).createCalendar("access-fixture"),
    ).resolves.toBe("calendar-fixture");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: "Bearer access-fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ summary: "Locum Manager" }),
    });
  });

  it("checks only the retained encoded calendar id", async () => {
    const fetchImpl = mockFetch(async () => response(200, {}));

    await expect(
      createGoogleCalendarGateway(fetchImpl).calendarExists(
        "access-fixture",
        "calendar/fixture",
      ),
    ).resolves.toBe(true);

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/calendar%2Ffixture",
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      headers: { Authorization: "Bearer access-fixture" },
    });
  });

  it("upserts by deterministic id, inserts on 404, and retries update on 409", async () => {
    const fetchImpl = vi
      .fn<FetchImplementation>()
      .mockResolvedValueOnce(response(404, { error: { message: "redacted" } }))
      .mockResolvedValueOnce(response(409, { error: { message: "redacted" } }))
      .mockResolvedValueOnce(response(200, {}));

    await createGoogleCalendarGateway(fetchImpl).upsertEvent(
      "access-fixture",
      "calendar/fixture",
      event,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [
        "https://www.googleapis.com/calendar/v3/calendars/calendar%2Ffixture/events/event-fixture",
        "PUT",
      ],
      [
        "https://www.googleapis.com/calendar/v3/calendars/calendar%2Ffixture/events",
        "POST",
      ],
      [
        "https://www.googleapis.com/calendar/v3/calendars/calendar%2Ffixture/events/event-fixture",
        "PUT",
      ],
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        headers: {
          Authorization: "Bearer access-fixture",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
    }
  });

  it.each([204, 404])("treats delete status %s as success", async (status) => {
    const fetchImpl = mockFetch(async () => response(status));

    await expect(
      createGoogleCalendarGateway(fetchImpl).deleteEvent(
        "access-fixture",
        "calendar/fixture",
        "event/fixture",
      ),
    ).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/calendar%2Ffixture/events/event%2Ffixture",
    );
  });

  it.each([
    [401, "authorization"],
    [403, "authorization"],
    [429, "rate_limited"],
    [503, "transient"],
    [410, "permanent"],
  ] as const)("collapses HTTP %s to %s", async (status, category) => {
    const fetchImpl = mockFetch(async () =>
      response(status, { error: { message: "provider-private-text" } }),
    );

    const failure = await createGoogleCalendarGateway(fetchImpl)
      .createCalendar("access-fixture")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GoogleCalendarError);
    expect(failure).toMatchObject({ category });
    expect(String(failure)).not.toContain("provider-private-text");
  });

  it("classifies absent retained calendars without exposing a response body", async () => {
    const fetchImpl = mockFetch(async () =>
      response(404, { error: { message: "provider-private-text" } }),
    );

    await expect(
      createGoogleCalendarGateway(fetchImpl).calendarExists(
        "access-fixture",
        "calendar-fixture",
      ),
    ).resolves.toBe(false);

    const createFailure = await createGoogleCalendarGateway(fetchImpl)
      .createCalendar("access-fixture")
      .catch((error: unknown) => error);
    expect(createFailure).toMatchObject({ category: "calendar_missing" });
    expect(String(createFailure)).not.toContain("provider-private-text");
  });

  it("collapses transport failures to transient", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("private transport detail");
    });

    const failure = await createGoogleCalendarGateway(fetchImpl)
      .calendarExists("access-fixture", "calendar-fixture")
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ category: "transient" });
    expect(String(failure)).not.toContain("private transport detail");
  });

  it("bounds every provider request well inside the durable job lease", async () => {
    vi.useFakeTimers();
    const fetchImpl = mockFetch(async (_input, init) => {
      if (!init?.signal) throw new Error("missing bounded signal");
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const pending = createGoogleCalendarGateway(fetchImpl, {
      requestTimeoutMs: 30_000,
    }).calendarExists("access-fixture", "calendar-fixture");
    const rejection = expect(pending).rejects.toMatchObject({
      category: "transient",
      outcome: "unknown",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    vi.useRealTimers();
  });

  it("does not permit a provider timeout above thirty seconds", () => {
    expect(() =>
      createGoogleCalendarGateway(mockFetch(async () => response(200)), {
        requestTimeoutMs: 30_001,
      }),
    ).toThrow("Google Calendar request configuration is invalid.");
  });

  it("keeps an unreadable successful calendar create fail-closed", async () => {
    const fetchImpl = mockFetch(async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      createGoogleCalendarGateway(fetchImpl).createCalendar("access-fixture"),
    ).rejects.toMatchObject({
      category: "transient",
      outcome: "unknown",
    });
  });

  it("bounds calendar-create response consumption inside the same request timeout", async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const fetchImpl = mockFetch(async () => response);
    const pending = createGoogleCalendarGateway(fetchImpl, {
      requestTimeoutMs: 30_000,
    }).createCalendar("access-fixture");
    const rejection = expect(pending).rejects.toMatchObject({
      category: "transient",
      outcome: "unknown",
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    vi.useRealTimers();
  });
});
