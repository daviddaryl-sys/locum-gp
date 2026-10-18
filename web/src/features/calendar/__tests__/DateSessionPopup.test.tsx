import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { DateSessionPopup } from "../DateSessionPopup";

afterEach(cleanup);

const sessions = [
  {
    id: "session-planned",
    practiceName: "Fictional Medical Centre",
    startsAt: "2026-08-11T09:00:00.000Z",
    endsAt: "2026-08-11T15:00:00.000Z",
    status: "planned" as const,
    isDemo: false,
  },
];

it("offers add and edit routes for the selected date", () => {
  render(
    <DateSessionPopup
      dateKey="2026-08-11"
      onClose={vi.fn()}
      sessions={sessions}
    />,
  );

  expect(
    screen.getByRole("dialog", { name: "Tuesday 11 August 2026" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Add session" })).toHaveAttribute(
    "href",
    "/sessions/new?date=2026-08-11",
  );
  expect(
    screen.getByRole("link", { name: /Fictional Medical Centre/ }),
  ).toHaveAttribute("href", "/sessions/session-planned");
  expect(screen.getByText("Planned")).toBeVisible();
  expect(screen.queryByText("Demo")).not.toBeInTheDocument();
});

it("shows the visible demo marker for a demo session", () => {
  render(
    <DateSessionPopup
      dateKey="2026-08-11"
      onClose={vi.fn()}
      sessions={[{ ...sessions[0], isDemo: true }]}
    />,
  );

  expect(screen.getByText("Demo")).toBeVisible();
});

it("shows an empty date and closes with the button, backdrop or Escape", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const { container } = render(
    <DateSessionPopup dateKey="2026-08-12" onClose={onClose} sessions={[]} />,
  );

  expect(screen.getByText("No sessions on this date.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(container.querySelector(".session-date-popup__backdrop")!);
  expect(onClose).toHaveBeenCalledTimes(2);
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(3);
});

it("moves focus inside, traps Tab and restores the opener when removed", async () => {
  const user = userEvent.setup();
  const opener = document.createElement("button");
  opener.textContent = "Open popup";
  document.body.append(opener);
  opener.focus();

  const view = render(
    <DateSessionPopup
      dateKey="2026-08-11"
      onClose={vi.fn()}
      sessions={sessions}
    />,
  );
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("link", { name: /Fictional Medical Centre/ })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});
