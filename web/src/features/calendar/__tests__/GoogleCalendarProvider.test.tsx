import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CalendarSyncNotice } from "../CalendarSyncNotice";
import {
  GoogleCalendarProvider,
  useGoogleCalendar,
} from "../GoogleCalendarProvider";
import {
  parseCalendarSyncSummary,
  requestCalendarSync,
} from "../googleCalendarClient";
import type { CalendarSyncSummary } from "../server/calendarRepository";

const CONNECTED: CalendarSyncSummary = {
  state: "connected",
  pendingCount: 0,
  lastSyncAt: "2026-08-05T10:00:00.000Z",
  nextRetryAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function SummaryProbe() {
  const { summary, syncCalendarNow } = useGoogleCalendar();
  return (
    <>
      <output>{`${summary.state}:${summary.pendingCount}`}</output>
      <button onClick={() => void syncCalendarNow()} type="button">Sync Calendar</button>
    </>
  );
}

function renderProvider(input: {
  enabled?: boolean;
  now?: () => Date;
  ownerId?: string;
  transport: () => Promise<CalendarSyncSummary>;
}) {
  return render(
    <GoogleCalendarProvider
      enabled={input.enabled ?? true}
      ownerId={input.ownerId ?? "owner-fixture"}
      now={input.now}
      transport={input.transport}
    >
      <CalendarSyncNotice />
      <SummaryProbe />
    </GoogleCalendarProvider>,
  );
}

describe("Calendar response parsing and private transport", () => {
  it("accepts only a complete sanitized Calendar summary", () => {
    expect(parseCalendarSyncSummary(CONNECTED)).toEqual(CONNECTED);
    expect(() => parseCalendarSyncSummary({ ...CONNECTED, state: "private-provider-state" })).toThrow(
      "Calendar sync is temporarily unavailable.",
    );
    expect(() => parseCalendarSyncSummary({ ...CONNECTED, pendingCount: 0.5 })).toThrow(
      "Calendar sync is temporarily unavailable.",
    );
    expect(() => parseCalendarSyncSummary({ ...CONNECTED, nextRetryAt: "not-a-date" })).toThrow(
      "Calendar sync is temporarily unavailable.",
    );
    for (const invalid of [
      { ...CONNECTED, pendingCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...CONNECTED, lastSyncAt: 0 },
      { ...CONNECTED, lastSyncAt: "2026-02-30T10:00:00.000Z" },
      { ...CONNECTED, lastSyncAt: "2026-08-05T11:00:00.000+01:00" },
      { ...CONNECTED, lastSyncAt: "2026-08-05T10:00:00Z" },
    ]) {
      expect(() => parseCalendarSyncSummary(invalid)).toThrow(
        "Calendar sync is temporarily unavailable.",
      );
    }
  });

  it("uses a private credentialed non-cached POST and sanitizes failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => CONNECTED,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestCalendarSync()).resolves.toEqual(CONNECTED);
    expect(fetchMock).toHaveBeenCalledWith("/api/google-calendar/sync", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "private provider detail" }),
    });
    await expect(requestCalendarSync()).rejects.toThrow(
      "Calendar sync is temporarily unavailable.",
    );

    fetchMock.mockRejectedValueOnce(new Error("private network detail"));
    await expect(requestCalendarSync()).rejects.toThrow(
      "Calendar sync is temporarily unavailable.",
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error("private JSON detail"); },
    });
    await expect(requestCalendarSync()).rejects.toThrow(
      "Calendar sync is temporarily unavailable.",
    );
  });
});

