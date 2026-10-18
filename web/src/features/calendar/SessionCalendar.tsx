"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildMonthGrid,
  calendarDateLabel,
  calendarStatusLabel,
  calendarTimeLabel,
  groupCalendarSessions,
  londonDateKey,
  moveMonth,
  practiceColourIndex,
  type CalendarMonth,
  type CalendarSession,
} from "./calendarModel";
import { DateSessionPopup } from "./DateSessionPopup";
import { MoveSessionDialog } from "./MoveSessionDialog";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const holdDelay = 350;
const preactivationTolerance = 8;
const compatibilityClickWindow = 500;
const dragEdgeZone = 96;
const dragScrollStep = 48;
const dragScrollInterval = 80;
const successNoticeDuration = 2500;

function dragDirectionAt(clientY: number) {
  if (clientY < dragEdgeZone) return -1;
  if (clientY > window.innerHeight - dragEdgeZone) return 1;
  return 0;
}

function calendarDateAtPoint(
  clientX: number,
  clientY: number,
  visibleDates: string[],
) {
  const element = document.elementFromPoint(clientX, clientY);
  const dateButton = element?.closest<HTMLElement>("[data-calendar-date]")
    ?? element?.closest("td")?.querySelector<HTMLElement>("[data-calendar-date]");
  const dateKey = dateButton?.dataset.calendarDate;
  return dateKey && visibleDates.includes(dateKey) ? dateKey : null;
}

type PointerPress = {
  source: HTMLElement;
  captureOwner: HTMLElement;
  pointerId: number;
  session: CalendarSession;
  startX: number;
  startY: number;
};

type TouchPress = {
  source: HTMLElement;
  session: CalendarSession;
  startX: number;
  startY: number;
  touchId: number;
};

type PendingMove = {
  session: CalendarSession;
  sourceDate: string;
  targetDate: string;
};

function monthForDate(dateKey: string): CalendarMonth {
  const [year, month] = dateKey.split("-").map(Number);
  return { month, year };
}

function dateKeyInMonth(month: CalendarMonth, day: number) {
  const finalDay = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return new Date(Date.UTC(month.year, month.month - 1, Math.min(day, finalDay)))
    .toISOString()
    .slice(0, 10);
}

function monthLabel(month: CalendarMonth) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(month.year, month.month - 1, 1)));
}

