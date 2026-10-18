import "server-only";

import { createHmac } from "node:crypto";

export type CalendarEventSource = {
  ownerId: string;
  session: {
    id: string;
    starts_at: string;
    ends_at: string;
    status: "planned" | "completed" | "invoiced" | "cancelled";
    revision: number;
  };
  practice: {
    name: string;
    billing_address: { formatted?: string };
  };
  eventId: string;
};

export type GoogleManagedEvent = {
  id: string;
  summary: string;
  description: "Managed by Locum Manager";
  location?: string;
  start: { dateTime: string; timeZone: "Europe/London" };
  end: { dateTime: string; timeZone: "Europe/London" };
};

export function eventIdForSession(
  ownerId: string,
  sessionId: string,
  key: Buffer,
) {
  if (!ownerId || !sessionId || key.length !== 32) {
    throw new Error("Calendar event source is invalid.");
  }
  return createHmac("sha256", key)
    .update(`locum-manager:event:${ownerId}:${sessionId}`)
    .digest("hex")
    .slice(0, 32);
}

export function projectCalendarEvent(
  source: CalendarEventSource,
): GoogleManagedEvent {
  const startsAt = Date.parse(source.session.starts_at);
  const endsAt = Date.parse(source.session.ends_at);
  const practiceName = source.practice.name.trim();
  const location = source.practice.billing_address.formatted?.trim();
  if (
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    endsAt <= startsAt ||
    !practiceName ||
    !/^[a-f0-9]{32}$/.test(source.eventId)
  ) {
    throw new Error("Calendar event source is invalid.");
  }

  const event: GoogleManagedEvent = {
    id: source.eventId,
    summary:
      source.session.status === "cancelled"
        ? `Cancelled — ${practiceName}`
        : `Locum session — ${practiceName}`,
    description: "Managed by Locum Manager",
    start: {
      dateTime: source.session.starts_at,
      timeZone: "Europe/London",
    },
    end: {
      dateTime: source.session.ends_at,
      timeZone: "Europe/London",
    },
  };
  if (location) event.location = location;
  return event;
}
