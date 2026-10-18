import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const records = vi.hoisted(() => ({
  practices: [] as Array<Record<string, unknown>>,
  sessions: undefined as Array<Record<string, unknown>> | undefined,
}));

const sync = vi.hoisted(() => ({
  initializationError: false,
  markSaving: vi.fn(),
  ready: true,
  syncNow: vi.fn(),
  transformRecordAtomically: vi.fn(),
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecord: vi.fn(),
  useOfflineRecords: (recordType: keyof typeof records) => records[recordType],
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({
    initializationError: sync.initializationError,
    markSaving: sync.markSaving,
    ready: sync.ready,
    repository: sync.ready ? {
      transformRecordAtomically: sync.transformRecordAtomically,
    } : null,
    syncNow: sync.syncNow,
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { filterSessionEntries, parseSessionData, SessionList } from "@/features/sessions/SessionViews";

const sessionData = {
  practiceId: "practice-1",
  startsAt: "2026-08-12T08:00:00.000Z",
  endsAt: "2026-08-12T12:30:00.000Z",
  hourlyRatePence: 6500,
  status: "planned",
  notes: "Demo — morning clinic",
  isDemo: true,
  payloadVersion: 3,
  calendarProjection: { provider: "google", sequence: 7 },
};

function localSession(data: Record<string, unknown> = sessionData) {
  return {
    ownerId: "owner-1",
    id: "session-1",
    recordType: "sessions",
    data,
    localRevision: 4,
    serverRevision: 3,
    syncState: "synced",
    updatedAt: "2026-08-11T12:00:00.000Z",
    deletedAt: null,
  };
}

async function openMoveDialog() {
  localStorage.setItem("locum-manager:sessions-view", "calendar");
  records.sessions = [localSession()];
  const view = render(createElement(SessionList));
  await waitFor(() => expect(screen.getByRole("button", { name: "Move session" })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Move session" }));
  expect(screen.getByRole("dialog", { name: "Move session" })).toBeInTheDocument();
  return view;
}

async function confirmMove(targetDate = "2026-08-13") {
  const dialog = screen.getByRole("dialog", { name: "Move session" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Move to date"), targetDate);
  await userEvent.click(within(dialog).getByRole("button", { name: "Move session" }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
  sync.markSaving.mockReset();
  sync.ready = true;
  sync.syncNow.mockReset().mockResolvedValue(undefined);
  sync.transformRecordAtomically.mockReset().mockImplementation(async (
    _recordType,
    _id,
    transform,
  ) => {
    const current = records.sessions?.[0];
    const data = transform(current);
    records.sessions = [localSession(data)];
    return { record: records.sessions[0], mutation: {} };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  records.practices = [];
  records.sessions = [];
});

describe("parseSessionData", () => {
  it("normalizes the server default nullable notes field", () => {
    expect(
      parseSessionData({
        practiceId: "practice-1",
        startsAt: "2026-08-12T08:00:00.000Z",
        endsAt: "2026-08-12T12:00:00.000Z",
        hourlyRatePence: 6500,
        status: "planned",
        notes: null,
      }),
    ).toEqual({
      practiceId: "practice-1",
      startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T12:00:00.000Z",
      hourlyRatePence: 6500,
      status: "planned",
      notes: "",
    });
  });
});

it("filters ready-to-invoice and upcoming sessions", () => {
  const entries = [
    { data: { status: "completed", startsAt: "2026-08-01T08:00:00.000Z" } },
    { data: { status: "planned", startsAt: "2026-08-03T08:00:00.000Z" } },
  ] as never;
  expect(filterSessionEntries(entries, "ready-to-invoice", new Date("2026-08-02T12:00:00Z"))).toHaveLength(1);
  expect(filterSessionEntries(entries, "upcoming", new Date("2026-08-02T12:00:00Z"))).toHaveLength(1);
  expect(filterSessionEntries(entries, "unknown", new Date("2026-08-02T12:00:00Z"))).toHaveLength(2);
});

it("defaults to List, switches to Calendar, and remembers the local choice", async () => {
  const user = userEvent.setup();
  localStorage.clear();
  render(createElement(SessionList));
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem("locum-manager:sessions-view")).toBe("calendar");
  expect(screen.queryByLabelText("Status")).toBeNull();
});

it("restores a saved Calendar choice after the local effect runs", async () => {
  localStorage.setItem("locum-manager:sessions-view", "calendar");
  render(createElement(SessionList));
  await waitFor(() => expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true"));
  expect(screen.queryByLabelText("Status")).toBeNull();
});

it("shows the friendly zero state when no sessions have been added yet", () => {
  records.sessions = [];
  render(createElement(SessionList));

  expect(screen.getByText("No sessions yet. Add the work you did.")).toBeVisible();
});

it("does not show the empty state while sessions are still loading", () => {
  records.sessions = undefined;
  render(createElement(SessionList));

  expect(screen.queryByText("No sessions yet. Add the work you did.")).toBeNull();
});

it("shows a readable list summary for each saved session", async () => {
  records.practices = [{
    id: "practice-1",
    recordType: "practices",
    data: {
      name: "Springfield Medical Centre",
      defaultHourlyRatePence: 6500,
      archived: false,
    },
    ownerId: "owner-1",
    localRevision: 1,
    serverRevision: 1,
    syncState: "synced",
    updatedAt: "2026-08-10T12:00:00.000Z",
    deletedAt: null,
  }];
  records.sessions = [localSession()];

  render(createElement(SessionList));

  expect(screen.getByRole("link", { name: /Springfield Medical Centre/i })).toBeVisible();
  expect(screen.getByText("12 Aug 2026, 09:00")).toBeVisible();
  expect(screen.getByText("4.5 hours · £292.50")).toBeVisible();
  expect(screen.getByText("planned")).toBeVisible();
});

describe("calendar session date moves", () => {
  it("reloads and saves the complete latest payload with only its London instants changed", async () => {
    const latestData = {
      ...sessionData,
      notes: "Demo — updated elsewhere",
      payloadVersion: 4,
      unrelated: { nested: ["preserve", 42] },
    };
    let savedPayload: Record<string, unknown> | undefined;
    sync.transformRecordAtomically.mockImplementation(async (
      _recordType,
      _id,
      transform,
    ) => {
      savedPayload = transform(localSession(latestData));
      records.sessions = [localSession(savedPayload)];
      return { record: records.sessions[0], mutation: {} };
    });

    const view = await openMoveDialog();
    await confirmMove();

    await waitFor(() => expect(sync.transformRecordAtomically).toHaveBeenCalledWith(
      "sessions",
      "session-1",
      expect.any(Function),
    ));
    expect(savedPayload).toEqual({
      ...latestData,
      startsAt: "2026-08-13T08:00:00.000Z",
      endsAt: "2026-08-13T12:30:00.000Z",
    });
    expect(sync.transformRecordAtomically.mock.invocationCallOrder[0]).toBeLessThan(sync.markSaving.mock.invocationCallOrder[0]);
    expect(sync.markSaving.mock.invocationCallOrder[0]).toBeLessThan(sync.syncNow.mock.invocationCallOrder[0]);
    expect(sync.markSaving).toHaveBeenCalledOnce();
    expect(sync.syncNow).toHaveBeenCalledOnce();

    view.rerender(createElement(SessionList));
    expect(screen.getByRole("button", { name: "Wednesday 12 August 2026, 0 sessions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thursday 13 August 2026, 1 session" })).toBeInTheDocument();
  });

  it("keeps a successful local move closed when background sync rejects", async () => {
    sync.syncNow.mockRejectedValue(new Error("offline sync failure"));

    await openMoveDialog();
    await confirmMove();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move session" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sync.transformRecordAtomically).toHaveBeenCalledOnce();
    expect(sync.markSaving).toHaveBeenCalledOnce();
    expect(sync.syncNow).toHaveBeenCalledOnce();
  });

  it.each([
    ["offline storage is not ready", () => { sync.ready = false; }],
    ["the latest record is missing", () => { sync.transformRecordAtomically.mockImplementation(async (_type, _id, transform) => transform(undefined)); }],
    ["the latest record was deleted", () => { sync.transformRecordAtomically.mockImplementation(async (_type, _id, transform) => transform({ ...localSession(), deletedAt: "2026-08-12T12:05:00.000Z" })); }],
    ["the latest record is invalid", () => { sync.transformRecordAtomically.mockImplementation(async (_type, _id, transform) => transform(localSession({ ...sessionData, startsAt: 42 }))); }],
    ["the latest record has become invoiced", () => { sync.transformRecordAtomically.mockImplementation(async (_type, _id, transform) => transform(localSession({ ...sessionData, status: "invoiced" }))); }],
  ])("shows a generic error and does not complete a move when %s", async (_label, arrange) => {
    arrange();
    await openMoveDialog();
    await confirmMove();

    expect(await screen.findByRole("alert")).toHaveTextContent("Session could not be moved. Try again.");
    expect(sync.markSaving).not.toHaveBeenCalled();
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  it("keeps the rendered session on its original date when the repository save fails", async () => {
    sync.transformRecordAtomically.mockRejectedValue(new Error("private repository detail"));

    await openMoveDialog();
    await confirmMove();

    expect(await screen.findByRole("alert")).toHaveTextContent("Session could not be moved. Try again.");
    expect(screen.getByText("09:00–13:30")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /12 August 2026/ })).toBeInTheDocument();
    expect(sync.markSaving).not.toHaveBeenCalled();
    expect(sync.syncNow).not.toHaveBeenCalled();
  });
});
