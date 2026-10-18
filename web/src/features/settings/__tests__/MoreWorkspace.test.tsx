import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { MoreWorkspace } from "../MoreWorkspace";

const mocks = vi.hoisted(() => ({
  collectBackupRecords: vi.fn(),
  downloadEncryptedBackup: vi.fn(),
  exportEncryptedBackup: vi.fn(),
  loadDemoData: vi.fn(),
  removeDemoData: vi.fn(),
  markSaving: vi.fn(),
  syncNow: vi.fn(),
  syncValue: {
    repository: { ownerId: "owner-1" },
    ready: true,
  } as { repository: unknown; ready: boolean },
}));

vi.mock("@/features/backup/exportBackup", () => ({
  collectBackupRecords: mocks.collectBackupRecords,
  downloadEncryptedBackup: mocks.downloadEncryptedBackup,
  exportEncryptedBackup: mocks.exportEncryptedBackup,
}));

vi.mock("@/features/demo/demoDataService", () => ({
  loadDemoData: mocks.loadDemoData,
  removeDemoData: mocks.removeDemoData,
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecords: () => [],
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({
    ...mocks.syncValue,
    markSaving: mocks.markSaving,
    syncNow: mocks.syncNow,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.syncValue = { repository: { ownerId: "owner-1" }, ready: true };
});

it("keeps practices reachable after removing it from primary navigation", () => {
  render(<MoreWorkspace calendarEnabled={false} />);

  expect(screen.getByRole("link", { name: "Practices" })).toHaveAttribute(
    "href",
    "/practices",
  );
  expect(screen.queryByRole("link", { name: "Expenses" })).toBeNull();
  expect(screen.getByRole("link", { name: "Tax & MTD" })).toHaveAttribute(
    "href",
    "/tax-mtd",
  );
});

it("places the financial overview before practices", () => {
  render(<MoreWorkspace calendarEnabled={false} />);

  const overview = screen.getByRole("region", { name: "Financial overview" });
  expect(
    within(overview).getByRole("link", { name: /Paid this year/ }),
  ).toHaveAttribute("href", "/invoices?status=paid&period=payment-year");
  expect(
    within(overview).getByRole("link", { name: /Outstanding/ }),
  ).toHaveAttribute("href", "/invoices?status=sent");
  expect(
    within(overview).getByRole("link", { name: /Overdue/ }),
  ).toHaveAttribute("href", "/invoices?status=overdue");
  expect(
    within(overview).getByRole("link", { name: /Draft invoices/ }),
  ).toHaveAttribute("href", "/invoices?status=draft");
  expect(
    within(overview).getByRole("link", { name: /Ready to invoice/ }),
  ).toHaveAttribute("href", "/sessions?status=ready-to-invoice");
  expect(
    within(overview).getByRole("link", { name: /Expenses this tax year/ }),
  ).toHaveAttribute("href", "/expenses?period=tax-year");
  expect(screen.getByRole("button", { name: "Demo data" })).toBeVisible();

  const practices = screen.getByRole("link", { name: "Practices" });
  expect(
    overview.compareDocumentPosition(practices) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("presents every My account function in the approved order", () => {
  const { container } = render(<MoreWorkspace calendarEnabled />);
  const labels = [...container.querySelectorAll(".more-action__copy strong")].map(
    (node) => node.textContent,
  );

  expect(labels).toEqual([
    "Practices",
    "Tax & MTD",
    "Demo data",
    "Google Calendar",
    "Profile",
    "Encrypted backup",
    "Privacy",
    "Sign out",
  ]);
  expect(
    screen.getByText("Your details and app settings stay here."),
  ).toBeVisible();
  expect(screen.getByText("Explore", { selector: "h2" })).toBeVisible();
  expect(
    screen.getByText("Account and safety", { selector: "h2" }),
  ).toBeVisible();
  expect(screen.getByText("Account", { selector: "h2" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Expenses" })).toBeNull();
  expect(screen.getByRole("link", { name: "Tax & MTD" })).toHaveAttribute(
    "href",
    "/tax-mtd",
  );
  expect(screen.getByRole("link", { name: "Google Calendar" })).toHaveAttribute(
    "href",
    "/settings/connected-services",
  );
});

it("hides Connected services when Calendar is disabled", () => {
  render(<MoreWorkspace calendarEnabled={false} />);
  expect(screen.queryByRole("link", { name: "Google Calendar" })).toBeNull();
});

it("keeps operational content in accessible inline disclosures", async () => {
  const user = userEvent.setup();
  render(<MoreWorkspace calendarEnabled={false} />);

  const demo = screen.getByRole("button", { name: /Demo data/ });
  const backup = screen.getByRole("button", { name: /Encrypted backup/ });
  const privacy = screen.getByRole("button", { name: /Privacy/ });
  expect(demo).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Load demo data" })).toBeNull();

  await user.click(demo);
  expect(demo).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Load demo data" })).toBeVisible();

  await user.click(backup);
  expect(screen.getByLabelText("Backup passphrase")).toBeVisible();
  await user.click(privacy);
  expect(screen.getByText(/stores no patient records/i)).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    "/terms",
  );
});

it("keeps the profile destination reachable", () => {
  render(<MoreWorkspace calendarEnabled={false} />);
  expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "href",
    "/settings/profile",
  );
});

it("loads the standalone demo data and synchronises it", async () => {
  const user = userEvent.setup();
  mocks.loadDemoData.mockResolvedValue({ recordCount: 31 });
  mocks.syncNow.mockResolvedValue(undefined);
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: /Demo data/ }));
  await user.click(screen.getByRole("button", { name: "Load demo data" }));

  expect(mocks.loadDemoData).toHaveBeenCalledWith(
    mocks.syncValue.repository,
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
  expect(mocks.markSaving).toHaveBeenCalledOnce();
  expect(mocks.syncNow).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Demo data loaded: 11 practices, 8 sessions and 6 invoices.",
  );
});

it("requires confirmation before removing only the demo data", async () => {
  const user = userEvent.setup();
  mocks.removeDemoData.mockResolvedValue({ recordCount: 31 });
  mocks.syncNow.mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: /Demo data/ }));
  await user.click(screen.getByRole("button", { name: "Remove demo data" }));

  expect(confirm).toHaveBeenCalledOnce();
  expect(mocks.removeDemoData).toHaveBeenCalledWith(mocks.syncValue.repository);
  expect(mocks.markSaving).toHaveBeenCalledOnce();
  expect(mocks.syncNow).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Demo data removed. Your own records were not changed.",
  );
  confirm.mockRestore();
});