export function SessionCalendar({
  initialDate,
  onMoveSession,
  sessions,
}: {
  initialDate?: string;
  onMoveSession?: (sessionId: string, targetDate: string) => Promise<void>;
  sessions: CalendarSession[];
}) {
  const initialDateKey = initialDate ?? londonDateKey(new Date().toISOString());
  const [month, setMonth] = useState(() => monthForDate(initialDateKey));
  const [selectedDate, setSelectedDate] = useState(initialDateKey);
  const [popupDate, setPopupDate] = useState<string | null>(null);
  const [pressed, setPressed] = useState<PointerPress | TouchPress | null>(null);
  const [dragging, setDragging] = useState<CalendarSession | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveSuccess, setMoveSuccess] = useState(false);
  const calendarRef = useRef<HTMLElement>(null);
  const fallbackFocusRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedRef = useRef<PointerPress | null>(null);
  const touchPressRef = useRef<TouchPress | null>(null);
  const draggingRef = useRef<CalendarSession | null>(null);
  const targetDateRef = useRef<string | null>(null);
  const suppressClickRef = useRef<HTMLElement | null>(null);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchAutoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchAutoScrollDirectionRef = useRef(0);
  const touchAutoScrollPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grouped = useMemo(() => groupCalendarSessions(sessions), [sessions]);
  const days = useMemo(() => buildMonthGrid(month), [month]);
  const visibleDates = useMemo(() => days.map((day) => day.dateKey), [days]);
  const selectedSessions = grouped.get(selectedDate) ?? [];

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const clearSuccessTimer = () => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const clearMoveSuccess = () => {
    clearSuccessTimer();
    setMoveSuccess(false);
  };

  const showMoveSuccess = () => {
    clearSuccessTimer();
    setMoveSuccess(true);
    successTimerRef.current = setTimeout(() => {
      setMoveSuccess(false);
      successTimerRef.current = null;
    }, successNoticeDuration);
  };

  const clearClickSuppression = () => {
    if (suppressClickTimerRef.current !== null) {
      clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
    suppressClickRef.current = null;
  };

  const suppressCompatibilityClick = (source: HTMLElement) => {
    clearClickSuppression();
    suppressClickRef.current = source;
    suppressClickTimerRef.current = setTimeout(() => {
      suppressClickRef.current = null;
      suppressClickTimerRef.current = null;
    }, compatibilityClickWindow);
  };

  const clearTouchAutoScroll = () => {
    if (touchAutoScrollTimerRef.current !== null) {
      clearInterval(touchAutoScrollTimerRef.current);
      touchAutoScrollTimerRef.current = null;
    }
    touchAutoScrollDirectionRef.current = 0;
    touchAutoScrollPositionRef.current = null;
  };

  const releasePointer = (press: PointerPress | null) => {
    if (!press) return;
    try {
      if (press.captureOwner.hasPointerCapture?.(press.pointerId)) {
        press.captureOwner.releasePointerCapture?.(press.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
  };

  const cancelPointerInteraction = () => {
    clearHoldTimer();
    releasePointer(pressedRef.current);
    pressedRef.current = null;
    setPressed(null);
    draggingRef.current = null;
    setDragging(null);
    targetDateRef.current = null;
    setTargetDate(null);
  };

  const cancelTouchInteraction = (suppressClick = false) => {
    const activePress = touchPressRef.current;
    if (suppressClick && draggingRef.current && activePress) {
      suppressCompatibilityClick(activePress.source);
    }
    clearHoldTimer();
    clearTouchAutoScroll();
    touchPressRef.current = null;
    setPressed(null);
    draggingRef.current = null;
    setDragging(null);
    targetDateRef.current = null;
    setTargetDate(null);
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape"
        && (pressedRef.current || touchPressRef.current || draggingRef.current)
      ) {
        event.preventDefault();
        if (draggingRef.current && pressedRef.current) {
          suppressCompatibilityClick(pressedRef.current.source);
        }
        cancelTouchInteraction(true);
        cancelPointerInteraction();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHoldTimer();
      clearClickSuppression();
      clearTouchAutoScroll();
      clearSuccessTimer();
      releasePointer(pressedRef.current);
    };
  }, []);

  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;

    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const findTouch = (touches: TouchList, touchId: number) => Array.from(touches)
      .find((touch) => touch.identifier === touchId);
    const resolveTargetDate = (clientX: number, clientY: number) =>
      calendarDateAtPoint(clientX, clientY, visibleDates);
    const updateTouchTarget = (clientX: number, clientY: number) => {
      const nextTarget = resolveTargetDate(clientX, clientY);
      targetDateRef.current = nextTarget;
      setTargetDate(nextTarget);
    };
    const updateTouchAutoScroll = (clientX: number, clientY: number) => {
      const direction = dragDirectionAt(clientY);
      if (direction === 0) {
        clearTouchAutoScroll();
        updateTouchTarget(clientX, clientY);
        return;
      }

      touchAutoScrollPositionRef.current = { clientX, clientY };
      if (
        touchAutoScrollTimerRef.current !== null
        && touchAutoScrollDirectionRef.current === direction
      ) return;

      clearTouchAutoScroll();
      touchAutoScrollDirectionRef.current = direction;
      touchAutoScrollPositionRef.current = { clientX, clientY };
      const scrollAndRetarget = () => {
        const position = touchAutoScrollPositionRef.current;
        if (!draggingRef.current || !position) {
          clearTouchAutoScroll();
          return;
        }
        window.scrollBy({ behavior: "auto", top: direction * dragScrollStep });
        updateTouchTarget(position.clientX, position.clientY);
      };
      scrollAndRetarget();
      touchAutoScrollTimerRef.current = setInterval(
        scrollAndRetarget,
        dragScrollInterval,
      );
    };
    const openTouchMove = (press: TouchPress, nextTarget: string | null) => {
      if (draggingRef.current) suppressCompatibilityClick(press.source);
      cancelTouchInteraction();
      if (!nextTarget) return;
      const sourceDate = londonDateKey(press.session.startsAt);
      if (nextTarget !== sourceDate) {
        setPendingMove({ session: press.session, sourceDate, targetDate: nextTarget });
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      clearClickSuppression();
      if (event.touches.length !== 1) {
        cancelTouchInteraction(true);
        return;
      }
      if (!onMoveSession) return;
      const target = event.target instanceof Element ? event.target : null;
      const source = target?.closest<HTMLElement>(
        ".session-calendar__marker[data-session-id], .session-calendar__agenda-card[data-session-id]",
      );
      if (!source || !calendar.contains(source)) return;
      const interactiveControl = target?.closest<HTMLElement>(
        "button, input, select, textarea",
      );
      if (interactiveControl && interactiveControl !== source) return;
      const sessionId = source.dataset.sessionId;
      const session = sessionId ? sessionById.get(sessionId) : undefined;
      if (!session || session.status === "invoiced") return;
      const touch = event.touches[0];
      if (!touch) return;

      clearMoveSuccess();
      cancelPointerInteraction();
      cancelTouchInteraction();
      const nextPress: TouchPress = {
        source,
        session,
        startX: touch.clientX,
        startY: touch.clientY,
        touchId: touch.identifier,
      };
      touchPressRef.current = nextPress;
      setPressed(nextPress);
      holdTimerRef.current = setTimeout(() => {
        if (touchPressRef.current !== nextPress) return;
        draggingRef.current = session;
        setDragging(session);
        holdTimerRef.current = null;
      }, holdDelay);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancelTouchInteraction(true);
        return;
      }
      const activePress = touchPressRef.current;
      if (!activePress) return;
      const touch = findTouch(event.touches, activePress.touchId);
      if (!touch) return;
      if (!draggingRef.current) {
        const distance = Math.hypot(
          touch.clientX - activePress.startX,
          touch.clientY - activePress.startY,
        );
        if (distance > preactivationTolerance) cancelTouchInteraction();
        return;
      }

      event.preventDefault();
      updateTouchAutoScroll(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const activePress = touchPressRef.current;
      if (!activePress || !findTouch(event.changedTouches, activePress.touchId)) return;
      const completedTarget = draggingRef.current ? targetDateRef.current : null;
      openTouchMove(activePress, completedTarget);
    };

    const handleTouchCancel = (event: TouchEvent) => {
      const activePress = touchPressRef.current;
      if (!activePress || !findTouch(event.changedTouches, activePress.touchId)) return;
      if (!draggingRef.current) clearClickSuppression();
      cancelTouchInteraction(true);
    };

    calendar.addEventListener("touchstart", handleTouchStart);
    calendar.addEventListener("touchmove", handleTouchMove, { passive: false });
    calendar.addEventListener("touchend", handleTouchEnd);
    calendar.addEventListener("touchcancel", handleTouchCancel);
    return () => {
      calendar.removeEventListener("touchstart", handleTouchStart);
      calendar.removeEventListener("touchmove", handleTouchMove);
      calendar.removeEventListener("touchend", handleTouchEnd);
      calendar.removeEventListener("touchcancel", handleTouchCancel);
    };
  });

  const changeMonth = (delta: -1 | 1) => {
    const next = moveMonth(month, delta);
    const selectedDay = Number(selectedDate.slice(-2));
    setMonth(next);
    setSelectedDate(dateKeyInMonth(next, selectedDay));
  };

  const openDatePopup = (dateKey: string) => {
    setSelectedDate(dateKey);
    setPopupDate(dateKey);
  };

  const startPress = (
    event: ReactPointerEvent<HTMLElement>,
    source: HTMLElement,
    session: CalendarSession,
  ) => {
    if (event.pointerType === "touch") return;
    clearClickSuppression();
    if (!event.isPrimary || event.button !== 0) return;
    if (!onMoveSession || session.status === "invoiced") return;
    const interactiveControl = (event.target as Element)
      .closest<HTMLElement>("button, input, select, textarea");
    if (interactiveControl && interactiveControl !== source) return;

    clearMoveSuccess();
    cancelPointerInteraction();
    const captureOwner = event.target instanceof HTMLElement
      ? event.target
      : event.currentTarget;
    const nextPress: PointerPress = {
      source,
      captureOwner,
      pointerId: event.pointerId,
      session,
      startX: event.clientX,
      startY: event.clientY,
    };
    pressedRef.current = nextPress;
    setPressed(nextPress);
    try {
      nextPress.captureOwner.setPointerCapture?.(nextPress.pointerId);
    } catch {
      // Pointer capture can fail if the pointer is no longer active.
    }
    holdTimerRef.current = setTimeout(() => {
      if (pressedRef.current !== nextPress) return;
      draggingRef.current = session;
      setDragging(session);
      holdTimerRef.current = null;
    }, holdDelay);
  };

  const movePress = (event: ReactPointerEvent<HTMLElement>) => {
    const activePress = pressedRef.current;
    if (!activePress || activePress.pointerId !== event.pointerId) return;
    if (!dragging) {
      const distance = Math.hypot(
        event.clientX - activePress.startX,
        event.clientY - activePress.startY,
      );
      if (distance > preactivationTolerance) cancelPointerInteraction();
      return;
    }

    event.preventDefault();
    const resolvedTarget = calendarDateAtPoint(
      event.clientX,
      event.clientY,
      visibleDates,
    );
    targetDateRef.current = resolvedTarget;
    setTargetDate(resolvedTarget);
  };

  const finishPress = (event: ReactPointerEvent<HTMLElement>) => {
    const activePress = pressedRef.current;
    if (!activePress || activePress.pointerId !== event.pointerId) return;
    const completedDrag = dragging;
    const completedTarget = targetDate;
    if (completedDrag) suppressCompatibilityClick(activePress.source);
    cancelPointerInteraction();
    if (!completedDrag || !completedTarget) return;

    const sourceDate = londonDateKey(completedDrag.startsAt);
    if (completedTarget !== sourceDate) {
      setPendingMove({
        session: completedDrag,
        sourceDate,
        targetDate: completedTarget,
      });
    }
  };

  const handleSourceClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (suppressClickRef.current !== event.currentTarget) return;
    if (event.detail === 0) {
      clearClickSuppression();
      return;
    }
    const nestedButton = (event.target as Element).closest("button");
    if (nestedButton && nestedButton !== event.currentTarget) {
      clearClickSuppression();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearClickSuppression();
  };

  const openKeyboardMove = (session: CalendarSession) => {
    if (!onMoveSession || session.status === "invoiced") return;
    clearMoveSuccess();
    const sourceDate = londonDateKey(session.startsAt);
    setPendingMove({ session, sourceDate, targetDate: sourceDate });
  };

  return (
    <section aria-label="Session calendar" className="session-calendar" ref={calendarRef}>
      {moveSuccess ? (
        <p aria-live="polite" className="session-calendar__move-success" role="status">
          Session moved successfully.
        </p>
      ) : null}
      {dragging ? (
        <p className="session-calendar__drag-guidance" role="status">
          Move session — drag to another date.
        </p>
      ) : null}
      <div className="session-calendar__header">
        <button aria-label="Previous month" onClick={() => changeMonth(-1)} ref={fallbackFocusRef} type="button">Previous</button>
        <h2>{monthLabel(month)}</h2>
        <button aria-label="Next month" onClick={() => changeMonth(1)} type="button">Next</button>
      </div>
      <div className="session-calendar__grid-wrap">
        <table>
          <thead><tr>{weekdays.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>{Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>{days.slice(week * 7, week * 7 + 7).map((day) => {
              const daySessions = grouped.get(day.dateKey) ?? [];
              const count = daySessions.length;
              const label = `${calendarDateLabel(day.dateKey)}, ${count} session${count === 1 ? "" : "s"}`;
              return <td key={day.dateKey} data-in-month={day.inMonth}>
                <button
                  aria-label={label}
                  aria-pressed={day.dateKey === selectedDate}
                  className="session-calendar__date-button"
                  data-calendar-date={day.dateKey}
                  data-drop-target={dragging && targetDate === day.dateKey ? "true" : undefined}
                  onClick={() => setSelectedDate(day.dateKey)}
                  onDoubleClick={() => openDatePopup(day.dateKey)}
                  type="button"
                >
                  <span>{day.day}</span>
                </button>
                {daySessions.length ? (
                  <div
                    aria-label={`Sessions on ${calendarDateLabel(day.dateKey)}`}
                    className="session-calendar__markers"
                    role="group"
                  >
                    {daySessions.map((session) => {
                      const invoiced = session.status === "invoiced";
                      const markerLabel = [
                        session.practiceName,
                        `${calendarTimeLabel(session.startsAt)} to ${calendarTimeLabel(session.endsAt)}`,
                        `${calendarStatusLabel(session.status)} session`,
                        invoiced ? "move unavailable: invoiced" : null,
                      ].filter(Boolean).join(", ");
                      return (
                        <button
                          aria-grabbed={dragging?.id === session.id}
                          aria-disabled={invoiced ? "true" : undefined}
                          aria-label={markerLabel}
                          className="session-calendar__marker"
                          data-dragging={dragging?.id === session.id ? "true" : undefined}
                          data-practice-colour={practiceColourIndex(session.practiceName)}
                          data-pressed={pressed?.session.id === session.id ? "true" : undefined}
                          data-session-id={session.id}
                          key={session.id}
                          onClickCapture={handleSourceClickCapture}
                          onClick={() => setSelectedDate(day.dateKey)}
                          onPointerCancel={(event) => {
                            if (event.pointerType === "touch") return;
                            clearClickSuppression();
                            cancelPointerInteraction();
                          }}
                          onPointerDown={(event) => startPress(event, event.currentTarget, session)}
                          onPointerMove={movePress}
                          onPointerUp={finishPress}
                          type="button"
                        >
                          <span aria-hidden="true">
                            {invoiced ? "🔒" : session.practiceName.trim().charAt(0).toUpperCase()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
      <section aria-labelledby="session-calendar-selected-date" className="session-calendar__agenda">
        <h2 id="session-calendar-selected-date">{calendarDateLabel(selectedDate)}</h2>
        <button
          className="secondary-action session-calendar__date-action"
          onClick={() => openDatePopup(selectedDate)}
          type="button"
        >
          Add or edit sessions
        </button>
        {selectedSessions.length ? <ol>{selectedSessions.map((session) => (
          <li
            aria-grabbed={dragging?.id === session.id}
            className="session-calendar__agenda-card"
            data-dragging={dragging?.id === session.id ? "true" : undefined}
            data-pressed={pressed?.session.id === session.id ? "true" : undefined}
            data-session-id={session.id}
            key={session.id}
            onClickCapture={handleSourceClickCapture}
            onPointerCancel={(event) => {
              if (event.pointerType === "touch") return;
              clearClickSuppression();
              cancelPointerInteraction();
            }}
            onPointerDown={(event) => startPress(event, event.currentTarget, session)}
            onPointerMove={movePress}
            onPointerUp={finishPress}
          >
            <Link
              className="session-calendar__agenda-link"
              draggable={false}
              href={`/sessions/${session.id}`}
            >
              <span className="session-calendar__agenda-practice">{session.practiceName}</span>
              <span>{calendarTimeLabel(session.startsAt)}–{calendarTimeLabel(session.endsAt)}</span>
              <span className="session-calendar__status-marker" data-status={session.status}>{calendarStatusLabel(session.status)}</span>
              {session.isDemo ? <span className="demo-badge">Demo</span> : null}
            </Link>
            {onMoveSession ? (
              <button
                aria-label={session.status === "invoiced" ? "Move unavailable: invoiced" : "Move session"}
                className="session-calendar__move-action"
                disabled={session.status === "invoiced"}
                onClick={() => openKeyboardMove(session)}
                type="button"
              >
                Move session
              </button>
            ) : null}
          </li>
        ))}</ol> : <p>No sessions on this date.</p>}
      </section>
      {popupDate ? (
        <DateSessionPopup
          dateKey={popupDate}
          onClose={() => setPopupDate(null)}
          sessions={grouped.get(popupDate) ?? []}
        />
      ) : null}
      {pendingMove && onMoveSession ? (
        <MoveSessionDialog
          fallbackFocusRef={fallbackFocusRef}
          onCancel={() => setPendingMove(null)}
          onConfirm={async (sessionId, nextTargetDate) => {
            if (nextTargetDate === pendingMove.sourceDate) return;
            await onMoveSession(sessionId, nextTargetDate);
            if (!mountedRef.current) return;
            setPendingMove(null);
            showMoveSuccess();
          }}
          practiceName={pendingMove.session.practiceName}
          sessionId={pendingMove.session.id}
          sourceDate={pendingMove.sourceDate}
          targetDate={pendingMove.targetDate}
          visibleDates={visibleDates}
        />
      ) : null}
    </section>
  );
}
