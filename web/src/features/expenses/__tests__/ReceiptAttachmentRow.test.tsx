import { createRef } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ReceiptAttachmentRow, type ReceiptAttachmentRowProps } from "../ReceiptAttachmentRow";

const globalStyles = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function cssDeclarations(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return globalStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

const props: ReceiptAttachmentRowProps = {
  busy: false,
  canChange: true,
  canRemove: true,
  filename: "fictional-receipt.pdf",
  focusTargetRef: createRef<HTMLButtonElement>(),
  hasReceipt: true,
  removing: false,
  onChange: vi.fn(),
  onRemove: vi.fn(),
  onUndo: vi.fn(),
  onView: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(overrides: Partial<typeof props> = {}) {
  return render(<ReceiptAttachmentRow {...props} {...overrides} />);
}

function swipeLeft(target: Element, distance = 130, y = 20) {
  fireEvent.pointerDown(target, { clientX: 250, clientY: y, pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: 250 - distance, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(target, { clientX: 250 - distance, clientY: y, pointerId: 1 });
}

it("uses compact, touch-safe, motion-safe swipe receipt classes", () => {
  renderRow();

  expect(screen.getByTestId("receipt-attachment-row")).toHaveClass("expense-receipt-swipe");
  expect(screen.getByText("Receipt attached").closest("button")).toHaveClass("expense-receipt-swipe__summary");
  expect(screen.getByRole("button", { name: "Receipt options" })).toHaveClass("expense-receipt-swipe__options");

  expect(cssDeclarations(".expense-receipt-swipe")).toMatch(/overflow:\s*hidden/);
  expect(cssDeclarations(".expense-receipt-swipe__surface")).toMatch(/touch-action:\s*pan-y/);
  expect(cssDeclarations(".expense-receipt-swipe__surface")).toMatch(/grid-template-columns:/);
  expect(cssDeclarations(".expense-receipt-swipe__hint")).toMatch(/color:\s*var\(--color-muted\)/);
  expect(cssDeclarations(".expense-receipt-swipe__options")).toMatch(/border-radius:\s*999px/);
  expect(cssDeclarations(".expense-receipt-swipe__tray")).toMatch(/grid-template-columns:/);
  expect(cssDeclarations(".expense-receipt-swipe__action")).toMatch(/border-radius:\s*999px/);
  expect(cssDeclarations(".expense-receipt-swipe__action")).toMatch(/min-width:\s*44px/);
  expect(cssDeclarations(".expense-receipt-swipe__action")).toMatch(/min-height:\s*44px/);
  expect(cssDeclarations(".expense-receipt-swipe__action--view")).toMatch(/background:/);
  expect(cssDeclarations(".expense-receipt-swipe__action--change")).toMatch(/--color-warning|oklch|color-mix/);
  expect(cssDeclarations(".expense-receipt-swipe__action--danger")).toMatch(/var\(--color-danger\)/);
  expect(cssDeclarations(".expense-receipt-swipe__action-label")).toMatch(/font-size:/);
  expect(cssDeclarations(".expense-receipt-swipe__action-icon")).toMatch(/--expense-receipt-action-progress/);
  expect(cssDeclarations(".expense-receipt-swipe__action-icon")).toMatch(/transform:\s*scale/);
  expect(cssDeclarations(".expense-receipt-swipe__action-icon")).toMatch(/opacity:/);
  expect(cssDeclarations(".expense-receipt-swipe__action-label")).toMatch(/--expense-receipt-action-progress/);
  expect(cssDeclarations(".expense-receipt-swipe__action-label")).toMatch(/opacity:/);
  expect(cssDeclarations(".expense-receipt-swipe__action--danger .expense-receipt-swipe__action-icon::before")).toMatch(
    /--expense-receipt-remove-stretch/,
  );
  expect(cssDeclarations(".expense-receipt-swipe__action--danger .expense-receipt-swipe__action-icon::before")).toMatch(
    /width:/,
  );
  expect(cssDeclarations(".expense-receipt-swipe__filename")).toMatch(/text-overflow:\s*ellipsis/);
  expect(cssDeclarations(".expense-receipt-swipe__surface[data-dragging=\"true\"]")).toMatch(/transition:\s*none/);
  expect(globalStyles).toMatch(/prefers-reduced-motion:\s*reduce/);
  expect(globalStyles).toMatch(/\.expense-receipt-swipe__action:hover:not\(:disabled\)/);
  expect(globalStyles).toMatch(/\.expense-receipt-swipe__action:active:not\(:disabled\)/);
  expect(globalStyles).toMatch(/\.expense-receipt-swipe__action:focus-visible/);
  expect(globalStyles).toMatch(/\.expense-receipt-swipe__action:disabled/);
  expect(globalStyles).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.expense-receipt-swipe__action-icon,[\s\S]*?transition:\s*none/,
  );
});

it("keeps the elastic Remove decoration inside a non-interactive action lane", () => {
  renderRow();

  expect(cssDeclarations(".expense-receipt-swipe__action")).toMatch(/overflow:\s*clip/);

  const dangerIcon = cssDeclarations(
    ".expense-receipt-swipe__action--danger .expense-receipt-swipe__action-icon",
  );
  expect(dangerIcon).toMatch(/width:\s*44px/);
  expect(dangerIcon).not.toMatch(/width:\s*calc/);

  const dangerDecoration = cssDeclarations(
    ".expense-receipt-swipe__action--danger .expense-receipt-swipe__action-icon::before",
  );
  expect(dangerDecoration).toMatch(/pointer-events:\s*none/);
  expect(dangerDecoration).toMatch(
    /width:\s*calc\(44px \+ \(var\(--expense-receipt-remove-stretch, 0\) \* 28px\)\)/,
  );
});

it("uses a slower 240ms release while direct dragging stays transition-free", () => {
  renderRow();

  expect(cssDeclarations(".expense-receipt-swipe__surface")).toMatch(
    /transition:\s*transform 240ms/,
  );
  expect(cssDeclarations(".expense-receipt-swipe__action-icon")).toMatch(/240ms/);
  expect(cssDeclarations(".expense-receipt-swipe__action-label")).toMatch(/240ms/);
  expect(cssDeclarations(".expense-receipt-swipe__surface[data-dragging=\"true\"]")).toMatch(
    /transition:\s*none/,
  );
});

it("shows a swipe hint and compact ellipsis while closed", () => {
  const focusTargetRef = createRef<HTMLButtonElement>();
  renderRow({ focusTargetRef });

  expect(screen.getByText("Receipt attached")).toBeVisible();
  expect(screen.getByText("fictional-receipt.pdf")).toBeVisible();
  expect(screen.getByRole("button", { name: "View receipt, Receipt attached, fictional-receipt.pdf" })).toBeVisible();
  expect(screen.getByText("Swipe left for options")).toBeVisible();
  const options = screen.getByRole("button", { name: "Receipt options" });
  expect(options).toHaveTextContent("•••");
  expect(options).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  expect(focusTargetRef.current).toBe(
    screen.getByRole("button", {
      name: "View receipt, Receipt attached, fictional-receipt.pdf",
    }),
  );
});

it("moves with the pointer and exposes the tray before pointer-up", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const tray = row.querySelector<HTMLElement>(".expense-receipt-swipe__tray");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!tray || !surface) throw new Error("Expected receipt tray and surface");

  fireEvent.pointerDown(row, { clientX: 280, clientY: 24, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 210, clientY: 28, pointerId: 11 });

  expect(surface).toHaveAttribute("data-dragging", "true");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("-70px");
  expect(tray).toHaveAttribute("data-revealed", "true");
  expect(tray).toHaveTextContent("View");
  expect(tray).toHaveTextContent("Change");
  expect(tray).toHaveTextContent("Remove");
  expect(tray).toHaveAttribute("aria-hidden", "true");
});

it("does not reveal or translate for sub-threshold pointer movement", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 243, clientY: 20, pointerId: 11 });

  expect(surface).toHaveAttribute("data-dragging", "false");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("0px");
});

