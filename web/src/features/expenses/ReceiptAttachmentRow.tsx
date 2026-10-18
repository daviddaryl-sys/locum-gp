"use client";

import { useEffect, useId, useRef, useState } from "react";
import type React from "react";

const ACTION_WIDTH = 78;
const CLICK_POSITION_SLOP = 2;
const MAX_OVERSWIPE = 28;
const RELEASE_CLICK_GUARD_MS = 300;
const SWIPE_GESTURE_THRESHOLD = 8;
const OPEN_THRESHOLD = 48;
const REMOVE_STRETCH_DISTANCE = 96;

type DragState = {
  gesture: "undecided" | "horizontal" | "vertical";
  pointerId: number;
  startX: number;
  startY: number;
  startedOpen: boolean;
  moved: boolean;
};

type ReleaseClickGuard = {
  expiresAt: number;
  x: number;
  y: number;
};

function capturePointer(element: HTMLDivElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can fail if the browser has already ended the pointer.
  }
}

function releasePointer(element: HTMLDivElement, pointerId: number) {
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // Releasing an already-ended or uncaptured pointer is harmless.
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function resistedOverswipe(distance: number) {
  if (distance <= 0) return 0;
  return MAX_OVERSWIPE * (1 - Math.exp(-distance / MAX_OVERSWIPE));
}

function roundMotionValue(value: number) {
  return Number(value.toFixed(3));
}

function visualProgress(value: number) {
  return roundMotionValue(Math.pow(clamp01(value), 1.4));
}

export type ReceiptAttachmentRowProps = {
  busy: boolean;
  canChange: boolean;
  canRemove: boolean;
  filename: string | null;
  focusTargetRef: React.Ref<HTMLButtonElement>;
  hasReceipt: boolean;
  removing: boolean;
  onChange: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onView: () => void;
};

export function ReceiptAttachmentRow({
  busy,
  canChange,
  canRemove,
  filename,
  focusTargetRef,
  hasReceipt,
  removing,
  onChange,
  onRemove,
  onUndo,
  onView,
}: ReceiptAttachmentRowProps): React.JSX.Element {
  const actionCount = 1 + Number(canChange) + Number(canRemove);
  const trayWidth = ACTION_WIDTH * actionCount;
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const firstTrayAction = useRef<HTMLButtonElement>(null);
  const focusFirstTrayAction = useRef(false);
  const options = useRef<HTMLButtonElement>(null);
  const releaseClickGuard = useRef<ReleaseClickGuard | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trayId = useId();
  const rawReveal = dragging ? Math.max(0, -dragOffset) : open ? trayWidth : 0;
  const overswipeDistance = dragging ? Math.max(0, rawReveal - trayWidth) : 0;
  const resistedDistance = resistedOverswipe(overswipeDistance);
  const offset = dragging
    ? -Math.min(rawReveal, trayWidth) - resistedDistance
    : open ? -trayWidth : 0;
  const revealProgress = roundMotionValue(clamp01(rawReveal / trayWidth));
  const removeStretch = roundMotionValue(clamp01(overswipeDistance / REMOVE_STRETCH_DISTANCE));

  function actionStyle(indexFromLeft: number): React.CSSProperties {
    const laneFromRight = actionCount - indexFromLeft - 1;
    const revealedInLane = Math.min(rawReveal, trayWidth) - ACTION_WIDTH * laneFromRight;
    const progress = visualProgress(revealedInLane / ACTION_WIDTH);
    return { "--expense-receipt-action-progress": progress } as React.CSSProperties;
  }

  function closeTray() {
    if (drag.current && root.current) releasePointer(root.current, drag.current.pointerId);
    drag.current = null;
    setDragging(false);
    setDragOffset(0);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    if (focusFirstTrayAction.current) {
      focusFirstTrayAction.current = false;
      firstTrayAction.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeTray();
      options.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (root.current?.contains(event.target as Node)) return;
      if (drag.current) return;
      closeTray();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (busy || removing || !hasReceipt) return;
    if (drag.current) return;
    releaseClickGuard.current = null;
    drag.current = {
      gesture: "undecided",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedOpen: open,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const horizontalMovement = event.clientX - currentDrag.startX;
    const verticalMovement = event.clientY - currentDrag.startY;
    const horizontalDistance = Math.abs(horizontalMovement);
    const verticalDistance = Math.abs(verticalMovement);

    if (currentDrag.gesture === "undecided") {
      if (Math.max(horizontalDistance, verticalDistance) < SWIPE_GESTURE_THRESHOLD) return;
      currentDrag.gesture = horizontalDistance > verticalDistance ? "horizontal" : "vertical";
      currentDrag.moved = true;
      capturePointer(event.currentTarget, currentDrag.pointerId);
    }
    if (currentDrag.gesture === "vertical") return;

    const startOffset = currentDrag.startedOpen ? -trayWidth : 0;
    setDragging(true);
    setDragOffset(Math.min(0, startOffset + horizontalMovement));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const horizontalMovement = event.clientX - currentDrag.startX;
    const nextOpen = currentDrag.gesture === "horizontal"
      ? currentDrag.startedOpen ? horizontalMovement <= OPEN_THRESHOLD : horizontalMovement <= -OPEN_THRESHOLD
      : currentDrag.startedOpen;

    if (currentDrag.moved) {
      releaseClickGuard.current = {
        expiresAt: Date.now() + RELEASE_CLICK_GUARD_MS,
        x: event.clientX,
        y: event.clientY,
      };
    }

    releasePointer(event.currentTarget, currentDrag.pointerId);
    drag.current = null;
    setDragging(false);
    setDragOffset(0);
    setOpen(nextOpen);
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    releaseClickGuard.current = null;
    const startedOpen = currentDrag.startedOpen;
    releasePointer(event.currentTarget, currentDrag.pointerId);
    drag.current = null;
    setDragging(false);
    setDragOffset(0);
    setOpen(startedOpen);
  }

  function onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (drag.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const guard = releaseClickGuard.current;
    if (!guard) return;
    if (Date.now() > guard.expiresAt) {
      releaseClickGuard.current = null;
      return;
    }
    if (
      Math.abs(event.clientX - guard.x) > CLICK_POSITION_SLOP ||
      Math.abs(event.clientY - guard.y) > CLICK_POSITION_SLOP
    ) return;
    releaseClickGuard.current = null;
    event.preventDefault();
    event.stopPropagation();
  }

  function toggleTray(event: React.MouseEvent<HTMLButtonElement>) {
    if (open) {
      closeTray();
      return;
    }
    focusFirstTrayAction.current = event.detail === 0;
    setOpen(true);
  }

  if (removing) {
    return <div className="expense-receipt-swipe expense-receipt-swipe--removing" data-testid="receipt-attachment-row">
      <p className="expense-receipt-swipe__message">Receipt will be removed when you save.</p>
      <button className="expense-receipt-swipe__fallback-action" disabled={busy} onClick={onUndo} ref={focusTargetRef} type="button">Undo</button>
    </div>;
  }

  if (!hasReceipt) {
    return <div className="expense-receipt-swipe expense-receipt-swipe--empty" data-testid="receipt-attachment-row">
      <p className="expense-receipt-swipe__message">No receipt added</p>
      <button className="expense-receipt-swipe__fallback-action" disabled={busy || !canChange} onClick={onChange} ref={focusTargetRef} type="button">Add receipt</button>
    </div>;
  }

  return <div
    className="expense-receipt-swipe"
    data-testid="receipt-attachment-row"
    onClickCapture={onClickCapture}
    onPointerCancel={onPointerCancel}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    ref={root}
    style={{
      "--expense-receipt-overswipe": `${roundMotionValue(resistedDistance)}px`,
      "--expense-receipt-remove-stretch": removeStretch,
      "--expense-receipt-reveal": revealProgress,
    } as React.CSSProperties}
  >
    <div
      aria-hidden={open ? undefined : true}
      className="expense-receipt-swipe__tray"
      data-revealed={dragging || open ? "true" : "false"}
      id={trayId}
      style={{ "--expense-receipt-swipe-action-count": actionCount } as React.CSSProperties}
    >
      <button className="expense-receipt-swipe__action expense-receipt-swipe__action--view" disabled={busy} onClick={onView} ref={firstTrayAction} style={actionStyle(0)} tabIndex={open ? 0 : -1} type="button">
        <span aria-hidden="true" className="expense-receipt-swipe__action-icon">↗</span>
        <span className="expense-receipt-swipe__action-label">View</span>
      </button>
      {canChange ? <button className="expense-receipt-swipe__action expense-receipt-swipe__action--change" disabled={busy} onClick={onChange} style={actionStyle(1)} tabIndex={open ? 0 : -1} type="button">
        <span aria-hidden="true" className="expense-receipt-swipe__action-icon">↻</span>
        <span className="expense-receipt-swipe__action-label">Change</span>
      </button> : null}
      {canRemove ? <button className="expense-receipt-swipe__action expense-receipt-swipe__action--danger" disabled={busy} onClick={onRemove} style={actionStyle(1 + Number(canChange))} tabIndex={open ? 0 : -1} type="button">
        <span aria-hidden="true" className="expense-receipt-swipe__action-icon">⌫</span>
        <span className="expense-receipt-swipe__action-label">Remove</span>
      </button> : null}
    </div>
    <div
      className="expense-receipt-swipe__surface"
      data-dragging={dragging ? "true" : "false"}
      style={{
        "--expense-receipt-swipe-offset": `${offset}px`,
        "--expense-receipt-swipe-tray-width": `${trayWidth}px`,
      } as React.CSSProperties}
    >
      <button aria-label={`View receipt, Receipt attached${filename ? `, ${filename}` : ""}`} className="expense-receipt-swipe__summary" disabled={busy} onClick={onView} ref={focusTargetRef} type="button">
        <span className="expense-receipt-swipe__label">Receipt attached</span>
        {filename ? <span className="expense-receipt-swipe__filename">{filename}</span> : null}
        <span className="expense-receipt-swipe__hint">Swipe left for options</span>
      </button>
      <button aria-controls={trayId} aria-expanded={open} aria-label="Receipt options" className="expense-receipt-swipe__options" disabled={busy} onClick={toggleTray} ref={options} type="button">
        <span aria-hidden="true">•••</span>
      </button>
    </div>
  </div>;
}
