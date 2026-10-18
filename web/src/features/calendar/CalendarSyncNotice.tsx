"use client";

import Link from "next/link";

import { useGoogleCalendar } from "./GoogleCalendarProvider";

export function CalendarSyncNotice() {
  const { summary } = useGoogleCalendar();
  if (summary.state === "pending") {
    return (
      <p aria-live="polite" className="record-page__runtime" role="status">
        <Link href="/settings/connected-services">Calendar sync pending</Link>
      </p>
    );
  }
  if (summary.state === "reconnect_required") {
    return (
      <p className="record-page__runtime" role="alert">
        <Link href="/settings/connected-services">Reconnect Google Calendar</Link>
      </p>
    );
  }
  return null;
}