it("keeps equal diagonal movement available to vertical scrolling", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 240, clientY: 30, pointerId: 11 });

  expect(surface).toHaveAttribute("data-dragging", "false");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("0px");
});

it("keeps a vertical gesture locked when later movement becomes horizontal", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 248, clientY: 40, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 150, clientY: 45, pointerId: 11 });
  fireEvent.pointerUp(row, { clientX: 150, clientY: 45, pointerId: 11 });

  expect(surface).toHaveAttribute("data-dragging", "false");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("0px");
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("continues to progressively reveal the tray after a horizontal gesture locks", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 280, clientY: 24, pointerId: 11 });
  fireEvent.pointerMove(row, { clientX: 270, clientY: 26, pointerId: 11 });
  expect(surface).toHaveAttribute("data-dragging", "true");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("-10px");

  fireEvent.pointerMove(row, { clientX: 210, clientY: 28, pointerId: 11 });
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("-70px");
});

it("reveals action visuals progressively from the pulling edge inward", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  const [view, change, remove] = [
    ...row.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action"),
  ];
  if (!surface || !view || !change || !remove) throw new Error("Expected receipt swipe actions");

  fireEvent.pointerDown(row, { clientX: 300, clientY: 24, pointerId: 101 });
  fireEvent.pointerMove(row, { clientX: 260, clientY: 24, pointerId: 101 });

  expect(row.style.getPropertyValue("--expense-receipt-reveal")).toBe("0.171");
  expect(view.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0");
  expect(change.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0");
  expect(remove.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0.393");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("-40px");

  fireEvent.pointerMove(row, { clientX: 200, clientY: 24, pointerId: 101 });
  expect(view.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0");
  expect(change.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0.17");
  expect(remove.style.getPropertyValue("--expense-receipt-action-progress")).toBe("1");

  fireEvent.pointerMove(row, { clientX: 120, clientY: 24, pointerId: 101 });
  expect(view.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0.192");
  expect(change.style.getPropertyValue("--expense-receipt-action-progress")).toBe("1");
  expect(remove.style.getPropertyValue("--expense-receipt-action-progress")).toBe("1");
  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();
});

it("grows the first revealed action more gradually during the pull", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const remove = row.querySelector<HTMLElement>(".expense-receipt-swipe__action--danger");
  if (!remove) throw new Error("Expected Remove action");

  fireEvent.pointerDown(row, { clientX: 300, clientY: 24, pointerId: 111 });
  fireEvent.pointerMove(row, { clientX: 260, clientY: 24, pointerId: 111 });

  expect(remove.style.getPropertyValue("--expense-receipt-action-progress")).toBe("0.393");
});

it("resists overswipe, stretches Remove, and only settles the tray open", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 300, clientY: 24, pointerId: 102 });
  fireEvent.pointerMove(row, { clientX: -100, clientY: 24, pointerId: 102 });

  const resistedOffset = Number(
    surface.style.getPropertyValue("--expense-receipt-swipe-offset").replace("px", ""),
  );
  expect(resistedOffset).toBeLessThan(-234);
  expect(resistedOffset).toBeGreaterThanOrEqual(-262);
  expect(row.style.getPropertyValue("--expense-receipt-remove-stretch")).toBe("1");
  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();

  fireEvent.pointerUp(row, { clientX: -100, clientY: 24, pointerId: 102 });

  expect(screen.getByRole("button", { name: "Receipt options" })).toHaveAttribute("aria-expanded", "true");
  expect(surface.style.getPropertyValue("--expense-receipt-swipe-offset")).toBe("-234px");
  expect(row.style.getPropertyValue("--expense-receipt-remove-stretch")).toBe("0");
  expect(props.onRemove).not.toHaveBeenCalled();
});

it("keeps Change and Remove independently activatable after an overswipe", async () => {
  const user = userEvent.setup();
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");

  fireEvent.pointerDown(row, { clientX: 300, clientY: 24, pointerId: 112 });
  fireEvent.pointerMove(row, { clientX: -100, clientY: 24, pointerId: 112 });
  fireEvent.pointerUp(row, { clientX: -100, clientY: 24, pointerId: 112 });

  await user.click(screen.getByRole("button", { name: "Change" }));
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(props.onRemove).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Remove" }));
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(props.onRemove).toHaveBeenCalledTimes(1);
  expect(props.onView).not.toHaveBeenCalled();
});

it("does not set an inline transition on the swipe foreground", () => {
  renderRow();

  const summary = screen.getByText("Receipt attached").closest("button");
  if (!summary) throw new Error("Expected receipt summary button");
  expect(summary.parentElement).not.toHaveAttribute("style", expect.stringContaining("transition"));
});

it("opens the tray after a deliberate left swipe", () => {
  renderRow();
  swipeLeft(screen.getByTestId("receipt-attachment-row"));

  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();
});

it("suppresses the release click when a completed swipe reveals View beneath it", async () => {
  const user = userEvent.setup();
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.click(screen.getByRole("button", { name: "View" }), { clientX: 60, clientY: 20, detail: 0 });

  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "View" }));
  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("keeps the primary swipe guard when a second pointer starts and ends", async () => {
  const user = userEvent.setup();
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerDown(row, { clientX: 180, clientY: 20, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 180, clientY: 20, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 60, clientY: 20, pointerId: 1 });

  const view = screen.getByRole("button", { name: "View" });
  fireEvent.click(view, { clientX: 60, clientY: 20, detail: 0 });

  expect(view).toBeVisible();
  expect(screen.getByRole("button", { name: "Receipt options" })).toHaveAttribute("aria-expanded", "true");
  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();

  await user.click(view);
  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("keeps ordinary Options and View pointer taps targeted to their buttons", () => {
  renderRow();
  const options = screen.getByRole("button", { name: "Receipt options" });

  fireEvent.pointerDown(options, { clientX: 250, clientY: 20, pointerId: 61 });
  fireEvent.pointerUp(options, { clientX: 250, clientY: 20, pointerId: 61 });
  fireEvent.click(options, { clientX: 250, clientY: 20, detail: 1 });

  const view = screen.getByRole("button", { name: "View" });
  expect(view).toBeVisible();

  fireEvent.pointerDown(view, { clientX: 120, clientY: 20, pointerId: 62 });
  fireEvent.pointerUp(view, { clientX: 120, clientY: 20, pointerId: 62 });
  fireEvent.click(view, { clientX: 120, clientY: 20, detail: 1 });

  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("captures only after a primary gesture locks", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const setPointerCapture = vi.fn();
  Object.defineProperty(row, "setPointerCapture", { configurable: true, value: setPointerCapture });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 71 });
  expect(setPointerCapture).not.toHaveBeenCalled();
  fireEvent.pointerMove(row, { clientX: 243, clientY: 20, pointerId: 71 });
  expect(setPointerCapture).not.toHaveBeenCalled();
  fireEvent.pointerMove(row, { clientX: 240, clientY: 30, pointerId: 71 });
  expect(setPointerCapture).toHaveBeenCalledTimes(1);
  expect(setPointerCapture).toHaveBeenCalledWith(71);
  fireEvent.pointerUp(row, { clientX: 240, clientY: 30, pointerId: 71 });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 72 });
  fireEvent.pointerMove(row, { clientX: 246, clientY: 40, pointerId: 72 });
  expect(setPointerCapture).toHaveBeenCalledTimes(2);
  expect(setPointerCapture).toHaveBeenLastCalledWith(72);
  fireEvent.pointerUp(row, { clientX: 246, clientY: 40, pointerId: 72 });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 73 });
  fireEvent.pointerMove(row, { clientX: 240, clientY: 22, pointerId: 73 });
  expect(setPointerCapture).toHaveBeenCalledTimes(3);
  expect(setPointerCapture).toHaveBeenCalledWith(73);
  fireEvent.pointerMove(row, { clientX: 180, clientY: 24, pointerId: 73 });
  expect(setPointerCapture).toHaveBeenCalledTimes(3);
});

