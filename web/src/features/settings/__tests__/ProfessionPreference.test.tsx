import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfessionPreference } from "../ProfessionPreference";

const mocks = vi.hoisted(() => ({
  markSaving: vi.fn(),
  transformRecordAtomically: vi.fn(),
  syncNow: vi.fn(),
  records: [
    {
      id: "settings-1",
      data: {
        profile: {
          doctorName: "Dr Alex Example",
          email: "alex@example.test",
        },
        invoicePrefix: "INV",
        ciphertext: "encrypted-vault",
        salt: "vault-salt",
      },
    },
  ] as Array<{ id: string; data: Record<string, unknown> }> | undefined,
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecords: () => mocks.records,
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({
    markSaving: mocks.markSaving,
    ready: true,
    repository: {
      ownerId: "owner-1",
      transformRecordAtomically: mocks.transformRecordAtomically,
    },
    syncNow: mocks.syncNow,
  }),
}));

beforeEach(() => {
  mocks.transformRecordAtomically.mockImplementation(
    async (_recordType, _id, transform) =>
      transform({
        id: mocks.records?.[0]?.id ?? "settings-1",
        data: mocks.records?.[0]?.data ?? {},
      }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.records = [
    {
      id: "settings-1",
      data: {
        profile: {
          doctorName: "Dr Alex Example",
          email: "alex@example.test",
        },
        invoicePrefix: "INV",
        ciphertext: "encrypted-vault",
        salt: "vault-salt",
      },
    },
  ];
});

describe("ProfessionPreference", () => {
  it("offers GP and Pharmacist without assuming a legacy profession", () => {
    render(<ProfessionPreference />);

    expect(screen.getByRole("radio", { name: "GP" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Pharmacist" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save profession" })).toBeDisabled();
  });

  it("saves only the profession without requesting payment details or a vault passcode", async () => {
    const user = userEvent.setup();
    mocks.syncNow.mockResolvedValue(undefined);
    render(<ProfessionPreference />);

    expect(screen.queryByLabelText(/account name/i)).toBeNull();
    expect(screen.queryByLabelText(/vault passcode/i)).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Pharmacist" }));
    await user.click(screen.getByRole("button", { name: "Save profession" }));

    expect(mocks.transformRecordAtomically).toHaveBeenCalledWith(
      "settings",
      "settings-1",
      expect.any(Function),
    );
    const transform = mocks.transformRecordAtomically.mock.calls[0][2];
    expect(transform({ data: mocks.records?.[0]?.data })).toEqual({
      profile: {
        doctorName: "Dr Alex Example",
        email: "alex@example.test",
        profession: "pharmacist",
      },
      invoicePrefix: "INV",
      ciphertext: "encrypted-vault",
      salt: "vault-salt",
    });
    expect(mocks.markSaving).toHaveBeenCalledOnce();
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Profession saved.",
    );
  });

  it("shows the saved profession and exposes save errors accessibly", async () => {
    const user = userEvent.setup();
    mocks.records = [
      {
        id: "settings-1",
        data: {
          profile: { profession: "gp" },
          ciphertext: "encrypted-vault",
        },
      },
    ];
    mocks.transformRecordAtomically.mockRejectedValue(new Error("storage failed"));
    render(<ProfessionPreference />);

    expect(screen.getByRole("radio", { name: "GP" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Pharmacist" }));
    await user.click(screen.getByRole("button", { name: "Save profession" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Profession could not be saved. Please try again.",
    );
    expect(mocks.markSaving).not.toHaveBeenCalled();
  });

  it("shows an accessible preparation status while settings load", () => {
    mocks.records = undefined;
    render(<ProfessionPreference />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparing profession settings",
    );
  });

  it("reconciles live persisted changes when the selection is not locally edited", async () => {
    mocks.records = [];
    const { rerender } = render(<ProfessionPreference />);
    expect(screen.getByRole("radio", { name: "GP" })).not.toBeChecked();

    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "gp" } },
      },
    ];
    rerender(<ProfessionPreference />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "GP" })).toBeChecked(),
    );

    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "pharmacist" } },
      },
    ];
    rerender(<ProfessionPreference />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Pharmacist" })).toBeChecked(),
    );
  });

  it("protects an unsaved edit, then resumes reconciliation after saving", async () => {
    const user = userEvent.setup();
    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "gp" } },
      },
    ];
    const { rerender } = render(<ProfessionPreference />);

    await user.click(screen.getByRole("radio", { name: "Pharmacist" }));
    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "gp", doctorName: "Synced Name" } },
      },
    ];
    rerender(<ProfessionPreference />);
    expect(screen.getByRole("radio", { name: "Pharmacist" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save profession" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Profession saved.");
    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "pharmacist" } },
      },
    ];
    rerender(<ProfessionPreference />);

    mocks.records = [
      {
        id: "settings-1",
        data: { profile: { profession: "gp" } },
      },
    ];
    rerender(<ProfessionPreference />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "GP" })).toBeChecked(),
    );
  });
});
