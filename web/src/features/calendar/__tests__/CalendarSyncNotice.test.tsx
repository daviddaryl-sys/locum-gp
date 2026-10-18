import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CalendarSyncNotice } from "../CalendarSyncNotice";
import { GoogleCalendarProvider } from "../GoogleCalendarProvider";
import type { CalendarSyncSummary } from "../server/calendarRepository";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderNotice(summary: CalendarSyncSummary, enabled = true) {
  return render(
    <GoogleCalendarProvider
      enabled={enabled}
      ownerId="owner-fixture"
      transport={vi.fn(async () => summary)}
    >
      <CalendarSyncNotice />
    </GoogleCalendarProvider>,
  );
}

it("stays disabled and inert when rendered outside the authenticated layout", () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<CalendarSyncNotice />);
  expect(view.container).toBeEmptyDOMElement();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["disabled", "not_connected", "connected"] as const)(
  "renders nothing for %s",
  async (state) => {
    const view = renderNotice(
      { state, pendingCount: 0, lastSyncAt: null, nextRetryAt: null },
      state !== "disabled",
    );
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  },
);

it("renders a compact pending link to Connected services", async () => {
  renderNotice({
    state: "pending",
    pendingCount: 2,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  const link = await screen.findByRole("link", { name: "Calendar sync pending" });
  expect(link).toHaveAttribute("href", "/settings/connected-services");
  expect(link.closest('[role="status"]')).toHaveAttribute("aria-live", "polite");
});

it("renders a reconnect link without provider detail", async () => {
  renderNotice({
    state: "reconnect_required",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  const link = await screen.findByRole("link", { name: "Reconnect Google Calendar" });
  expect(link).toHaveAttribute("href", "/settings/connected-services");
  expect(link.closest('[role="alert"]')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/token|credential|provider/i);
});