describe("GoogleCalendarProvider", () => {
  it("starts in loading and applies the first confirmed summary", async () => {
    const initial = deferred<CalendarSyncSummary>();
    const transport = vi.fn(() => initial.promise);
    renderProvider({ transport });
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(screen.getByText("loading:0")).toBeVisible();
    initial.resolve(CONNECTED);
    expect(await screen.findByText("connected:0")).toBeVisible();
  });

  it("marks only an initial failure unavailable and allows retry", async () => {
    const transport = vi
      .fn<() => Promise<CalendarSyncSummary>>()
      .mockRejectedValueOnce(new Error("private provider detail"))
      .mockResolvedValueOnce(CONNECTED);
    renderProvider({ transport });
    expect(await screen.findByText("unavailable:0")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sync Calendar" }));
    expect(await screen.findByText("connected:0")).toBeVisible();
  });

  it("retries pending work at the server-provided time", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        state: "pending",
        pendingCount: 1,
        lastSyncAt: null,
        nextRetryAt: "2026-08-05T10:00:30.000Z",
      })
      .mockResolvedValueOnce({
        state: "connected",
        pendingCount: 0,
        lastSyncAt: "2026-08-05T10:00:30.000Z",
        nextRetryAt: null,
      });
    renderProvider({
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      transport,
    });

    await act(async () => {});
    expect(transport).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Calendar sync pending" })).toBeVisible();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Calendar sync pending")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no work while disabled", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => CONNECTED);
    renderProvider({ enabled: false, transport });
    await act(async () => {});
    expect(transport).not.toHaveBeenCalled();
    expect(screen.getByText("disabled:0")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["not_connected", "reconnect_required"] as const)(
    "does not schedule a retry for %s",
    async (state) => {
      vi.useFakeTimers();
      const transport = vi.fn(async () => ({
        state,
        pendingCount: 0,
        lastSyncAt: null,
        nextRetryAt: "2026-08-05T10:00:30.000Z",
      }));
      renderProvider({
        now: () => new Date("2026-08-05T10:00:00.000Z"),
        transport,
      });
      await act(async () => {});
      expect(transport).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retries when the browser comes online", async () => {
    const transport = vi.fn(async () => CONNECTED);
    renderProvider({ transport });
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  });

  it("does not transport offline and retries on the next online event", async () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const transport = vi.fn(async () => CONNECTED);
    renderProvider({ transport });
    await act(async () => {});
    expect(transport).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  });

  it("serializes initial, explicit, and online requests with one trailing rerun", async () => {
    const initial = deferred<CalendarSyncSummary>();
    const trailing = deferred<CalendarSyncSummary>();
    const transport = vi
      .fn<() => Promise<CalendarSyncSummary>>()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(trailing.promise);
    renderProvider({ transport });
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Sync Calendar" }));
    window.dispatchEvent(new Event("online"));
    expect(transport).toHaveBeenCalledOnce();

    initial.resolve({ ...CONNECTED, pendingCount: 7 });
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    trailing.resolve(CONNECTED);
    expect(await screen.findByText("connected:0")).toBeVisible();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not lose a retry requested while an explicit sync is in flight", async () => {
    vi.useFakeTimers();
    const explicit = deferred<CalendarSyncSummary>();
    const trailing = deferred<CalendarSyncSummary>();
    const transport = vi
      .fn<() => Promise<CalendarSyncSummary>>()
      .mockResolvedValueOnce({
        state: "pending",
        pendingCount: 3,
        lastSyncAt: null,
        nextRetryAt: "2026-08-05T10:00:30.000Z",
      })
      .mockReturnValueOnce(explicit.promise)
      .mockReturnValueOnce(trailing.promise);
    renderProvider({
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      transport,
    });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Sync Calendar" }));
    expect(transport).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    window.dispatchEvent(new Event("online"));
    expect(transport).toHaveBeenCalledTimes(2);

    explicit.resolve({ ...CONNECTED, pendingCount: 2 });
    await act(async () => {});
    expect(transport).toHaveBeenCalledTimes(3);
    trailing.resolve(CONNECTED);
    await act(async () => {});
    expect(screen.getByText("connected:0")).toBeVisible();
  });

  it("attempts an immediate retry timestamp only once", async () => {
    vi.useFakeTimers();
    const pending: CalendarSyncSummary = {
      state: "pending",
      pendingCount: 1,
      lastSyncAt: null,
      nextRetryAt: "2026-08-05T10:00:00.000Z",
    };
    const transport = vi.fn(async () => ({ ...pending }));
    renderProvider({
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      transport,
    });
    await act(async () => {});
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its one retry timer on unmount", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => ({
      state: "pending" as const,
      pendingCount: 1,
      lastSyncAt: null,
      nextRetryAt: "2026-08-05T10:00:30.000Z",
    }));
    const view = renderProvider({
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      transport,
    });
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a queued initial request when unmounted before its microtask", async () => {
    const transport = vi.fn(async () => CONNECTED);
    const view = renderProvider({ transport });
    view.unmount();
    await act(async () => {});
    expect(transport).not.toHaveBeenCalled();
  });

  it("discards prior state and timers when the owner changes", async () => {
    vi.useFakeTimers();
    const ownerA = deferred<CalendarSyncSummary>();
    const transportA = vi.fn(() => ownerA.promise);
    const transportB = vi.fn(async () => CONNECTED);
    const view = renderProvider({
      now: () => new Date("2026-08-05T10:00:00.000Z"),
      ownerId: "owner-a",
      transport: transportA,
    });
    await act(async () => {});
    expect(screen.getByText("loading:0")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);

    view.rerender(
      <GoogleCalendarProvider
        enabled
        now={() => new Date("2026-08-05T10:00:00.000Z")}
        ownerId="owner-b"
        transport={transportB}
      >
        <CalendarSyncNotice />
        <SummaryProbe />
      </GoogleCalendarProvider>,
    );
    await act(async () => {});
    expect(transportB).toHaveBeenCalledOnce();
    expect(screen.getByText("connected:0")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);

    ownerA.resolve({
      state: "pending",
      pendingCount: 4,
      lastSyncAt: null,
      nextRetryAt: "2026-08-05T10:00:30.000Z",
    });
    await act(async () => {});
    expect(screen.getByText("connected:0")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(transportA).toHaveBeenCalledOnce();
  });
});
