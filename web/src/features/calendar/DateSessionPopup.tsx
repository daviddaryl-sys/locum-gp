"use client";

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  calendarDateLabel,
  calendarStatusLabel,
  calendarTimeLabel,
  type CalendarSession,
} from "./calendarModel";

type DateSessionPopupProps = {
  dateKey: string;
  onClose: () => void;
  sessions: CalendarSession[];
};

const focusableSelector = "a[href], button:not([disabled])";

export function DateSessionPopup({ dateKey, onClose, sessions }: DateSessionPopupProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingId = `session-date-popup-${dateKey}`;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).filter((control) => !control.hasAttribute("disabled"));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="session-date-popup__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={headingId}
        aria-modal="true"
        className="session-date-popup"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="session-date-popup__header">
          <div>
            <p className="session-date-popup__eyebrow">Selected date</p>
            <h2 id={headingId}>{calendarDateLabel(dateKey)}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} ref={closeRef} type="button">×</button>
        </div>
        <Link className="primary-action session-date-popup__add" href={`/sessions/new?date=${dateKey}`}>
          Add session
        </Link>
        <p className="session-date-popup__label">Sessions on this date</p>
        {sessions.length ? (
          <ol>{sessions.map((session) => (
            <li key={session.id}>
              <Link href={`/sessions/${session.id}`}>
                <strong>{session.practiceName}</strong>
                <span>{calendarTimeLabel(session.startsAt)}–{calendarTimeLabel(session.endsAt)}</span>
                <span>{calendarStatusLabel(session.status)}</span>
                {session.isDemo ? <span className="demo-badge">Demo</span> : null}
              </Link>
            </li>
          ))}</ol>
        ) : <p>No sessions on this date.</p>}
      </section>
    </div>
  );
}