it("cleans a captured vertical release outside the row before the next horizontal swipe", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(row, {
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    setPointerCapture: { configurable: true, value: setPointerCapture },
  });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 81 });
  fireEvent.pointerMove(row, { clientX: 238, clientY: 112, pointerId: 81 });
  expect(setPointerCapture).toHaveBeenCalledWith(81);
  // A captured vertical pointer-up returns to the row even after leaving it.
  fireEvent.pointerUp(row, { clientX: 180, clientY: 260, pointerId: 81 });

  expect(releasePointerCapture).toHaveBeenCalledWith(81);
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();

  swipeLeft(row);
  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
});

it("releases a matching captured vertical cancellation without accepting a secondary cancellation", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const releasePointerCapture = vi.fn();
  Object.defineProperty(row, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 91 });
  fireEvent.pointerMove(row, { clientX: 238, clientY: 112, pointerId: 91 });
  fireEvent.pointerCancel(row, { pointerId: 92 });

  expect(releasePointerCapture).not.toHaveBeenCalled();

  fireEvent.pointerCancel(row, { pointerId: 91 });
  expect(releasePointerCapture).toHaveBeenCalledWith(91);

  swipeLeft(row);
  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
});

it("captures the primary pointer and handles its captured release outside the row", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(row, {
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    setPointerCapture: { configurable: true, value: setPointerCapture },
  });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 41 });
  expect(setPointerCapture).not.toHaveBeenCalled();
  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 41 });
  expect(setPointerCapture).toHaveBeenCalledWith(41);
  // A captured pointer-up is retargeted to the row even when released outside it.
  fireEvent.pointerUp(row, { clientX: -100, clientY: 20, pointerId: 41 });

  expect(setPointerCapture).toHaveBeenCalledWith(41);
  expect(releasePointerCapture).toHaveBeenCalledWith(41);
  expect(screen.getByRole("button", { name: "View" })).toBeVisible();

  const view = screen.getByRole("button", { name: "View" });
  fireEvent.click(view, { clientX: -100, clientY: 20, detail: 0 });
  expect(props.onView).not.toHaveBeenCalled();

  fireEvent.pointerDown(view, { clientX: 120, clientY: 20, pointerId: 42 });
  fireEvent.pointerUp(view, { clientX: 120, clientY: 20, pointerId: 42 });
  fireEvent.click(view, { clientX: 120, clientY: 20, detail: 1 });
  expect(props.onView).toHaveBeenCalledTimes(1);

  fireEvent.pointerDown(row, { clientX: 60, clientY: 20, pointerId: 43 });
  fireEvent.pointerMove(row, { clientX: 200, clientY: 20, pointerId: 43 });
  fireEvent.pointerUp(row, { clientX: 200, clientY: 20, pointerId: 43 });
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("releases only the captured primary pointer on cancellation", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const releasePointerCapture = vi.fn();
  Object.defineProperty(row, "releasePointerCapture", { configurable: true, value: releasePointerCapture });
  const surface = row.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
  if (!surface) throw new Error("Expected receipt surface");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 51 });
  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 51 });
  fireEvent.pointerCancel(row, { pointerId: 52 });

  expect(surface).toHaveAttribute("data-dragging", "true");
  expect(releasePointerCapture).not.toHaveBeenCalled();

  fireEvent.pointerCancel(row, { pointerId: 51 });
  expect(surface).toHaveAttribute("data-dragging", "false");
  expect(releasePointerCapture).toHaveBeenCalledWith(51);
});