it("disables demo controls until offline storage is ready", async () => {
  const user = userEvent.setup();
  mocks.syncValue = { repository: null, ready: false };
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: "Demo data" }));
  expect(screen.getByRole("button", { name: "Load demo data" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove demo data" })).toBeDisabled();
});

it("reopens the demo disclosure when its operation fails", async () => {
  const user = userEvent.setup();
  let rejectDemo: (reason?: unknown) => void = () => undefined;
  mocks.loadDemoData.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectDemo = reject;
      }),
  );
  render(<MoreWorkspace calendarEnabled={false} />);

  const demo = screen.getByRole("button", { name: "Demo data" });
  await user.click(demo);
  await user.click(screen.getByRole("button", { name: "Load demo data" }));
  await user.click(demo);
  expect(demo).toHaveAttribute("aria-expanded", "false");

  await act(async () => {
    rejectDemo(new Error("demo failure"));
  });

  expect(demo).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Demo data could not be changed. Please try again.",
  );
});

it("reopens the backup disclosure when its operation fails", async () => {
  const user = userEvent.setup();
  let rejectBackup: (reason?: unknown) => void = () => undefined;
  mocks.collectBackupRecords.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectBackup = reject;
      }),
  );
  render(<MoreWorkspace calendarEnabled={false} />);

  const backup = screen.getByRole("button", {
    name: "Encrypted backup",
  });
  await user.click(backup);
  await user.type(screen.getByLabelText("Backup passphrase"), "safe-passphrase");
  await user.click(
    screen.getByRole("button", { name: "Download encrypted backup" }),
  );
  await user.click(backup);
  expect(backup).toHaveAttribute("aria-expanded", "false");

  await act(async () => {
    rejectBackup(new Error("backup failure"));
  });

  expect(backup).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Backup could not be created. No file was downloaded.",
  );
});

it("downloads an encrypted backup and keeps its success beside backup", async () => {
  const user = userEvent.setup();
  const records = [{ id: "record-1" }];
  const envelope = { ciphertext: "fictional-ciphertext" };
  mocks.collectBackupRecords.mockResolvedValue(records);
  mocks.exportEncryptedBackup.mockResolvedValue(envelope);
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: "Encrypted backup" }));
  await user.type(screen.getByLabelText("Backup passphrase"), "safe-passphrase");
  await user.click(
    screen.getByRole("button", { name: "Download encrypted backup" }),
  );

  expect(mocks.collectBackupRecords).toHaveBeenCalledWith(
    mocks.syncValue.repository,
  );
  expect(mocks.exportEncryptedBackup).toHaveBeenCalledWith(
    records,
    "safe-passphrase",
  );
  expect(mocks.downloadEncryptedBackup).toHaveBeenCalledWith(envelope);
  expect(screen.getByLabelText("Backup passphrase")).toHaveValue("");
  expect(
    within(document.getElementById("backup-controls")!).getByRole("status"),
  ).toHaveTextContent("Encrypted backup downloaded.");
});

it("keeps sign-out feedback beside sign out when backup is open", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false }),
  );
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: "Encrypted backup" }));
  await user.click(screen.getByRole("button", { name: "Sign out" }));

  const backupPanel = document.getElementById("backup-controls");
  const accountSection = screen
    .getByRole("heading", { name: "Account" })
    .closest("section");

  expect(backupPanel).not.toBeNull();
  expect(accountSection).not.toBeNull();
  expect(within(backupPanel!).queryByRole("alert")).toBeNull();
  expect(within(accountSection!).getByRole("alert")).toHaveTextContent(
    "Sign out could not be completed.",
  );
  expect(fetch).toHaveBeenCalledWith("/api/auth/signout", {
    method: "POST",
    credentials: "include",
  });
});

it("clears private page caches and redirects after signing out", async () => {
  const user = userEvent.setup();
  const deleteCache = vi.fn().mockResolvedValue(true);
  const assign = vi.fn();
  const windowStub = Object.create(window) as Window;
  Object.defineProperty(windowStub, "location", {
    value: { assign },
  });
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
  vi.stubGlobal("caches", {
    keys: vi
      .fn()
      .mockResolvedValue([
        "locum-manager-private-pages-v4",
        "locum-manager-shell-v5",
      ]),
    delete: deleteCache,
  });
  render(<MoreWorkspace calendarEnabled={false} />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  expect(fetch).toHaveBeenCalledWith("/api/auth/signout", {
    method: "POST",
    credentials: "include",
  });
  expect(deleteCache).toHaveBeenCalledOnce();
  expect(deleteCache).toHaveBeenCalledWith("locum-manager-private-pages-v4");
});
