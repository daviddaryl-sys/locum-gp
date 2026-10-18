import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const surface = vi.hoisted(() => ({
  records: {} as Record<string, unknown[]>,
  syncNow: vi.fn(),
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecords: (recordType: string) => surface.records[recordType] ?? [],
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({ syncNow: surface.syncNow }),
}));

import { DemoModeBanner, DemoModeSurface } from "@/features/demo/DemoModeBanner";

afterEach(cleanup);
beforeEach(() => {
  surface.records = {};
  surface.syncNow.mockReset().mockResolvedValue(undefined);
});

describe("DemoModeBanner", () => {
  it("confirms the exact cleanup scope and supports Cancel", async () => {
    const user = userEvent.setup();
    render(<DemoModeBanner onDelete={vi.fn()} visible />);
    expect(screen.getByText("Demo Mode")).toBeVisible();
    expect(screen.getByLabelText("Demo Mode")).toHaveAttribute("id", "demo-controls");

    await user.click(screen.getByRole("button", { name: "Delete all demo data" }));
    const dialog = screen.getByRole("dialog", { name: "Delete all demo data?" });
    expect(within(dialog).getByText("Your real practices, sessions, invoices, expenses, categories, and receipts will be kept.")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps focus, closes with Escape, and returns focus to its opener", async () => {
    const user = userEvent.setup();
    render(<DemoModeBanner onDelete={vi.fn()} visible />);
    const opener = screen.getByRole("button", { name: "Delete all demo data" });

    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Delete all demo data?" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Delete all demo data" });
    expect(dialog).toHaveFocus();

    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(confirm).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("disables deletion while busy and dismisses after local demo data disappears", async () => {
    const user = userEvent.setup();
    let resolveDelete = () => {};
    const onDelete = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve; }));
    const view = render(<DemoModeBanner onDelete={onDelete} visible />);
    await user.click(screen.getByRole("button", { name: "Delete all demo data" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: /Delete all demo data/ });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    resolveDelete();
    view.rerender(<DemoModeBanner onDelete={onDelete} visible={false} />);
    expect(screen.queryByText("Demo Mode")).not.toBeInTheDocument();
  });

  it("keeps focus in the dialog while every action is busy", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(() => new Promise<void>(() => undefined));
    render(<DemoModeBanner onDelete={onDelete} visible />);
    await user.click(screen.getByRole("button", { name: "Delete all demo data" }));
    const dialog = screen.getByRole("dialog", { name: "Delete all demo data?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete all demo data" }));

    await user.keyboard("{Tab}");
    expect(dialog).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog).toHaveFocus();
  });

  it("shows a retryable error", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("temporary"));
    render(<DemoModeBanner onDelete={onDelete} visible />);
    await user.click(screen.getByRole("button", { name: "Delete all demo data" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all demo data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Demo data could not be deleted. Please try again.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all demo data" }));
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it("is global only while an active local demo record remains and synchronizes cleanup", async () => {
    const user = userEvent.setup();
    surface.records.practices = [{ data: { isDemo: true } }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const view = render(<DemoModeSurface />);
    expect(screen.getByText("Demo Mode")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete all demo data" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete all demo data" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/demo-data", expect.objectContaining({ method: "DELETE" }));
    expect(surface.syncNow).toHaveBeenCalledOnce();

    surface.records.practices = [];
    view.rerender(<DemoModeSurface />);
    expect(screen.queryByText("Demo Mode")).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });
});
