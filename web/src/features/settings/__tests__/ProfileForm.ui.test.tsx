import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ProfileForm } from "@/features/settings/ProfileForm";

const mocks = vi.hoisted(() => ({
  ownerId: "owner-1" as string | null,
  repository: {
    ownerId: "owner-1",
    putServerRecord: vi.fn(),
    reconcileServerRecord: vi.fn(),
    saveRecord: vi.fn(),
  },
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({ ownerId: mocks.ownerId, repository: mocks.ownerId ? mocks.repository : null }),
}));

const readyBody = {
  state: "ready",
  profile: {
    doctorName: "Dr Demo",
    tradingName: "Demo Locums",
    address: "Demo address",
    email: "demo@example.test",
  },
  invoicePrefix: "INV",
  paymentDetails: {
    accountName: "Demo Payments",
    sortCode: "12-34-56",
    accountNumber: "12345678",
  },
  paymentSummary: { accountName: "Demo Payments", accountNumberLast4: "5678" },
  encryptedSnapshot: {
    version: 2,
    ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
    salt: "AAECAwQFBgcICQoLDA0ODw==",
    initializationVector: "EBESExQVFhcYGRob",
    kdfParameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2" },
  },
  settingsRecord: {
    id: "owner-1",
    data: {
      ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      initializationVector: "EBESExQVFhcYGRob",
      kdfParameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2" },
      encryptionVersion: 2,
      profile: {
        doctorName: "Dr Demo",
        tradingName: "Demo Locums",
        address: "Demo address",
        email: "demo@example.test",
        profession: "pharmacist",
      },
      invoicePrefix: "INV",
    },
    revision: 2,
    updatedAt: "2026-08-09T09:00:00.000Z",
  },
} as const;

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.ownerId = "owner-1";
  mocks.repository.ownerId = "owner-1";
});

it("shows masked saved details without a passcode or vault UI", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, readyBody)));
  render(<ProfileForm />);
  expect(await screen.findByText("Payment details saved")).toBeVisible();
  expect(screen.getByText("•••• 5678")).toBeVisible();
  expect(screen.queryByLabelText(/passcode/i)).toBeNull();
  expect(screen.queryByText(/vault/i)).toBeNull();
});

it("requests one-time bank re-entry for a legacy account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409, {
    state: "upgrade_required",
    profile: readyBody.profile,
    invoicePrefix: "INV",
  })));
  render(<ProfileForm />);
  expect(await screen.findByText(/enter your bank details once/i)).toBeVisible();
  expect(screen.getByLabelText("Name")).toHaveValue("Dr Demo");
  expect(screen.getByLabelText("Invoice prefix")).toHaveValue("INV");
  expect(screen.getByLabelText("Account name")).toHaveValue("");
  expect(screen.queryByLabelText(/passcode/i)).toBeNull();
});

it("saves only the canonical encrypted record to offline storage", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(409, {
      state: "upgrade_required",
      profile: readyBody.profile,
      invoicePrefix: "INV",
    }))
    .mockResolvedValueOnce(response(200, readyBody));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProfileForm />);
  await screen.findByText(/enter your bank details once/i);
  await user.type(screen.getByLabelText("Account name"), "Dr Demo");
  await user.type(screen.getByLabelText("Sort code"), "123456");
  await user.type(screen.getByLabelText("Account number"), "12345678");
  await user.click(screen.getByRole("button", { name: "Save profile and payments" }));
  await waitFor(() => expect(mocks.repository.reconcileServerRecord).toHaveBeenCalled());
  expect(mocks.repository.saveRecord).not.toHaveBeenCalled();
  const stored = JSON.stringify(mocks.repository.reconcileServerRecord.mock.calls[0]);
  expect(stored).not.toContain("Demo Payments");
  expect(stored).not.toContain("12-34-56");
  expect(stored).not.toContain("12345678");
  expect(stored).toContain("pharmacist");
});

it("prefills public profile fields from a metadata-only account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
    state: "missing",
    profile: readyBody.profile,
    invoicePrefix: "LM",
  })));

  render(<ProfileForm />);

  expect(await screen.findByText(/enter your bank details/i)).toBeVisible();
  expect(screen.getByLabelText("Name")).toHaveValue("Dr Demo");
  expect(screen.getByLabelText("Invoice prefix")).toHaveValue("LM");
});

it("retains entries when an online save fails", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(response(200, { state: "missing" }))
    .mockRejectedValueOnce(new TypeError("offline")));
  render(<ProfileForm />);
  await screen.findByText(/enter your bank details/i);
  await user.type(screen.getByLabelText("Name"), "Dr Demo");
  await user.type(screen.getByLabelText("Address"), "Demo address");
  await user.type(screen.getByLabelText("Email address"), "demo@example.test");
  await user.type(screen.getByLabelText("Account name"), "Dr Demo");
  await user.type(screen.getByLabelText("Sort code"), "123456");
  await user.type(screen.getByLabelText("Account number"), "12345678");
  await user.click(screen.getByRole("button", { name: "Save profile and payments" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your entries have been kept");
  expect(screen.getByLabelText("Account number")).toHaveValue("12345678");
});

it("clears readable fields when authentication ends", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, readyBody)));
  const view = render(<ProfileForm />);
  await screen.findByText("Payment details saved");
  await user.click(screen.getByRole("button", { name: "Change payment details" }));
  await user.type(screen.getByLabelText("Account number"), "12345678");
  mocks.ownerId = null;
  view.rerender(<ProfileForm />);
  expect(screen.getByRole("alert")).toHaveTextContent("Please sign in again");
  expect(screen.queryByDisplayValue("12345678")).toBeNull();
});
