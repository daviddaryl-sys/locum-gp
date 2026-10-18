// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  eventIdForSession,
  projectCalendarEvent,
} from "../eventProjection";

describe("Calendar event projection", () => {
  it("constructs only the approved Google event fields", () => {
    const sensitiveSource = {
      ownerId: "owner-fixture",
      session: {
        id: "session-fixture",
        starts_at: "2026-08-11T09:00:00.000Z",
        ends_at: "2026-08-11T15:00:00.000Z",
        status: "planned" as const,
        hourly_rate_pence: 9000,
        notes: "must not leave app",
        revision: 4,
        invoice: { number: "PRIVATE" },
        payment: { state: "PRIVATE" },
      },
      practice: {
        name: "Fictional Medical Centre",
        billing_address: { formatted: "12 Sample Road, London" },
        default_hourly_rate_pence: 9000,
        tax: { reference: "PRIVATE" },
        receipt: { path: "PRIVATE" },
      },
      eventId: "0123456789abcdef0123456789abcdef",
    };

    const projected = projectCalendarEvent(sensitiveSource);

    expect(projected).toEqual({
      id: "0123456789abcdef0123456789abcdef",
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
    });

    const serialized = JSON.stringify(projected).toLowerCase();
    for (const forbidden of [
      "hourly",
      "rate",
      "notes",
      "invoice",
      "owner",
      "tax",
      "receipt",
      "payment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("labels cancelled sessions without adding an empty address", () => {
    expect(
      projectCalendarEvent({
        ownerId: "owner-fixture",
        session: {
          id: "session-fixture",
          starts_at: "2026-08-11T09:00:00.000Z",
          ends_at: "2026-08-11T15:00:00.000Z",
          status: "cancelled",
          revision: 4,
        },
        practice: {
          name: "Fictional Medical Centre",
          billing_address: { formatted: "   " },
        },
        eventId: "0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({
      id: "0123456789abcdef0123456789abcdef",
      summary: "Cancelled — Fictional Medical Centre",
      description: "Managed by Locum Manager",
      start: {
        dateTime: "2026-08-11T09:00:00.000Z",
        timeZone: "Europe/London",
      },
      end: {
        dateTime: "2026-08-11T15:00:00.000Z",
        timeZone: "Europe/London",
      },
    });
  });

  it("normalizes surrounding whitespace in approved text fields", () => {
    const event = projectCalendarEvent({
      ownerId: "owner-fixture",
      session: {
        id: "session-fixture",
        starts_at: "2026-08-11T09:00:00.000Z",
        ends_at: "2026-08-11T15:00:00.000Z",
        status: "completed",
        revision: 4,
      },
      practice: {
        name: "  Fictional Medical Centre  ",
        billing_address: { formatted: "  12 Sample Road, London  " },
      },
      eventId: "0123456789abcdef0123456789abcdef",
    });

    expect(event.summary).toBe("Locum session — Fictional Medical Centre");
    expect(event.location).toBe("12 Sample Road, London");
  });

  it("rejects invalid or reversed event instants", () => {
    const source = {
      ownerId: "owner-fixture",
      session: {
        id: "session-fixture",
        starts_at: "not-a-date",
        ends_at: "2026-08-11T15:00:00.000Z",
        status: "planned" as const,
        revision: 4,
      },
      practice: {
        name: "Fictional Medical Centre",
        billing_address: {},
      },
      eventId: "0123456789abcdef0123456789abcdef",
    };

    expect(() => projectCalendarEvent(source)).toThrow(
      "Calendar event source is invalid.",
    );
    expect(() =>
      projectCalendarEvent({
        ...source,
        session: {
          ...source.session,
          starts_at: "2026-08-11T16:00:00.000Z",
        },
      }),
    ).toThrow("Calendar event source is invalid.");
  });

  it("derives stable owner-scoped opaque event ids", () => {
    const key = Buffer.alloc(32, 7);

    const first = eventIdForSession("owner-a", "session-a", key);

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(eventIdForSession("owner-a", "session-a", key)).toBe(first);
    expect(eventIdForSession("owner-b", "session-a", key)).not.toBe(first);
    expect(eventIdForSession("owner-a", "session-b", key)).not.toBe(first);
  });
});
