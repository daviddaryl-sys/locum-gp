"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { calendarDateLabel } from "./calendarModel";

type MoveSessionDialogProps = {
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: (sessionId: string, targetDate: string) => Promise<void>;
  practiceName: string;
  sessionId: string;
  sourceDate: string;
  targetDate: string;
  visibleDates: string[];
};

const focusableSelector = "button:not([disabled]), select:not([disabled])";

function focusConnected(target: HTMLElement | null | undefined) {
  if (!target?.isConnected) return false;
  target.focus();
  return document.activeElement === target;
}

export function MoveSessionDialog({
  fallbackFocusRef,
  onCancel,
  onConfirm,
  practiceName,
  sessionId,
  sourceDate,
  targetDate,
  visibleDates,
}: MoveSessionDialogProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [selectedDate, setSelectedDate] = useState(targetDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const fallbackFocus = fallbackFocusRef?.current;
    cancelRef.current?.focus();
    return () => {
      if (!focusConnected(previousFocus)) {
        focusConnected(fallbackFocus);
      }
    };
  }, [fallbackFocusRef]);

  useEffect(() => {
    if (saving) dialogRef.current?.focus();
  }, [saving]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onConfirm(sessionId, selectedDate);
    } catch {
      setError("Session could not be moved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="session-move-dialog__backdrop">
      <section
        aria-labelledby={headingId}
        aria-modal="true"
        className="session-move-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id={headingId}>Move session</h2>
        <p>{practiceName}</p>
        <dl>
          <dt>From</dt>
          <dd>{calendarDateLabel(sourceDate)}</dd>
          <dt>To</dt>
          <dd>{calendarDateLabel(selectedDate)}</dd>
        </dl>
        <form onSubmit={handleSubmit}>
          <label htmlFor={`${headingId}-target-date`}>Move to date</label>
          <select
            disabled={saving}
            id={`${headingId}-target-date`}
            onChange={(event) => setSelectedDate(event.target.value)}
            value={selectedDate}
          >
            {visibleDates.map((date) => (
              <option key={date} value={date}>{calendarDateLabel(date)}</option>
            ))}
          </select>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={saving} onClick={onCancel} ref={cancelRef} type="button">
            Cancel
          </button>
          <button aria-busy={saving || undefined} disabled={saving} type="submit">
            Move session
          </button>
        </form>
      </section>
    </div>
  );
}
