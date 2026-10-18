import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { openExpenseReceiptMock, syncMock, useOfflineRecordMock, useOfflineRecordsMock } = vi.hoisted(() => ({
  openExpenseReceiptMock: vi.fn(),
  syncMock: vi.fn(),
  useOfflineRecordMock: vi.fn(),
  useOfflineRecordsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "expense-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecord: useOfflineRecordMock,
  useOfflineRecords: useOfflineRecordsMock,
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => syncMock(),
}));

vi.mock("../receiptViewer", () => ({
  openExpenseReceipt: openExpenseReceiptMock,
}));

import { deleteStoredExpense, EditExpense, MileageExpense, NewExpense, ReceiptScanExpense, ReceiptScanPlaceholder, saveNewExpense } from "../ExpenseViews";

beforeEach(() => {
  syncMock.mockReturnValue({
    markSaving: vi.fn(),
    repository: null,
    syncNow: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  openExpenseReceiptMock.mockReset();
  syncMock.mockReset();
  useOfflineRecordMock.mockReset();
  useOfflineRecordsMock.mockReset();
});

it("uses a simple edit form and delegates persisted receipt viewing", async () => {
  const repository = { deleteExpenseWithReceipt: vi.fn(), saveExpenseWithReceipt: vi.fn() };
  openExpenseReceiptMock.mockResolvedValue(undefined);
  syncMock.mockReturnValue({ markSaving: vi.fn(), repository, syncNow: vi.fn() });
  useOfflineRecordMock.mockReturnValue({
    id: "expense-1",
    data: {
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
      expenseDate: "2026-08-01",
      amountPence: 1250,
      categoryKey: "home_office",
      customCategoryId: null,
      mtdCategory: "premises_costs",
      allowablePercentage: 100,
      practiceId: null,
      supplierDescription: "Fictional desk",
      notes: null,
      reimbursedByPractice: false,
      needsAccountantReview: false,
      receiptObjectKey: "owner-a/expense-1/receipt.pdf",
      receiptOriginalName: "receipt.pdf",
      receiptMimeType: "application/pdf",
      receiptSizeBytes: 12,
      receiptSyncStatus: "uploaded",
      isDemo: false,
    },
  });
  useOfflineRecordsMock.mockImplementation((table: string) => table === "settings"
    ? [{ id: "owner-a", data: { profile: { profession: "gp" } } }]
    : []);

  render(createElement(EditExpense));

  expect(screen.getByRole("heading", { level: 1, name: "Check this expense" })).toBeInTheDocument();
  expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
  screen.getByRole("button", { name: "View receipt, Receipt attached, receipt.pdf" }).click();
  expect(openExpenseReceiptMock).toHaveBeenCalledWith("expense-1");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
});

it("passes the saved profession to a new simple expense form", () => {
  useOfflineRecordsMock.mockImplementation((table: string) => {
    if (table === "settings") {
      return [{ id: "owner-a", data: { profile: { profession: "pharmacist" } } }];
    }
    return [];
  });

  render(createElement(NewExpense));

  expect(screen.getByRole("heading", { level: 1, name: "Add this expense" })).toBeInTheDocument();
  expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
  expect(
    screen.getByRole("option", {
      name: "GPhC, PDA, and other professional memberships",
    }),
  ).toBeInTheDocument();
});

it("provides a clear placeholder for receipt scanning without duplicating future behaviour", () => {
  render(createElement(ReceiptScanPlaceholder));
  expect(screen.getByRole("heading", { name: "Scan receipt" })).toBeInTheDocument();
  expect(screen.getByText(/being prepared/i)).toBeInTheDocument();
});

it("renders guided mileage from same-owner cached records", () => {
  useOfflineRecordsMock.mockImplementation((table: string) => {
    if (table === "practices") return [{ id: "practice-a", data: { name: "Fictional Riverside Practice" } }];
    if (table === "sessions") return [{ id: "11111111-1111-4111-8111-111111111111", data: { practiceId: "practice-a", startsAt: "2026-08-12T08:00:00.000Z", endsAt: "2026-08-12T14:00:00.000Z", hourlyRatePence: 9000, status: "planned", notes: null } }];
    return [];
  });

  render(createElement(MileageExpense));

  expect(screen.getByRole("heading", { name: "Mileage" })).toBeInTheDocument();
  expect(within(screen.getByLabelText("Link to session (optional)")).getByRole("option", { name: /Fictional Riverside Practice/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save mileage expense" })).toBeInTheDocument();
});

it("waits for owner-scoped cached expenses before enabling mileage calculations", () => {
  useOfflineRecordsMock.mockImplementation((table: string) => table === "expenses" ? undefined : []);

  render(createElement(MileageExpense));

  expect(screen.getByRole("status")).toHaveTextContent(/Preparing mileage records/i);
  expect(screen.queryByRole("button", { name: "Save mileage expense" })).not.toBeInTheDocument();
  expect(screen.queryByText("Mileage suggestion")).not.toBeInTheDocument();
});

it("renders receipt scanning with the saved profession", () => {
  useOfflineRecordsMock.mockImplementation((table: string) => {
    if (table === "settings") {
      return [{ id: "owner-a", data: { profile: { profession: "gp" } } }];
    }
    return [];
  });

  render(createElement(ReceiptScanExpense));

  expect(screen.getByRole("heading", { name: "Scan receipt" })).toBeInTheDocument();
  expect(screen.getByLabelText("Take photo")).toBeInTheDocument();
  expect(screen.getByLabelText("Choose receipt")).toBeInTheDocument();
});

it("requires legacy profiles to choose a profession before adding an expense", () => {
  useOfflineRecordsMock.mockImplementation(() => []);

  render(createElement(NewExpense));

  expect(
    screen.getByRole("heading", { name: "Choose your profession" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Choose profession in profile" }),
  ).toHaveAttribute("href", "/settings/profile");
  expect(screen.queryByRole("button", { name: "Save expense" })).not.toBeInTheDocument();
});

it("allocates stable receipt keys and delegates one atomic save", async () => {
  const repository = { saveExpenseWithReceipt: vi.fn().mockResolvedValue({}) };
  const file = new File(["demo"], "receipt.pdf", { type: "application/pdf" });
  await saveNewExpense(repository as never, "owner-a", "expense-1", {
    data: { receiptObjectKey: null } as never,
    receipt: file,
    removeExistingReceipt: false,
  }, () => "object-1");
  expect(repository.saveExpenseWithReceipt).toHaveBeenCalledWith(
    "expense-1",
    expect.objectContaining({
      receiptObjectKey: "owner-a/expense-1/object-1.pdf",
      receiptSyncStatus: "pending",
    }),
    expect.objectContaining({
      objectKey: "owner-a/expense-1/object-1.pdf",
      deleteAfterUploadKey: null,
    }),
  );
});

it("queues the previous receipt for deletion when an edit removes it without a replacement", async () => {
  const repository = { saveExpenseWithReceipt: vi.fn().mockResolvedValue({}) };
  await saveNewExpense(repository as never, "owner-a", "expense-1", {
    data: { receiptObjectKey: null, receiptSyncStatus: "none" } as never,
    receipt: null,
    removeExistingReceipt: true,
    previousReceiptObjectKey: "owner-a/expense-1/old.pdf",
  } as never);

  expect(repository.saveExpenseWithReceipt).toHaveBeenCalledWith(
    "expense-1",
    expect.objectContaining({ receiptObjectKey: null, receiptSyncStatus: "none" }),
    expect.objectContaining({
      operation: "delete",
      expenseId: "expense-1",
      objectKey: "owner-a/expense-1/old.pdf",
    }),
  );
});

it("tombstones through the receipt-aware repository operation", async () => {
  const repository = { deleteExpenseWithReceipt: vi.fn().mockResolvedValue({}) };
  await deleteStoredExpense(repository as never, "expense-1", { receiptObjectKey: "owner-a/expense-1/receipt.pdf" } as never);
  expect(repository.deleteExpenseWithReceipt).toHaveBeenCalledWith(
    "expense-1",
    expect.any(Object),
    "owner-a/expense-1/receipt.pdf",
  );
});
