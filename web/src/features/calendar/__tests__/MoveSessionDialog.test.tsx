import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { MoveSessionDialog } from "../MoveSessionDialog";

afterEach(cleanup);

const defaultProps = {
  onCancel: vi.fn(),
  onConfirm: vi.fn().mockResolvedValue(undefined),
  practiceName: "Fictional Willow Practice",
  sessionId: "fictional-session-42",
  sourceDate: "2026-08-11",
  targetDate: "2026-08-12",
  visibleDates: ["2026-08-11", "2026-08-12", "2026-08-13"],
};

it("names the fictional practice and the source and target dates", () => {
  render(<MoveSessionDialog {...defaultProps} />);

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByText("Fictional Willow Practice")).toBeVisible();
  expect(within(dialog).getByText("Tuesday 11 August 2026", { selector: "dd" })).toBeVisible();
  expect(within(dialog).getByText("Wednesday 12 August 2026", { selector: "dd" })).toBeVisible();
});

it("offers Cancel, Move session, and a visible-date picker for keyboard moves", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<MoveSessionDialog {...defaultProps} onConfirm={onConfirm} />);

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  const picker = within(dialog).getByRole("combobox", { name: "Move to date" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Move session" })).toBeVisible();
  expect(within(picker).getAllByRole("option")).toHaveLength(3);
  expect(picker).toHaveValue("2026-08-12");

  await user.selectOptions(picker, "2026-08-13");
  await user.click(within(dialog).getByRole("button", { name: "Move session" }));
  expect(onConfirm).toHaveBeenCalledWith("fictional-session-42", "2026-08-13");
});

it("disables confirmation while saving", async () => {
  const user = userEvent.setup();
  let resolveMove = () => {};
  const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveMove = resolve; }));
  render(<MoveSessionDialog {...defaultProps} onConfirm={onConfirm} />);

  const confirm = screen.getByRole("button", { name: "Move session" });
  await user.click(confirm);
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveAttribute("aria-busy", "true");
  resolveMove();
  await waitFor(() => expect(confirm).toBeEnabled());
});

it("uses a real backdrop that intercepts outside pointers without dismissing", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const onUnderlyingPointer = vi.fn();
  const onUnderlyingClick = vi.fn();
  const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
  render(
    <>
      <button
        onClick={onUnderlyingClick}
        onPointerDown={onUnderlyingPointer}
        type="button"
      >
        Underlying calendar control
      </button>
      <MoveSessionDialog
        {...defaultProps}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </>,
  );

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  expect(dialog.tagName).toBe("SECTION");
  expect(dialog).toHaveClass("session-move-dialog");
  const backdrop = dialog.parentElement;
  expect(backdrop).toHaveClass("session-move-dialog__backdrop");

  fireEvent.pointerDown(backdrop!);
  fireEvent.click(backdrop!);
  expect(onCancel).not.toHaveBeenCalled();
  expect(onUnderlyingPointer).not.toHaveBeenCalled();
  expect(onUnderlyingClick).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole("button", { name: "Move session" }));
  fireEvent.pointerDown(backdrop!);
  fireEvent.click(backdrop!);
  expect(onCancel).not.toHaveBeenCalled();
  expect(onUnderlyingPointer).not.toHaveBeenCalled();
  expect(onUnderlyingClick).not.toHaveBeenCalled();
});

it("ignores dismissal and keeps focus in the dialog while saving", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
  render(
    <MoveSessionDialog
      {...defaultProps}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole("dialog", { name: "Move session" });
  await user.click(screen.getByRole("button", { name: "Move session" }));
  expect(dialog).toHaveAttribute("tabindex", "-1");
  expect(dialog).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(onCancel).not.toHaveBeenCalled();
  await user.tab();
  expect(dialog).toHaveFocus();
});

it("shows the exact generic error and stays open for retry when moving fails", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockRejectedValue(new Error("private backend detail"));
  render(<MoveSessionDialog {...defaultProps} onConfirm={onConfirm} />);

  await user.click(screen.getByRole("button", { name: "Move session" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /^Session could not be moved\. Try again\.$/,
  );
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Move session" }));
  expect(onConfirm).toHaveBeenCalledTimes(2);
});

it("traps focus, closes with Escape, and restores focus when removed", async () => {
  const user = userEvent.setup();
  const opener = document.createElement("button");
  opener.textContent = "Open move dialog";
  document.body.append(opener);
  opener.focus();

  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <MoveSessionDialog {...defaultProps} onCancel={() => setOpen(false)} /> : null;
  }

  const view = render(<Harness />);
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  const picker = within(dialog).getByRole("combobox", { name: "Move to date" });
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  const confirm = within(dialog).getByRole("button", { name: "Move session" });
  expect(cancel).toHaveFocus();

  await user.tab();
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(picker).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(confirm).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();

  view.unmount();
  opener.remove();
});

it("restores a caller-supplied fallback after success removes the opener", async () => {
  const user = userEvent.setup();
  const opener = document.createElement("button");
  opener.textContent = "Move fictional session";
  document.body.append(opener);
  opener.focus();

  function Harness() {
    const [open, setOpen] = useState(true);
    const fallbackFocusRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={fallbackFocusRef} type="button">Calendar fallback</button>
        {open ? (
          <MoveSessionDialog
            {...defaultProps}
            fallbackFocusRef={fallbackFocusRef}
            onConfirm={async () => {
              opener.remove();
              setOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }

  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Move session" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Calendar fallback" })).toHaveFocus();
});
