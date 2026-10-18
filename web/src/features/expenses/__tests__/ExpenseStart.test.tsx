import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { transformRecordAtomically, useOfflineRecordsMock } = vi.hoisted(() => ({
  transformRecordAtomically: vi.fn(),
  useOfflineRecordsMock: vi.fn(),
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecords: useOfflineRecordsMock,
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({
    markSaving: vi.fn(),
    ready: true,
    repository: {
      ownerId: "owner-a",
      transformRecordAtomically,
    },
    syncNow: vi.fn(),
  }),
}));

import { ExpenseStart } from "../ExpenseStart";

afterEach(() => {
  cleanup();
  transformRecordAtomically.mockReset();
  useOfflineRecordsMock.mockReset();
});

it("shows three touch-friendly expense routes with plain-language guidance", () => {
  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "gp" } } },
  ]);

  render(<ExpenseStart />);

  expect(screen.getByRole("heading", { name: "How would you like to add this expense?" })).toBeInTheDocument();
  const scan = screen.getByRole("link", { name: /Scan a receipt/i });
  const manual = screen.getByRole("link", { name: /Add it myself/i });
  const mileage = screen.getByRole("link", { name: /Add mileage/i });

  expect(scan).toHaveAttribute("href", "/expenses/new/scan");
  expect(manual).toHaveAttribute("href", "/expenses/new/manual");
  expect(mileage).toHaveAttribute("href", "/expenses/new/mileage");
  expect(scan).toHaveTextContent("Recommended");
  expect(scan).toHaveClass("expense-start__card--primary");
  expect(scan).toHaveClass("expense-start__card");
  expect(manual).toHaveClass("expense-start__card");
  expect(mileage).toHaveClass("expense-start__card");
  expect(screen.getByText("Use a photo and check the suggested details.")).toBeInTheDocument();
  expect(screen.getByText("Type the details in yourself.")).toBeInTheDocument();
  expect(screen.getByText("Record a work journey and the mileage amount.")).toBeInTheDocument();
  expect(screen.getByText("Choose the easiest way to add this work cost.")).toBeInTheDocument();
  expect(screen.getByTestId("expense-entry-methods")).toHaveClass("expense-start__grid");
  expect(screen.queryByRole("link", { name: /^Add expense$/i })).not.toBeInTheDocument();
});

it("requires an explicit profession choice for a legacy profile before revealing expense routes", async () => {
  useOfflineRecordsMock.mockReturnValue([
    { id: "settings-a", data: { profile: { displayName: "Example Locum" }, vault: { encrypted: true } } },
  ]);
  transformRecordAtomically.mockImplementation(async (_table, _id, transform) => {
    expect(transform({ data: { profile: { displayName: "Example Locum" }, vault: { encrypted: true } } })).toEqual({
      profile: { displayName: "Example Locum", profession: "pharmacist" },
      vault: { encrypted: true },
    });
  });

  render(<ExpenseStart />);

  expect(screen.getByRole("heading", { name: "Choose your profession" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Scan a receipt/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Pharmacist"));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

  await waitFor(() => expect(transformRecordAtomically).toHaveBeenCalledWith(
    "settings",
    "settings-a",
    expect.any(Function),
  ));
  expect(await screen.findByRole("status")).toHaveTextContent("Profession saved");
  expect(screen.getByRole("link", { name: /Scan a receipt/i })).toBeInTheDocument();
});

it("does not silently choose GP for a legacy profile", () => {
  useOfflineRecordsMock.mockReturnValue([]);
  render(<ExpenseStart />);

  expect(screen.getByLabelText("GP")).not.toBeChecked();
  expect(screen.getByLabelText("Pharmacist")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
});

it("reveals routes when a synced profession arrives after the first render", () => {
  useOfflineRecordsMock.mockReturnValue([]);
  const view = render(<ExpenseStart />);
  expect(screen.getByRole("heading", { name: "Choose your profession" })).toBeInTheDocument();

  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "gp" } } },
  ]);
  view.rerender(<ExpenseStart />);

  expect(screen.getByText("Using GP expense categories.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Scan a receipt/i })).toBeInTheDocument();
});

it("reconciles a remote profession change while the local choice is clean", () => {
  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "gp" } } },
  ]);
  const view = render(<ExpenseStart />);
  expect(screen.getByText("Using GP expense categories.")).toBeInTheDocument();

  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "pharmacist" } } },
  ]);
  view.rerender(<ExpenseStart />);

  expect(screen.getByText("Using Pharmacist expense categories.")).toBeInTheDocument();
});

it("does not clobber or reveal an unsaved local profession when a live update arrives", () => {
  useOfflineRecordsMock.mockReturnValue([]);
  const view = render(<ExpenseStart />);
  fireEvent.click(screen.getByLabelText("GP"));

  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "pharmacist" } } },
  ]);
  view.rerender(<ExpenseStart />);

  expect(screen.getByLabelText("GP")).toBeChecked();
  expect(screen.getByLabelText("Pharmacist")).not.toBeChecked();
  expect(screen.queryByRole("link", { name: /Scan a receipt/i })).not.toBeInTheDocument();
});

it("resumes canonical reconciliation after a successful profession save", async () => {
  useOfflineRecordsMock.mockReturnValue([]);
  transformRecordAtomically.mockResolvedValue(undefined);
  const view = render(<ExpenseStart />);
  fireEvent.click(screen.getByLabelText("GP"));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByText("Using GP expense categories.")).toBeInTheDocument();

  useOfflineRecordsMock.mockReturnValue([
    { id: "owner-a", data: { profile: { profession: "pharmacist" } } },
  ]);
  view.rerender(<ExpenseStart />);

  expect(screen.getByText("Using Pharmacist expense categories.")).toBeInTheDocument();
});