it("isolates secondary pointer events and clicks while the primary swipe remains active", async () => {
  const user = userEvent.setup();
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const summary = screen.getByRole("button", { name: "View receipt, Receipt attached, fictional-receipt.pdf" });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 120, clientY: 20, pointerId: 1 });
  fireEvent.pointerDown(row, { clientX: 200, clientY: 20, pointerId: 2 });
  fireEvent.pointerUp(row, { clientX: 200, clientY: 20, pointerId: 2 });
  fireEvent.pointerCancel(row, { pointerId: 2 });
  fireEvent.click(summary, { clientX: 200, clientY: 20, detail: 1 });

  expect(props.onView).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onRemove).not.toHaveBeenCalled();

  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 60, clientY: 20, pointerId: 1 });
  const view = screen.getByRole("button", { name: "View" });
  expect(view).toBeVisible();

  view.focus();
  await user.keyboard("{Enter}");
  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("suppresses the summary release click after a short horizontal drag", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const summary = screen.getByRole("button", { name: "View receipt, Receipt attached, fictional-receipt.pdf" });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 226, clientY: 24, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 226, clientY: 24, pointerId: 1 });
  fireEvent.click(summary, { clientX: 226, clientY: 24, detail: 1 });

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  expect(props.onView).not.toHaveBeenCalled();

  fireEvent.click(summary, { clientX: 180, clientY: 20, detail: 1 });
  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("suppresses the summary release click after a vertical-dominant drag", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const summary = screen.getByRole("button", { name: "View receipt, Receipt attached, fictional-receipt.pdf" });

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 238, clientY: 112, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 238, clientY: 112, pointerId: 1 });
  fireEvent.click(summary, { clientX: 238, clientY: 112, detail: 1 });

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  expect(props.onView).not.toHaveBeenCalled();
});

