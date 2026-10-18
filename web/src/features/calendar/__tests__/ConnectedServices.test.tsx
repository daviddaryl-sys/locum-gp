import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ConnectedServices } from "../ConnectedServices";
import { GoogleCalendarProvider } from "../GoogleCalendarProvider";
import type { CalendarSyncSummary } from "../server/calendarRepository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function renderConnectedServices(input: {
  callbackError?: boolean;
  enabled?: boolean;
  transport?: () => Promise<CalendarSyncSummary>;
}) {
  const enabled = input.enabled ?? true;
  const transport = input.transport ?? vi.fn(async (): Promise<CalendarSyncSummary> => ({
    state: "not_connected",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  }));
  const view = render(
    <GoogleCalendarProvider
      enabled={enabled}
      ownerId="owner-fixture"
      transport={transport}
    >
      <ConnectedServices
        callbackError={input.callbackError}
        enabled={enabled}
      />
    </GoogleCalendarProvider>,
  );
  return { ...view, transport };
}

function calendarTransport(summary: CalendarSyncSummary) {
  return vi.fn(async (): Promise<CalendarSyncSummary> => summary);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

it("shows a disabled state without requesting Calendar status", () => {
  const transport = vi.fn();
  renderConnectedServices({ enabled: false, transport });
  expect(screen.getByText(/not available/i)).toBeVisible();
  expect(transport).not.toHaveBeenCalled();
});

it("shows loading without false connection controls until status is confirmed", async () => {
  const initial = deferred<CalendarSyncSummary>();
  renderConnectedServices({ transport: vi.fn(() => initial.promise) });
  expect(await screen.findByText(/Checking Google Calendar connection/i)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Connect|Disconnect/i })).toBeNull();
  initial.resolve({
    state: "not_connected",
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  expect(await screen.findByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
});

it("shows generic unavailable retry without false connection controls", async () => {
  const transport = vi
    .fn<() => Promise<CalendarSyncSummary>>()
    .mockRejectedValueOnce(new Error("private status detail"))
    .mockResolvedValueOnce({
      state: "not_connected",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    });
  const user = userEvent.setup();
  renderConnectedServices({ transport });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Google Calendar status is temporarily unavailable.",
  );
  expect(screen.queryByRole("button", { name: /Connect|Disconnect Google/i })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
});

it("consumes shared state without a duplicate status request", async () => {
  const transport = calendarTransport({
    state: "not_connected" as const,
    pendingCount: 0,
    lastSyncAt: null,
    nextRetryAt: null,
  });
  const { container } = renderConnectedServices({ transport });

  expect(await screen.findByText(/only your practice name/i)).toBeVisible();
  expect(screen.getByText(/Google does not become the source of truth/i)).toBeVisible();
  const button = screen.getByRole("button", { name: "Connect Google Calendar" });
  const form = button.closest("form");
  expect(form).toHaveAttribute("action", "/api/google-calendar/connect");
  expect(form).toHaveAttribute("method", "post");
  expect(container.textContent).not.toMatch(/token|calendar id|event id/i);
  expect(transport).toHaveBeenCalledOnce();
});

it("shows the approved connected projection and automatic behavior", async () => {
  renderConnectedServices({
    transport: calendarTransport({
      state: "connected",
      pendingCount: 0,
      lastSyncAt: "2026-08-05T10:00:00.000Z",
      nextRetryAt: null,
    }),
  });
  expect(await screen.findByText("Locum Manager → Google")).toBeVisible();
  expect(screen.getByText("Automatic")).toBeVisible();
  expect(screen.getByText(/practice name/i)).toBeVisible();
  expect(screen.getByText(/start and end time/i)).toBeVisible();
  expect(screen.getByText(/practice address/i)).toBeVisible();
  expect(screen.getByText(/session status/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  expect(screen.getByText(/Last synced.*5 Aug 2026.*11:00/i)).toBeVisible();
});

it("announces a pending state", async () => {
  renderConnectedServices({
    transport: calendarTransport({
      state: "pending",
      pendingCount: 2,
      lastSyncAt: null,
      nextRetryAt: null,
    }),
  });
  expect(await screen.findByText(/Sync pending for 2 sessions/i)).toHaveAttribute(
    "role",
    "status",
  );
});

it("alerts reconnect-required and offers the exact reconnect control", async () => {
  renderConnectedServices({
    transport: calendarTransport({
      state: "reconnect_required",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    }),
  });
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: "Reconnect Google Calendar" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
});

it("refreshes shared state after a confirmed disconnect", async () => {
  const user = userEvent.setup();
  const transport = vi
    .fn<() => Promise<CalendarSyncSummary>>()
    .mockResolvedValueOnce({
      state: "connected",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    })
    .mockResolvedValueOnce({
      state: "not_connected",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderConnectedServices({ transport });

  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/google-calendar/disconnect",
    { method: "POST", credentials: "include" },
  );
  expect(await screen.findByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
  expect(transport).toHaveBeenCalledTimes(2);
});

it("consumes the fixed callback error into a generic visible alert", async () => {
  renderConnectedServices({ callbackError: true });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Google Calendar connection could not be completed.",
  );
  expect(document.body.textContent).not.toMatch(/code|state|provider/i);
});

it("shows only a generic disconnect failure", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "private provider body" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderConnectedServices({
    transport: calendarTransport({
      state: "connected",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    }),
  });
  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Google Calendar could not be disconnected.",
  );
  expect(document.body.textContent).not.toContain("private provider body");
});

it("does not disconnect when confirmation is declined", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  renderConnectedServices({
    transport: calendarTransport({
      state: "connected",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    }),
  });
  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(fetchMock).not.toHaveBeenCalled();
});
