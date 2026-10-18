import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import { SessionCalendar } from "../SessionCalendar";

const globalStyles = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const normalizedGlobalStyles = globalStyles.replace(/\s+/g, " ");

function ruleFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalizedGlobalStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`),
  );
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1].replace(/\\s+/g, " ") ?? "";
}

class TestPointerEvent extends MouseEvent {
  isPrimary: boolean;
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const capturedPointers = new Map<number, HTMLElement>();
const originalSetPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "setPointerCapture",
);
const originalReleasePointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "releasePointerCapture",
);
const originalHasPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "hasPointerCapture",
);

beforeAll(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        return capturedPointers.get(pointerId) === this;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(pointerId: number) {
        if (capturedPointers.get(pointerId) === this) capturedPointers.delete(pointerId);
      },
    },
    setPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        capturedPointers.set(pointerId, this as HTMLElement);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  capturedPointers.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [name, descriptor] of [
    ["setPointerCapture", originalSetPointerCapture],
    ["releasePointerCapture", originalReleasePointerCapture],
    ["hasPointerCapture", originalHasPointerCapture],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

const sessions = [
  { id: "session-planned", practiceName: "Fictional Medical Centre", startsAt: "2026-08-11T09:00:00.000Z", endsAt: "2026-08-11T15:00:00.000Z", status: "planned" as const, isDemo: false },
  { id: "session-cancelled", practiceName: "Example Health Practice", startsAt: "2026-08-21T08:00:00.000Z", endsAt: "2026-08-21T12:00:00.000Z", status: "cancelled" as const, isDemo: true },
];

it("styles touch dragging, date targets, and the compact move dialog accessibly", () => {
  const agendaCard = ruleFor(".session-calendar__agenda-card");
  expect(agendaCard).toMatch(/touch-action:\s*pan-y\s*;/);
  expect(agendaCard).toMatch(/-webkit-touch-callout:\s*none\s*;/);
  expect(agendaCard).toMatch(/user-select:\s*none\s*;/);
  expect(agendaCard).toMatch(
    /transition:\s*box-shadow\s+(?:1[5-9]\d|2[0-5]\d)ms\s+ease-out,\s*transform\s+(?:1[5-9]\d|2[0-5]\d)ms\s+ease-out\s*;/,
  );

  const draggingCard = ruleFor('.session-calendar__agenda-card[data-dragging="true"]');
  expect(draggingCard).toMatch(/box-shadow:\s*[^;]+;/);
  expect(draggingCard).toMatch(/outline:\s*[^;]+;/);
  expect(draggingCard).toMatch(/transform:\s*translateY\(\s*-\d+px\s*\)\s*;/);
  expect(draggingCard).not.toMatch(/touch-action:\s*none\s*;/);

  const dropTarget = ruleFor('.session-calendar td button[data-drop-target="true"]');
  expect(dropTarget).toMatch(/background:\s*[^;]+;/);
  expect(dropTarget).toMatch(/outline:\s*[^;]+;/);
  expect(dropTarget).toMatch(/box-shadow:\s*[^;]+;/);

  const moveAction = ruleFor(".session-calendar__move-action");
  expect(moveAction).toMatch(/min-height:\s*44px\s*;/);
  expect(moveAction).toMatch(/min-width:\s*44px\s*;/);
  expect(moveAction).toMatch(/border:\s*[^;]+var\(--color-border\)[^;]*;/);

  const dialogBackdrop = ruleFor(
    ".session-calendar > .session-move-dialog__backdrop",
  );
  expect(dialogBackdrop).toMatch(/position:\s*fixed\s*;/);
  expect(dialogBackdrop).toMatch(/inset:\s*0\s*;/);
  expect(dialogBackdrop).toMatch(/z-index:\s*[1-9]\d*\s*;/);
  expect(dialogBackdrop).toMatch(/background:\s*rgb\([^;]+;/);
  expect(dialogBackdrop).toMatch(/pointer-events:\s*auto\s*;/);
  expect(dialogBackdrop).toMatch(/overflow-y:\s*auto\s*;/);
  expect(dialogBackdrop).toMatch(/align-items:\s*safe center\s*;/);

  const dialog = ruleFor(
    ".session-calendar > .session-move-dialog__backdrop > .session-move-dialog",
  );
  expect(dialog).toMatch(/border:\s*[^;]+var\(--color-border\)[^;]*;/);
  expect(dialog).toMatch(/background:\s*var\(--color-surface\)\s*;/);
  expect(dialog).toMatch(/box-shadow:\s*[^;]+;/);
  expect(dialog).toMatch(/width:\s*min\(100%,\s*390px\)\s*;/);
  expect(dialog).toMatch(/max-height:\s*calc\(100vh\s*-\s*[^;]+;/);
  expect(dialog).toMatch(/max-height:\s*calc\(100dvh\s*-\s*[^;]+;/);
  expect(dialog).toMatch(/overflow-y:\s*auto\s*;/);

  const dialogHeading = ruleFor(".session-calendar .session-move-dialog h2");
  expect(dialogHeading).toMatch(
    /font-size:\s*var\(--font-section-title\)\s*;/,
  );
  expect(dialogHeading).not.toContain("var(--font-title)");

  expect(normalizedGlobalStyles).not.toContain(
    '.session-calendar > [role="dialog"]::before',
  );
  expect(normalizedGlobalStyles).not.toContain(
    '.session-calendar > [role="dialog"]::after',
  );

  const dialogControl = ruleFor(
    ".session-calendar .session-move-dialog select, .session-calendar .session-move-dialog button",
  );
  expect(dialogControl).toMatch(/min-height:\s*44px\s*;/);
  expect(dialogControl).toMatch(/border-radius:\s*var\(--radius-md\)\s*;/);

  expect(normalizedGlobalStyles).toMatch(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.session-calendar__agenda-card\s*\{[^}]*transition:\s*none\s*;[^}]*\}\s*\.session-calendar__agenda-card\[data-dragging="true"\]\s*\{[^}]*transform:\s*none\s*;/,
  );
});

it("styles compact calendar markers with six accessible colour pairs and non-colour states", () => {
  const dateButton = ruleFor(".session-calendar__date-button");
  expect(dateButton).toMatch(/min-height:\s*(?:3[0-9]|4[0-4])px\s*;/);

  const markerRow = ruleFor(".session-calendar__markers");
  expect(markerRow).toMatch(/display:\s*flex\s*;/);
  expect(markerRow).toMatch(/flex-wrap:\s*wrap\s*;/);

  const marker = ruleFor(".session-calendar__marker");
  expect(marker).toMatch(/min-width:\s*(?:2[4-9]|3\d)px\s*;/);
  expect(marker).toMatch(/min-height:\s*(?:2[4-9]|3\d)px\s*;/);
  expect(marker).toMatch(/border:\s*[^;]+;/);
  expect(marker).toMatch(/cursor:\s*pointer\s*;/);
  expect(marker).toMatch(/touch-action:\s*pan-y\s*;/);
  expect(marker).toMatch(/-webkit-touch-callout:\s*none\s*;/);
  expect(marker).toMatch(/user-select:\s*none\s*;/);
  expect(marker).toMatch(/transition:\s*[^;]*box-shadow[^;]*transform[^;]*;/);
  expect(marker).not.toMatch(/touch-action:\s*none\s*;/);

  for (let colour = 0; colour < 6; colour += 1) {
    const colourRule = ruleFor(
      `.session-calendar__marker[data-practice-colour="${colour}"]`,
    );
    expect(colourRule).toMatch(/color:\s*[^;]+;/);
    expect(colourRule).toMatch(/background:\s*#[0-9a-f]{6}\s*;/i);
  }

  expect(ruleFor(".session-calendar__marker:focus-visible")).toMatch(
    /outline:\s*[^;]+;/,
  );
  const invoicedMarker = ruleFor(
    '.session-calendar__marker[aria-disabled="true"]',
  );
  expect(invoicedMarker).toMatch(/border-style:\s*double\s*;/);
  expect(invoicedMarker).toMatch(/cursor:\s*not-allowed\s*;/);
  expect(ruleFor('.session-calendar__marker[data-pressed="true"]')).toMatch(
    /outline:\s*[^;]+;/,
  );
  const draggingMarker = ruleFor('.session-calendar__marker[data-dragging="true"]');
  expect(draggingMarker).toMatch(/outline:\s*[^;]+;/);
  expect(draggingMarker).toMatch(/box-shadow:\s*[^;]+;/);
  expect(draggingMarker).toMatch(/transform:\s*scale\(1\.1[4-8]\)\s*;/);
  expect(draggingMarker).toMatch(/z-index:\s*[1-9]\d*\s*;/);

  const guidance = ruleFor(".session-calendar__drag-guidance");
  expect(guidance).toMatch(/position:\s*fixed\s*;/);
  expect(guidance).toMatch(/top:\s*[^;]+;/);
  expect(guidance).toMatch(/left:\s*50%\s*;/);
  expect(guidance).toMatch(/width:\s*[^;]+;/);
  expect(guidance).toMatch(/max-width:\s*[^;]+;/);
  expect(guidance).toMatch(/transform:\s*translateX\(-50%\)\s*;/);
  expect(guidance).toMatch(/z-index:\s*[1-9]\d*\s*;/);
  expect(guidance).toMatch(/pointer-events:\s*none\s*;/);
  expect(guidance).toMatch(/border:\s*[^;]+;/);
  expect(guidance).toMatch(/box-shadow:\s*[^;]+;/);
  expect(guidance).toMatch(/font-weight:\s*700\s*;/);

  const moveSuccess = ruleFor(".session-calendar__move-success");
  expect(moveSuccess).toMatch(/width:\s*fit-content\s*;/);
  expect(moveSuccess).toMatch(/border:\s*[^;]+;/);
  expect(moveSuccess).toMatch(/border-radius:\s*var\(--radius-pill\)\s*;/);
  expect(moveSuccess).toMatch(/color:\s*#166534\s*;/);
  expect(moveSuccess).toMatch(/background:\s*#f0fdf4\s*;/);
  expect(moveSuccess).toMatch(/box-shadow:\s*[^;]+;/);
  expect(moveSuccess).toMatch(/font-weight:\s*700\s*;/);
  expect(moveSuccess).not.toMatch(/position:\s*fixed\s*;/);
  expect(moveSuccess).not.toMatch(/pointer-events:\s*none\s*;/);

  expect(normalizedGlobalStyles).toMatch(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.session-calendar__marker\s*\{[^}]*transition:\s*none\s*;[^}]*\}[\s\S]*?\.session-calendar__marker\[data-dragging="true"\]\s*\{[^}]*transform:\s*none\s*;/,
  );
});

const movableSessions = [
  { id: "session-planned", practiceName: "Fictional Planned Practice", startsAt: "2026-08-11T09:00:00.000Z", endsAt: "2026-08-11T15:00:00.000Z", status: "planned" as const, isDemo: false },
  { id: "session-completed", practiceName: "Fictional Completed Practice", startsAt: "2026-08-11T10:00:00.000Z", endsAt: "2026-08-11T16:00:00.000Z", status: "completed" as const, isDemo: false },
  { id: "session-cancelled", practiceName: "Fictional Cancelled Practice", startsAt: "2026-08-11T11:00:00.000Z", endsAt: "2026-08-11T17:00:00.000Z", status: "cancelled" as const, isDemo: false },
  { id: "session-invoiced", practiceName: "Fictional Invoiced Practice", startsAt: "2026-08-11T12:00:00.000Z", endsAt: "2026-08-11T18:00:00.000Z", status: "invoiced" as const, isDemo: false },
];

const markerSessions = [
  { id: "marker-planned", practiceName: "Fictional Medical Centre", startsAt: "2026-08-11T09:00:00.000Z", endsAt: "2026-08-11T15:00:00.000Z", status: "planned" as const, isDemo: false },
  { id: "marker-invoiced", practiceName: "Fictional Invoiced Practice", startsAt: "2026-08-11T12:00:00.000Z", endsAt: "2026-08-11T18:00:00.000Z", status: "invoiced" as const, isDemo: false },
];

function cardFor(practiceName: string) {
  const link = screen.getByRole("link", { name: new RegExp(practiceName) });
  const card = link.closest("li");
  if (!card) throw new Error(`Missing agenda card for ${practiceName}`);
  return card;
}

function markerFor(practiceName: string) {
  return screen.getByRole("button", {
    name: new RegExp(`${practiceName}, .* session`, "i"),
  });
}

function startPointer(
  card: HTMLElement,
  pointerId = 1,
  overrides: PointerEventInit = {},
) {
  fireEvent.pointerDown(card, {
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    isPrimary: true,
    pointerId,
    ...overrides,
  });
}

function activatePointer(card: HTMLElement, pointerId = 1) {
  startPointer(card, pointerId);
  act(() => vi.advanceTimersByTime(350));
}

function openPointerMoveDialog(pointerId = 1) {
  const marker = markerFor("Fictional Medical Centre");
  const target = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/,
  });
  activatePointer(marker, pointerId);
  setHitTarget(target);
  fireEvent.pointerMove(marker, { clientX: 80, clientY: 90, pointerId });
  fireEvent.pointerUp(marker, { clientX: 80, clientY: 90, pointerId });
  return screen.getByRole("dialog", { name: "Move session" });
}

async function confirmMoveDialog() {
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
  });
}

it("shows drag guidance only while the hold-activated drag is active", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  expect(
    screen.queryByText("Move session — drag to another date."),
  ).not.toBeInTheDocument();

  const marker = markerFor("Fictional Medical Centre");
  startPointer(marker, 1, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(350));

  expect(marker).toHaveAttribute("data-dragging", "true");
  const guidance = screen.getByText("Move session — drag to another date.");
  expect(guidance).toBeVisible();
  expect(guidance.nextElementSibling).toHaveClass("session-calendar__header");

  fireEvent.keyDown(document, { key: "Escape" });

  expect(
    screen.queryByText("Move session — drag to another date."),
  ).not.toBeInTheDocument();
});

function setHitTarget(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
}

function dispatchTouch(
  target: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  clientX: number,
  clientY: number,
) {
  const touch = { clientX, clientY, identifier: 7, target };
  return dispatchTouches(
    target,
    type,
    type === "touchend" || type === "touchcancel" ? [] : [touch],
    [touch],
  );
}

function dispatchTouches(
  target: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: Array<{ clientX: number; clientY: number; identifier: number; target: HTMLElement }>,
  changedTouches = touches,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: changedTouches },
    touches: { value: touches },
  });
  act(() => target.dispatchEvent(event));
  return event;
}

it("navigates months and opens the selected date agenda", async () => {
  const user = userEvent.setup();
  render(<SessionCalendar initialDate="2026-08-11" sessions={sessions} />);
  expect(screen.getByRole("heading", { name: "August 2026" })).toBeVisible();
  const selected = screen.getByRole("button", { name: /Tuesday 11 August 2026, 1 session/i });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: /Fictional Medical Centre/ })).toHaveAttribute("href", "/sessions/session-planned");
  await user.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByRole("heading", { name: "September 2026" })).toBeVisible();
  expect(screen.getByText("No sessions on this date.")).toBeVisible();
});

it("renders one accessible, stable practice-coloured marker per session", () => {
  const { rerender } = render(
    <SessionCalendar initialDate="2026-08-11" sessions={markerSessions} />,
  );
  const dateButton = screen.getByRole("button", {
    name: /Tuesday 11 August 2026, 2 sessions/i,
  });
  const dateCell = dateButton.closest("td");
  if (!dateCell) throw new Error("Missing date cell for 11 August");

  const markers = dateCell.querySelectorAll<HTMLButtonElement>(
    ".session-calendar__marker",
  );
  expect(markers).toHaveLength(2);
  expect(dateButton).not.toContainElement(markers[0]);
  expect(dateButton).not.toContainElement(markers[1]);
  expect(dateCell.querySelector(".session-calendar__count")).not.toBeInTheDocument();
  expect(markers[0]).toHaveAttribute("data-session-id", "marker-planned");
  expect(markers[1]).toHaveAttribute("data-session-id", "marker-invoiced");

  const colours = Array.from(markers, (marker) => marker.dataset.practiceColour);
  expect(colours).toEqual(colours.map(() => expect.stringMatching(/^[0-5]$/)));
  expect(new Set(colours)).toHaveLength(2);

  expect(
    within(dateCell).getByRole("button", {
      name: "Fictional Medical Centre, 10:00 to 16:00, Planned session",
    }),
  ).toBe(markers[0]);
  expect(
    within(dateCell).getByRole("button", {
      name: "Fictional Invoiced Practice, 13:00 to 19:00, Invoiced session, move unavailable: invoiced",
    }),
  ).toBe(markers[1]);

  rerender(
    <SessionCalendar initialDate="2026-08-11" sessions={[...markerSessions]} />,
  );
  const rerenderedDateCell = screen
    .getByRole("button", { name: /Tuesday 11 August 2026, 2 sessions/i })
    .closest("td");
  expect(
    Array.from(
      rerenderedDateCell?.querySelectorAll<HTMLElement>(".session-calendar__marker") ?? [],
      (marker) => marker.dataset.practiceColour,
    ),
  ).toEqual(colours);
});

it("selects a marker date without opening the move dialog", async () => {
  const user = userEvent.setup();
  render(
    <SessionCalendar
      initialDate="2026-08-12"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );
  const marker = screen.getByRole("button", {
    name: "Fictional Medical Centre, 10:00 to 16:00, Planned session",
  });

  await user.click(marker);

  expect(
    screen.getByRole("button", { name: /Tuesday 11 August 2026, 2 sessions/i }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("keeps an invoiced marker selectable without making it draggable", async () => {
  const user = userEvent.setup();
  render(
    <SessionCalendar
      initialDate="2026-08-12"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );
  const marker = screen.getByRole("button", {
    name: "Fictional Invoiced Practice, 13:00 to 19:00, Invoiced session, move unavailable: invoiced",
  });
  expect(marker).toHaveAttribute("aria-disabled", "true");
  expect(marker).not.toBeDisabled();

  await user.click(marker);

  expect(
    screen.getByRole("button", { name: /Tuesday 11 August 2026, 2 sessions/i }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it.each(["mouse", "pen"])(
  "opens the correct move dialog after holding and dragging a marker with %s",
  (pointerType) => {
    vi.useFakeTimers();
    const onMoveSession = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionCalendar
        initialDate="2026-08-11"
        onMoveSession={onMoveSession}
        sessions={markerSessions}
      />,
    );

    const marker = markerFor("Fictional Medical Centre");
    const target = screen.getByRole("button", {
      name: /Wednesday 12 August 2026, 0 sessions/i,
    });
    startPointer(marker, 1, { pointerType });
    act(() => vi.advanceTimersByTime(350));

    expect(marker).toHaveAttribute("data-dragging", "true");
    setHitTarget(target);
    fireEvent.pointerMove(marker, {
      clientX: 80,
      clientY: 90,
      pointerId: 1,
      pointerType,
    });
    fireEvent.pointerUp(marker, {
      clientX: 80,
      clientY: 90,
      pointerId: 1,
      pointerType,
    });
    expect(fireEvent.click(marker, { detail: 1 })).toBe(false);

    const dialog = screen.getByRole("dialog", { name: "Move session" });
    expect(within(dialog).getByText("Fictional Medical Centre")).toBeVisible();
    expect(within(dialog).queryByText("Fictional Invoiced Practice")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Move to date" })).toHaveValue(
      "2026-08-12",
    );
    expect(onMoveSession).not.toHaveBeenCalled();
  },
);

it("cancels marker hold activation after early pointer movement", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  startPointer(marker);
  fireEvent.pointerMove(marker, { clientX: 19, clientY: 10, pointerId: 1 });
  act(() => vi.advanceTimersByTime(350));

  expect(marker).not.toHaveAttribute("data-dragging");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("keeps a normal marker pointer click as date selection", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-12"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  startPointer(marker);
  fireEvent.pointerUp(marker, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.click(marker, { detail: 1 });

  expect(
    screen.getByRole("button", { name: /Tuesday 11 August 2026, 2 sessions/i }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("never activates pointer dragging from an invoiced marker", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Invoiced Practice");
  activatePointer(marker);

  expect(marker).not.toHaveAttribute("data-pressed");
  expect(marker).not.toHaveAttribute("data-dragging");
  expect(marker.hasPointerCapture(1)).toBe(false);
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("labels cancellation and demo state without relying on colour", async () => {
  const user = userEvent.setup();
  render(<SessionCalendar initialDate="2026-08-21" sessions={sessions} />);
  await user.click(screen.getByRole("button", { name: /Friday 21 August 2026, 1 session/i }));
  const row = screen.getByRole("link", { name: /Example Health Practice/ });
  expect(within(row).getByText("Cancelled")).toBeVisible();
  expect(within(row).getByText("Demo")).toBeVisible();
});

it("keeps single click as selection and opens the popup on double-click", async () => {
  const user = userEvent.setup();
  render(<SessionCalendar initialDate="2026-08-11" sessions={sessions} />);
  const emptyDate = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/i,
  });

  await user.click(emptyDate);
  expect(emptyDate).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.dblClick(emptyDate);
  expect(
    screen.getByRole("dialog", { name: "Wednesday 12 August 2026" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Add session" })).toHaveAttribute(
    "href",
    "/sessions/new?date=2026-08-12",
  );
});

it("opens the same popup from the selected-date action", async () => {
  const user = userEvent.setup();
  render(<SessionCalendar initialDate="2026-08-11" sessions={sessions} />);

  await user.click(screen.getByRole("button", { name: "Add or edit sessions" }));
  const dialog = screen.getByRole("dialog", { name: "Tuesday 11 August 2026" });
  expect(dialog).toBeVisible();
  expect(
    within(dialog).getByRole("link", { name: /Fictional Medical Centre/ }),
  ).toHaveAttribute("href", "/sessions/session-planned");
});

it("keeps a normal tap on the edit link and does not start dragging", () => {
  vi.useFakeTimers();
  const onMoveSession = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const editLink = within(card).getByRole("link", { name: /Fictional Medical Centre/ });
  const observedClick = vi.fn();
  editLink.addEventListener("click", observedClick);
  startPointer(editLink);
  const capturedTarget = capturedPointers.get(1) ?? editLink;
  expect(capturedTarget).toBe(editLink);
  fireEvent.pointerUp(capturedTarget, { clientX: 10, clientY: 10, pointerId: 1 });

  const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  expect(capturedTarget.dispatchEvent(click)).toBe(true);
  expect(click.defaultPrevented).toBe(false);
  expect(observedClick).toHaveBeenCalledOnce();

  expect(editLink).toHaveAttribute("href", "/sessions/session-planned");
  expect(editLink).toHaveAttribute("draggable", "false");
  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  expect(onMoveSession).not.toHaveBeenCalled();
});

it("ignores touch Pointer Events so pointer cancellation cannot tear down native touch dragging", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  startPointer(card, 1, { pointerType: "touch" });
  act(() => vi.advanceTimersByTime(350));

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card.hasPointerCapture(1)).toBe(false);
});

it("keeps marker touch movement scrollable before the hold threshold", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  dispatchTouch(marker, "touchstart", 10, 10);
  expect(marker).toHaveAttribute("data-pressed", "true");
  const move = dispatchTouch(marker, "touchmove", 10, 19);
  act(() => vi.advanceTimersByTime(350));

  expect(move.defaultPrevented).toBe(false);
  expect(marker).not.toHaveAttribute("data-pressed");
  expect(marker).not.toHaveAttribute("data-dragging");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("holds and drags a marker with native touch and suppresses its compatibility click", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-12"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  const target = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/,
  });
  dispatchTouch(marker, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));
  expect(marker).toHaveAttribute("data-dragging", "true");

  setHitTarget(target);
  const move = dispatchTouch(marker, "touchmove", 80, 160);
  expect(move.defaultPrevented).toBe(true);
  dispatchTouch(marker, "touchend", 80, 160);

  expect(marker).not.toHaveAttribute("data-dragging");
  expect(fireEvent.click(marker, { detail: 1 })).toBe(false);
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(within(dialog).getByText("Fictional Medical Centre")).toBeVisible();
  expect(within(dialog).getByRole("combobox", { name: "Move to date" })).toHaveValue(
    "2026-08-12",
  );
});

it("accepts a native touch drop anywhere inside another calendar day", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-12"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  const target = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/,
  });
  const targetDay = target.closest("td");
  if (!targetDay) throw new Error("Missing target calendar day");

  dispatchTouch(marker, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));
  setHitTarget(targetDay);
  dispatchTouch(marker, "touchmove", 80, 160);

  expect(target).toHaveAttribute("data-drop-target", "true");
  dispatchTouch(marker, "touchend", 80, 160);
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
});

it.each([
  ["Fictional Planned Practice", "Fictional Planned Practice"],
  ["Fictional Completed Practice", "Fictional Completed Practice"],
])("identifies the correct same-date marker for native touch: %s", (practiceName, expected) => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={movableSessions.slice(0, 2)}
    />,
  );

  const marker = markerFor(practiceName);
  const target = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/,
  });
  dispatchTouch(marker, "touchstart", 20, 20);
  act(() => vi.advanceTimersByTime(350));
  setHitTarget(target);
  dispatchTouch(marker, "touchmove", 80, 160);
  dispatchTouch(marker, "touchend", 80, 160);

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(within(dialog).getByText(expected)).toBeVisible();
});

it("continuously scrolls and retargets an off-screen date while holding a marker", () => {
  vi.useFakeTimers();
  const scrollBy = vi.fn();
  vi.stubGlobal("scrollBy", scrollBy);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Medical Centre");
  const target = screen.getByRole("button", {
    name: /Wednesday 12 August 2026, 0 sessions/,
  });
  setHitTarget(null);
  vi.mocked(document.elementFromPoint).mockImplementation(
    () => scrollBy.mock.calls.length >= 3 ? target : null,
  );
  dispatchTouch(marker, "touchstart", 80, 180);
  act(() => vi.advanceTimersByTime(350));
  expect(marker).toHaveAttribute("data-dragging", "true");

  const move = dispatchTouch(marker, "touchmove", 80, 20);
  expect(move.defaultPrevented).toBe(true);
  act(() => vi.advanceTimersByTime(240));
  expect(scrollBy.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(target).toHaveAttribute("data-drop-target", "true");

  dispatchTouch(marker, "touchend", 80, 20);
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  const completedScrolls = scrollBy.mock.calls.length;
  act(() => vi.advanceTimersByTime(240));
  expect(scrollBy).toHaveBeenCalledTimes(completedScrolls);
});

it.each(["touchcancel", "second finger", "Escape"] as const)(
  "clears an active marker drag and edge-scroll interval after %s",
  (cancellation) => {
    vi.useFakeTimers();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(
      <SessionCalendar
        initialDate="2026-08-11"
        onMoveSession={vi.fn().mockResolvedValue(undefined)}
        sessions={markerSessions}
      />,
    );

    const marker = markerFor("Fictional Medical Centre");
    const firstTouch = { clientX: 80, clientY: 20, identifier: 7, target: marker };
    dispatchTouches(marker, "touchstart", [firstTouch], [firstTouch]);
    act(() => vi.advanceTimersByTime(350));
    expect(marker).toHaveAttribute("data-dragging", "true");
    dispatchTouches(marker, "touchmove", [firstTouch], [firstTouch]);
    const startedScrolls = scrollBy.mock.calls.length;
    expect(startedScrolls).toBeGreaterThan(0);

    if (cancellation === "touchcancel") {
      dispatchTouches(marker, "touchcancel", [], [firstTouch]);
    } else if (cancellation === "second finger") {
      const secondTouch = { clientX: 30, clientY: 30, identifier: 8, target: marker };
      dispatchTouches(marker, "touchmove", [firstTouch, secondTouch], [secondTouch]);
    } else {
      fireEvent.keyDown(document, { key: "Escape" });
    }

    expect(marker).not.toHaveAttribute("data-dragging");
    expect(fireEvent.click(marker, { detail: 1 })).toBe(false);
    act(() => vi.advanceTimersByTime(240));
    expect(scrollBy).toHaveBeenCalledTimes(startedScrolls);
    expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  },
);

it("does not start native touch dragging from an invoiced marker", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const marker = markerFor("Fictional Invoiced Practice");
  dispatchTouch(marker, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));

  expect(marker).not.toHaveAttribute("data-pressed");
  expect(marker).not.toHaveAttribute("data-dragging");
});

it("suppresses navigation when iOS cancels an active held touch", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const editLink = within(card).getByRole("link", { name: /Fictional Medical Centre/ });
  dispatchTouch(editLink, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));
  expect(card).toHaveAttribute("data-dragging", "true");

  dispatchTouch(editLink, "touchcancel", 10, 10);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  expect(editLink.dispatchEvent(click)).toBe(false);
  expect(click.defaultPrevented).toBe(true);
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("keeps native touch movement scrollable before the hold threshold", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  dispatchTouch(card, "touchstart", 10, 10);
  const move = dispatchTouch(card, "touchmove", 10, 19);
  act(() => vi.advanceTimersByTime(350));

  expect(move.defaultPrevented).toBe(false);
  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("prevents native touch scrolling after hold and opens the move dialog on touchend", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  dispatchTouch(card, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));
  expect(card).toHaveAttribute("aria-grabbed", "true");

  setHitTarget(target);
  fireEvent.pointerCancel(card, { pointerId: 1, pointerType: "touch" });
  const move = dispatchTouch(card, "touchmove", 80, 160);
  expect(move.defaultPrevented).toBe(true);
  expect(target).toHaveAttribute("data-drop-target", "true");
  dispatchTouch(card, "touchend", 80, 160);

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
});

it("keeps scrolling toward an off-screen date while a held finger stays at the viewport edge", () => {
  vi.useFakeTimers();
  const scrollBy = vi.fn();
  vi.stubGlobal("scrollBy", scrollBy);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  setHitTarget(null);
  vi.mocked(document.elementFromPoint).mockImplementation(
    () => scrollBy.mock.calls.length >= 3 ? target : null,
  );
  dispatchTouch(card, "touchstart", 80, 180);
  act(() => vi.advanceTimersByTime(350));
  expect(card).toHaveAttribute("data-dragging", "true");

  const move = dispatchTouch(card, "touchmove", 80, 20);
  expect(move.defaultPrevented).toBe(true);
  expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: -48 });

  act(() => vi.advanceTimersByTime(240));
  expect(scrollBy.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(target).toHaveAttribute("data-drop-target", "true");

  dispatchTouch(card, "touchend", 80, 20);
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Move to date" })).toHaveValue(
    "2026-08-12",
  );
  const completedScrolls = scrollBy.mock.calls.length;
  act(() => vi.advanceTimersByTime(240));
  expect(scrollBy).toHaveBeenCalledTimes(completedScrolls);
});

it("does not suppress a later keyboard edit after a completed native touch drag", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  dispatchTouch(card, "touchstart", 10, 10);
  act(() => vi.advanceTimersByTime(350));
  setHitTarget(target);
  dispatchTouch(card, "touchmove", 80, 160);
  dispatchTouch(card, "touchend", 80, 160);

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();

  const editLink = within(card).getByRole("link", { name: /Fictional Medical Centre/ });
  const observedClick = vi.fn();
  editLink.addEventListener("click", observedClick);
  editLink.focus();
  const keyboardClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: 0,
  });

  expect(editLink.dispatchEvent(keyboardClick)).toBe(true);
  expect(keyboardClick.defaultPrevented).toBe(false);
  expect(observedClick).toHaveBeenCalledOnce();
});

it("cancels a pending hold when a second finger starts", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const firstTouch = { clientX: 10, clientY: 10, identifier: 7, target: card };
  const secondTouch = { clientX: 30, clientY: 30, identifier: 8, target: card };
  dispatchTouches(card, "touchstart", [firstTouch], [firstTouch]);
  dispatchTouches(card, "touchstart", [firstTouch, secondTouch], [secondTouch]);
  const move = dispatchTouches(card, "touchmove", [firstTouch, secondTouch]);
  act(() => vi.advanceTimersByTime(350));

  expect(move.defaultPrevented).toBe(false);
  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card).not.toHaveAttribute("data-dragging");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("cancels an active held drag when touchmove contains a second finger", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  const firstTouch = { clientX: 10, clientY: 10, identifier: 7, target: card };
  const movedTouch = { ...firstTouch, clientX: 80, clientY: 90 };
  const secondTouch = { clientX: 30, clientY: 30, identifier: 8, target: card };
  dispatchTouches(card, "touchstart", [firstTouch], [firstTouch]);
  act(() => vi.advanceTimersByTime(350));
  expect(card).toHaveAttribute("aria-grabbed", "true");

  setHitTarget(target);
  const move = dispatchTouches(card, "touchmove", [movedTouch, secondTouch]);
  dispatchTouches(card, "touchend", [], [movedTouch, secondTouch]);

  expect(move.defaultPrevented).toBe(false);
  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(target).not.toHaveAttribute("data-drop-target");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
});

it("captures on press so pointerup outside before 350ms cannot activate later", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  startPointer(card);
  const lifecycleTarget = capturedPointers.get(1) ?? document.body;
  fireEvent.pointerUp(lifecycleTarget, {
    button: 0,
    buttons: 0,
    clientX: 500,
    clientY: 500,
    isPrimary: true,
    pointerId: 1,
  });
  act(() => vi.advanceTimersByTime(350));

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card.hasPointerCapture(1)).toBe(false);
});

it("ignores a non-primary pointer", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  startPointer(card, 2, { isPrimary: false });
  act(() => vi.advanceTimersByTime(350));

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card.hasPointerCapture(2)).toBe(false);
});

it.each([1, 2, 5])("ignores non-main pointer button %s", (button) => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  startPointer(card, 1, { button, buttons: 1 << button });
  act(() => vi.advanceTimersByTime(350));

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card.hasPointerCapture(1)).toBe(false);
});

it("starts a hold from the edit surface and suppresses its navigation after dragging", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const editLink = within(card).getByRole("link", { name: /Fictional Medical Centre/ });
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  activatePointer(editLink);
  setHitTarget(target);
  fireEvent.pointerMove(editLink, { clientX: 80, clientY: 90, pointerId: 1 });
  fireEvent.pointerUp(editLink, { clientX: 80, clientY: 90, pointerId: 1 });

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(fireEvent.click(editLink, { detail: 1 })).toBe(false);
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
});

it("cancels hold activation when pre-activation movement exceeds 8px", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  startPointer(card);
  fireEvent.pointerMove(card, { clientX: 19, clientY: 10, pointerId: 1 });
  act(() => vi.advanceTimersByTime(350));

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(card).not.toHaveAttribute("data-dragging", "true");
});

it("starts dragging after a 350ms hold and highlights the hit-tested visible date", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  activatePointer(card);

  expect(card).toHaveAttribute("aria-grabbed", "true");
  expect(card).toHaveAttribute("data-dragging", "true");
  expect(card).toHaveClass("session-calendar__agenda-card");

  setHitTarget(target.querySelector("span"));
  fireEvent.pointerMove(card, { clientX: 80, clientY: 90, pointerId: 1 });
  expect(target).toHaveAttribute("data-drop-target", "true");
});

it("opens the move dialog when released on a different visible date", () => {
  vi.useFakeTimers();
  const onMoveSession = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  const target = screen.getByRole("button", { name: /Wednesday 12 August 2026, 0 sessions/ });
  activatePointer(card);
  setHitTarget(target);
  fireEvent.pointerMove(card, { clientX: 80, clientY: 90, pointerId: 1 });
  fireEvent.pointerUp(card, { clientX: 80, clientY: 90, pointerId: 1 });

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(within(dialog).getByText("Fictional Medical Centre")).toBeVisible();
  expect(within(dialog).getByRole("combobox", { name: "Move to date" })).toHaveValue("2026-08-12");
  expect(onMoveSession).not.toHaveBeenCalled();
});

it("shows an accessible success notice after a confirmed move resolves for 2500ms", async () => {
  vi.useFakeTimers();
  const onMoveSession = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  expect(screen.queryByText("Session moved successfully.")).not.toBeInTheDocument();

  await confirmMoveDialog();

  expect(onMoveSession).toHaveBeenCalledWith("marker-planned", "2026-08-12");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  const notice = screen.getByRole("status");
  expect(notice).toHaveTextContent("Session moved successfully.");
  expect(notice).toHaveAttribute("aria-live", "polite");
  expect(notice).toHaveClass("session-calendar__move-success");

  act(() => vi.advanceTimersByTime(2499));
  expect(screen.getByRole("status")).toBeVisible();

  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("waits for the move callback to resolve before closing the dialog and reporting success", async () => {
  vi.useFakeTimers();
  let resolveMove: (() => void) | undefined;
  const pendingMove = new Promise<void>((resolve) => {
    resolveMove = resolve;
  });
  const onMoveSession = vi.fn().mockReturnValue(pendingMove);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
  });

  expect(onMoveSession).toHaveBeenCalledWith("marker-planned", "2026-08-12");
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  await act(async () => {
    resolveMove?.();
    await pendingMove;
  });

  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Session moved successfully.");
});

it("keeps the keyboard move dialog open without reporting success for its unchanged date", async () => {
  vi.useFakeTimers();
  const onMoveSession = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={markerSessions}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Move session" }));
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(within(dialog).getByRole("combobox", { name: "Move to date" })).toHaveValue(
    "2026-08-11",
  );

  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
  });

  expect(onMoveSession).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps the drag move dialog open without reporting success when changed back to source", async () => {
  vi.useFakeTimers();
  const onMoveSession = vi.fn().mockResolvedValue(undefined);
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={onMoveSession}
      sessions={markerSessions}
    />,
  );

  const dialog = openPointerMoveDialog();
  const picker = within(dialog).getByRole("combobox", { name: "Move to date" });
  expect(picker).toHaveValue("2026-08-12");
  fireEvent.change(picker, { target: { value: "2026-08-11" } });

  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
  });

  expect(onMoveSession).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps the move dialog error visible and never reports success after rejection", async () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockRejectedValue(new Error("offline failure"))}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  await confirmMoveDialog();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Session could not be moved. Try again.",
  );
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();
  expect(screen.queryByText("Session moved successfully.")).not.toBeInTheDocument();
});

it("does not report success when the move dialog is cancelled", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  const dialog = openPointerMoveDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  expect(screen.queryByText("Session moved successfully.")).not.toBeInTheDocument();
});

it("replaces the dismissal timer after another successful move", async () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog(1);
  await confirmMoveDialog();
  act(() => vi.advanceTimersByTime(1000));

  openPointerMoveDialog(2);
  await confirmMoveDialog();

  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole("status")).toHaveTextContent("Session moved successfully.");

  act(() => vi.advanceTimersByTime(999));
  expect(screen.getByRole("status")).toBeVisible();

  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each(["pointer", "touch", "keyboard"] as const)(
  "clears stale success when a valid new %s move begins",
  async (method) => {
    vi.useFakeTimers();
    render(
      <SessionCalendar
        initialDate="2026-08-11"
        onMoveSession={vi.fn().mockResolvedValue(undefined)}
        sessions={markerSessions}
      />,
    );

    openPointerMoveDialog();
    await confirmMoveDialog();
    expect(screen.getByRole("status")).toBeVisible();

    const marker = markerFor("Fictional Medical Centre");
    if (method === "pointer") {
      startPointer(marker, 2);
    } else if (method === "touch") {
      dispatchTouch(marker, "touchstart", 10, 10);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Move session" }));
    }

    expect(screen.queryByText("Session moved successfully.")).not.toBeInTheDocument();
  },
);

it("keeps success visible after unrelated calendar interaction", async () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  await confirmMoveDialog();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));

  expect(screen.getByRole("status")).toHaveTextContent("Session moved successfully.");
});

it("clears the success dismissal timer on unmount", async () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  act(() => vi.advanceTimersByTime(500));
  await confirmMoveDialog();
  const timerCountBeforeUnmount = vi.getTimerCount();
  expect(timerCountBeforeUnmount).toBeGreaterThan(0);

  unmount();

  expect(vi.getTimerCount()).toBe(timerCountBeforeUnmount - 1);
});

it("does not create success work when a pending move resolves after unmount", async () => {
  vi.useFakeTimers();
  let resolveMove: (() => void) | undefined;
  const pendingMove = new Promise<void>((resolve) => {
    resolveMove = resolve;
  });
  const { unmount } = render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockReturnValue(pendingMove)}
      sessions={markerSessions}
    />,
  );

  openPointerMoveDialog();
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  unmount();
  vi.clearAllTimers();
  expect(vi.getTimerCount()).toBe(0);

  await act(async () => {
    resolveMove?.();
    await pendingMove;
  });

  expect(vi.getTimerCount()).toBe(0);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each([
  ["release outside a date", "outside"],
  ["release on the original date", "original"],
  ["pointer cancellation", "cancel"],
  ["Escape", "escape"],
] as const)("cancels dragging after %s without opening a dialog", (_label, cancellation) => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  activatePointer(card);

  if (cancellation === "cancel") {
    fireEvent.pointerCancel(card, { pointerId: 1 });
  } else if (cancellation === "escape") {
    fireEvent.keyDown(document, { key: "Escape" });
  } else {
    const target = cancellation === "original"
      ? screen.getByRole("button", { name: /Tuesday 11 August 2026, 1 session/ })
      : null;
    setHitTarget(target);
    fireEvent.pointerMove(card, { clientX: 80, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 80, clientY: 90, pointerId: 1 });
  }

  expect(card).toHaveAttribute("aria-grabbed", "false");
  expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument();
  expect(screen.queryByText("Session moved successfully.")).not.toBeInTheDocument();
});

it("locks invoiced sessions with an accessible reason and allows all other statuses to drag", () => {
  vi.useFakeTimers();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={movableSessions}
    />,
  );

  const invoicedCard = cardFor("Fictional Invoiced Practice");
  expect(within(invoicedCard).getByRole("button", { name: "Move unavailable: invoiced" })).toBeDisabled();
  startPointer(invoicedCard);
  act(() => vi.advanceTimersByTime(350));
  expect(invoicedCard).toHaveAttribute("aria-grabbed", "false");

  for (const practice of [
    "Fictional Planned Practice",
    "Fictional Completed Practice",
    "Fictional Cancelled Practice",
  ]) {
    const card = cardFor(practice);
    activatePointer(card);
    expect(card).toHaveAttribute("aria-grabbed", "true");
    fireEvent.pointerCancel(card, { pointerId: 1 });
  }
});

it("opens the same visible-date move dialog from the keyboard control", async () => {
  const user = userEvent.setup();
  render(
    <SessionCalendar
      initialDate="2026-08-11"
      onMoveSession={vi.fn().mockResolvedValue(undefined)}
      sessions={sessions}
    />,
  );

  const card = cardFor("Fictional Medical Centre");
  await user.click(within(card).getByRole("button", { name: "Move session" }));

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  const picker = within(dialog).getByRole("combobox", { name: "Move to date" });
  expect(within(picker).getAllByRole("option")).toHaveLength(42);
  expect(picker).toHaveValue("2026-08-11");
});