it("keeps a completed swipe open after its synthetic click and preserves normal Options taps", () => {
  renderRow();
  const options = screen.getByRole("button", { name: "Receipt options" });

  fireEvent.pointerDown(options, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(options, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(options, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.click(options, { clientX: 60, clientY: 20, detail: 1 });

  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
  expect(options).toHaveAttribute("aria-expanded", "true");

  fireEvent.pointerDown(options, { clientX: 250, clientY: 20, pointerId: 2 });
  fireEvent.pointerUp(options, { clientX: 250, clientY: 20, pointerId: 2 });
  fireEvent.click(options, { detail: 1 });

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  expect(options).toHaveAttribute("aria-expanded", "false");
});

it("snaps closed after a short swipe", () => {
  renderRow();
  swipeLeft(screen.getByTestId("receipt-attachment-row"), 47);

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("does not open for vertical-dominant movement", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 220, clientY: 160, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 220, clientY: 160, pointerId: 1 });

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("closes an open tray after a right swipe", () => {
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  swipeLeft(row);
  fireEvent.pointerDown(row, { clientX: 120, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(row, { clientX: 250, clientY: 20, pointerId: 1 });

  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("keeps an active primary swipe when a secondary pointer starts outside the row", async () => {
  const user = userEvent.setup();
  renderRow();
  const row = screen.getByTestId("receipt-attachment-row");
  const options = screen.getByRole("button", { name: "Receipt options" });
  fireEvent.click(options);
  expect(options).toHaveAttribute("aria-expanded", "true");

  fireEvent.pointerDown(row, { clientX: 250, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(row, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerDown(document.body, { clientX: 400, clientY: 20, pointerId: 2 });

  expect(options).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "View" })).toBeVisible();

  fireEvent.pointerUp(row, { clientX: 60, clientY: 20, pointerId: 1 });
  const view = screen.getByRole("button", { name: "View" });
  fireEvent.click(view, { clientX: 60, clientY: 20, detail: 0 });
  expect(props.onView).not.toHaveBeenCalled();

  await user.click(view);
  expect(props.onView).toHaveBeenCalledTimes(1);
});

it("closes an open tray with Escape and outside pointer-down", () => {
  renderRow();
  const options = screen.getByRole("button", { name: "Receipt options" });
  fireEvent.click(options);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();

  fireEvent.click(options);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("moves keyboard focus through the visible tray and returns it to Options on Escape", async () => {
  const user = userEvent.setup();
  renderRow();
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();

  await user.tab();
  expect(screen.getByRole("button", { name: "View receipt, Receipt attached, fictional-receipt.pdf" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Receipt options" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  const options = screen.getByRole("button", { name: "Receipt options" });
  const view = screen.getByRole("button", { name: "View" });
  const change = screen.getByRole("button", { name: "Change" });
  const remove = screen.getByRole("button", { name: "Remove" });

  expect(options).toHaveAttribute("aria-expanded", "true");
  expect(view).toHaveFocus();
  expect(view).toHaveClass("expense-receipt-swipe__action");
  expect(view.closest(".expense-receipt-swipe")).toBe(screen.getByTestId("receipt-attachment-row"));
  expect(globalStyles).toMatch(
    /\.expense-receipt-swipe__action:focus-visible,[\s\S]*?\{[\s\S]*?outline-offset:\s*-3px;[\s\S]*?\}/,
  );

  await user.tab();
  expect(change).toHaveFocus();
  await user.tab();
  expect(remove).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(options).toHaveFocus();
  expect(options).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
});

it("invokes only the matching receipt action", async () => {
  const user = userEvent.setup();
  renderRow();
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "View" }));
  await user.click(screen.getByRole("button", { name: "Change" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));

  expect(props.onView).toHaveBeenCalledTimes(1);
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(props.onRemove).toHaveBeenCalledTimes(1);
  expect(props.onUndo).not.toHaveBeenCalled();
});

it("keeps staged removal explicit and undoable", async () => {
  const user = userEvent.setup();
  renderRow();
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  expect(props.onRemove).toHaveBeenCalledTimes(1);

  cleanup();
  renderRow({ removing: true });
  expect(screen.getByText("Receipt will be removed when you save.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(props.onUndo).toHaveBeenCalledTimes(1);
});

it("disables every available control while busy", async () => {
  const user = userEvent.setup();
  renderRow({ busy: true, removing: true });

  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(props.onUndo).not.toHaveBeenCalled();
});

it("omits unavailable Change and Remove actions", async () => {
  const user = userEvent.setup();
  renderRow({ canChange: false, canRemove: false });
  await user.click(screen.getByRole("button", { name: "Receipt options" }));

  expect(screen.getByRole("button", { name: "View" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
});

it("exposes Add receipt without a swipe tray when no receipt exists", async () => {
  const user = userEvent.setup();
  const focusTargetRef = createRef<HTMLButtonElement>();
  renderRow({ filename: null, focusTargetRef, hasReceipt: false });

  expect(screen.getByText("No receipt added")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Receipt options" })).not.toBeInTheDocument();
  expect(focusTargetRef.current).toBe(screen.getByRole("button", { name: "Add receipt" }));
  await user.click(screen.getByRole("button", { name: "Add receipt" }));
  expect(props.onChange).toHaveBeenCalledTimes(1);
});
