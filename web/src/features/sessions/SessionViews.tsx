"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { OfflineStorageAlert } from "@/components/runtime/OfflineStorageAlert";
import { CalendarSyncNotice } from "@/features/calendar/CalendarSyncNotice";
import { SessionCalendar } from "@/features/calendar/SessionCalendar";
import type { CalendarSession } from "@/features/calendar/calendarModel";
import { isDemoSessionPayload } from "@/features/demo/demoFixtures";

import { durationHours, sessionValuePence } from "@/domain/session";
import { formatPenceForInput } from "@/features/practices/PracticeForm";
import {
  isoToLondonFormValues,
  sessionFormValuesForDate,
  SessionForm,
  type SessionFormValues,
  type SessionInput,
  type SessionPractice,
} from "@/features/sessions/SessionForm";
import { moveSessionInstantsToLondonDate } from "@/features/sessions/sessionDateMove";
import { useOfflineRecord, useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord, RecordPayload } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

type SessionData = Omit<SessionInput, "status"> & {
  status: "planned" | "completed" | "invoiced" | "cancelled";
};

type SessionEntry = { data: Pick<SessionData, "status" | "startsAt"> };

type SessionsView = "list" | "calendar";

export function filterSessionEntries<T extends SessionEntry>(
  entries: T[],
  requestedStatus: string,
  now: Date,
): T[] {
  const status = ["all", "ready-to-invoice", "upcoming", "planned", "completed", "invoiced", "cancelled"].includes(requestedStatus)
    ? requestedStatus
    : "all";
  return entries.filter(({ data }) => {
    if (status === "all") return true;
    if (status === "ready-to-invoice") return data.status === "completed";
    if (status === "upcoming") {
      const startsAt = Date.parse(data.startsAt);
      return data.status === "planned" && Number.isFinite(startsAt) && startsAt > now.getTime();
    }
    return data.status === status;
  });
}

function practiceData(record: LocalRecord): SessionPractice | null {
  const data = record.data;
  if (
    typeof data.name !== "string" ||
    typeof data.defaultHourlyRatePence !== "number" ||
    typeof data.archived !== "boolean"
  ) {
    return null;
  }
  return {
    id: record.id,
    name: data.name,
    defaultHourlyRatePence: data.defaultHourlyRatePence,
    archived: data.archived,
  };
}

export function parseSessionData(payload: RecordPayload): SessionData | null {
  if (
    typeof payload.practiceId !== "string" ||
    typeof payload.startsAt !== "string" ||
    typeof payload.endsAt !== "string" ||
    typeof payload.hourlyRatePence !== "number" ||
    typeof payload.status !== "string" ||
    !["planned", "completed", "invoiced", "cancelled"].includes(payload.status) ||
    (payload.notes !== null && typeof payload.notes !== "string")
  ) {
    return null;
  }
  return {
    practiceId: payload.practiceId,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    hourlyRatePence: payload.hourlyRatePence,
    status: payload.status as SessionData["status"],
    notes: payload.notes ?? "",
  };
}

function formatGBP(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function durationText(data: SessionData) {
  try {
    const hours = durationHours(data.startsAt, data.endsAt);
    const label = `${hours.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${hours === 1 ? "hour" : "hours"}`;
    return `${label} · ${formatGBP(sessionValuePence(hours, data.hourlyRatePence))}`;
  } catch {
    return "Time needs attention";
  }
}

function londonDateLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function sessionEmptyMessage(
  sessionCount: number,
  filteredCount: number,
) {
  if (sessionCount === 0) {
    return "No sessions yet. Add the work you did.";
  }
  if (filteredCount === 0) {
    return "No sessions match this view yet.";
  }
  return null;
}

function sessionValues(data: SessionData): SessionFormValues {
  const start = isoToLondonFormValues(data.startsAt);
  const end = isoToLondonFormValues(data.endsAt);
  return {
    practiceId: data.practiceId,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    hourlyRatePounds: formatPenceForInput(data.hourlyRatePence),
    notes: data.notes,
    completed: data.status === "completed" || data.status === "invoiced",
  };
}

export function SessionList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initializationError, markSaving, ready, repository, syncNow } = useSync();
  const [view, setView] = useState<SessionsView>("list");
  const requestedStatus = searchParams.get("status") ?? "all";
  const status = ["all", "ready-to-invoice", "upcoming", "planned", "completed", "invoiced", "cancelled"].includes(requestedStatus) ? requestedStatus : "all";
  const sessionRecords = useOfflineRecords("sessions");
  const practiceRecords = useOfflineRecords("practices");
  const practiceNames = new Map(
    practiceRecords
      ?.map((record) => practiceData(record))
      .filter((practice): practice is SessionPractice => Boolean(practice))
      .map((practice) => [practice.id, practice.name]),
  );
  const sessions = filterSessionEntries(sessionRecords
    ?.map((record) => ({ record, data: parseSessionData(record.data) }))
    .filter((item): item is { record: LocalRecord; data: SessionData } => Boolean(item.data))
    .sort((left, right) => right.data.startsAt.localeCompare(left.data.startsAt)) ?? [], status, new Date());
  const calendarSessions: CalendarSession[] = sessionRecords?.flatMap((record) => {
    const data = parseSessionData(record.data);
    return data ? [{
      id: record.id,
      practiceName: practiceNames.get(data.practiceId) ?? "Unknown practice",
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      status: data.status,
      isDemo: isDemoSessionPayload(record.data),
    }] : [];
  }) ?? [];
  const emptyMessage = sessionRecords === undefined
    ? null
    : sessionEmptyMessage(sessionRecords.length, sessions.length);

  useEffect(() => {
    const saved = localStorage.getItem("locum-manager:sessions-view");
    if (saved === "list" || saved === "calendar") queueMicrotask(() => setView(saved));
  }, []);

  const selectView = (nextView: SessionsView) => {
    setView(nextView);
    localStorage.setItem("locum-manager:sessions-view", nextView);
  };

  return (
    <section className="record-page" aria-labelledby="sessions-title">
      <div className="record-page__header">
        <div><h1 id="sessions-title">Sessions</h1></div>
        <Link className="primary-action" href="/sessions/new">Add session</Link>
      </div>
      <OfflineStorageAlert initializationError={initializationError} />
      <div className="sessions-view-toggle" aria-label="Sessions view">
        <button aria-pressed={view === "list"} onClick={() => selectView("list")} type="button">List</button>
        <button aria-pressed={view === "calendar"} onClick={() => selectView("calendar")} type="button">Calendar</button>
      </div>
      <CalendarSyncNotice />
      {view === "list" ? <>
      <div className="invoice-filters">
        <label>Status<select onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          if (event.target.value === "all") params.delete("status"); else params.set("status", event.target.value);
          router.replace(`/sessions${params.size ? `?${params.toString()}` : ""}`);
        }} value={status}><option value="all">All</option><option value="ready-to-invoice">Ready to invoice</option><option value="upcoming">Upcoming</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="cancelled">Cancelled</option></select></label>
      </div>
      {sessions.length ? (
        <ul className="record-list">
          {sessions.map(({ record, data }) => (
            <li key={record.id}>
              <Link className="record-card" href={`/sessions/${record.id}`}>
                <span className="record-card__title">{practiceNames.get(data.practiceId) ?? "Unknown practice"}</span>
                {isDemoSessionPayload(record.data) ? <span className="demo-badge">Demo</span> : null}
                <span>{londonDateLabel(data.startsAt)}</span>
                <span>{durationText(data)}</span>
                <span className="record-card__status">{data.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : emptyMessage ? (
        <p className="record-page__empty">{emptyMessage}</p>
      ) : null}
      </> : <SessionCalendar
        onMoveSession={async (sessionId, targetDate) => {
          if (!ready || !repository) throw new Error("Offline storage is not ready.");
          await repository.transformRecordAtomically("sessions", sessionId, (latestRecord) => {
            const latestData = latestRecord ? parseSessionData(latestRecord.data) : null;
            if (!latestRecord || latestRecord.deletedAt || !latestData || latestData.status === "invoiced") {
              throw new Error("Session cannot be moved.");
            }
            const movedInstants = moveSessionInstantsToLondonDate({
              startsAt: latestData.startsAt,
              endsAt: latestData.endsAt,
              targetDate,
            });
            return {
              ...latestRecord.data,
              ...movedInstants,
            };
          });
          markSaving();
          void syncNow().catch(() => undefined);
        }}
        sessions={calendarSessions}
      />}
    </section>
  );
}

export function NewSession() {
  const searchParams = useSearchParams();
  const initialValues = sessionFormValuesForDate(searchParams.get("date"));
  const practiceRecords = useOfflineRecords("practices");
  const practices = practiceRecords
    ?.map((record) => practiceData(record))
    .filter((practice): practice is SessionPractice => Boolean(practice))
    .sort((left, right) => left.name.localeCompare(right.name)) ?? [];
  const { initializationError, markSaving, ready, repository, syncNow } = useSync();
  const id = useRef<string | null>(null);

  return (
    <section className="record-page record-page--form" aria-labelledby="new-session-title">
      <Link className="record-page__back" href="/sessions">← Sessions</Link>
      <p className="eyebrow">Work record</p>
      <h1 id="new-session-title">New session</h1>
      <OfflineStorageAlert initializationError={initializationError} />
      {practices.length ? (
        <SessionForm
          initialValues={initialValues}
          onSubmit={async (input) => {
            if (!ready || !repository) throw new Error("Offline storage is not ready.");
            id.current ??= crypto.randomUUID();
            await repository.saveRecord("sessions", id.current, input);
            markSaving();
            void syncNow();
          }}
          practices={practices}
        />
      ) : practiceRecords ? (
        <div className="record-page__empty">Add an active practice before recording a session. <Link href="/practices/new">Add practice</Link></div>
      ) : null}
    </section>
  );
}

export function EditSession() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const record = useOfflineRecord("sessions", id);
  const practiceRecords = useOfflineRecords("practices");
  const practices = practiceRecords
    ?.map((item) => practiceData(item))
    .filter((practice): practice is SessionPractice => Boolean(practice)) ?? [];
  const { initializationError, markSaving, ready, repository, syncNow } = useSync();
  const data = record ? parseSessionData(record.data) : null;

  if (record === undefined || practiceRecords === undefined) {
    return <section className="record-page"><OfflineStorageAlert initializationError={initializationError} /></section>;
  }
  if (!record || !data) {
    return <section className="record-page"><h1>Session not found</h1><Link href="/sessions">Back to sessions</Link></section>;
  }

  return (
    <section className="record-page record-page--form" aria-labelledby="edit-session-title">
      <Link className="record-page__back" href="/sessions">← Sessions</Link>
      <p className="eyebrow">Work record</p>
      <h1 id="edit-session-title">Edit session</h1>
      <OfflineStorageAlert initializationError={initializationError} />
      <SessionForm
        initialValues={sessionValues(data)}
        invoiced={data.status === "invoiced"}
        onSubmit={async (input) => {
          if (!ready || !repository) throw new Error("Offline storage is not ready.");
          await repository.saveRecord("sessions", id, input);
          markSaving();
          void syncNow();
        }}
        practices={practices}
        submitLabel="Save changes"
      />
    </section>
  );
}
