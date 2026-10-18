import "fake-indexeddb/auto";

import Link from "next/link";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import type { ReceiptOcrResult } from "../receiptOcr";
import type { ReceiptSuggestions } from "../receiptSuggestions";
import { ReceiptScanFlow } from "../ReceiptScanFlow";
import {
  collectBackupRecords,
  decryptBackupForRecovery,
  exportEncryptedBackup,
} from "@/features/backup/exportBackup";
import { createMtdExportFiles } from "@/features/mtd/exportMtdPackage";
import { createLocumDatabase } from "@/offline/db";
import { OfflineRepository } from "@/offline/repository";
import { saveNewExpense } from "../ExpenseViews";

const suggestions: ReceiptSuggestions = {
  supplier: { value: "Fictional Medical Supplies", confidence: "high" },
  expenseDate: { value: "2026-08-08", confidence: "high" },
  amountPence: { value: 4299, confidence: "medium" },
  category: {
    value: "professional_memberships",
    label: "GMC, BMA, RCGP, and other professional memberships",
    confidence: "high",
  },
};

function fictionalReceipt() {
  return new File(["fictional pixels"], "fictional-receipt.png", {
    type: "image/png",
  });
}

function successfulAnalysis(extra: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    status: "suggestions",
    suggestions,
    ...extra,
  } as ReceiptOcrResult);
}

function renderFlow({
  analyzeReceipt = successfulAnalysis(),
  onSubmit = vi.fn().mockResolvedValue(undefined),
} = {}) {
  render(
    <ReceiptScanFlow
      analyzeReceipt={analyzeReceipt}
      customCategories={[]}
      onSubmit={onSubmit}
      practices={[{ id: "practice-1", name: "Fictional Practice" }]}
      profession="gp"
    />,
  );
  return { analyzeReceipt, onSubmit };
}

beforeEach(() => {
  routerPush.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:fictional-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("receipt scan flow", () => {
  it("offers camera capture and local file selection", () => {
    renderFlow();

    const camera = screen.getByLabelText("Take photo");
    expect(camera).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Choose receipt")).toHaveAttribute(
      "accept",
      expect.stringContaining("application/pdf"),
    );
  });

  it("announces local progress and promptly cancels analysis", async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    const analyzeReceipt = vi.fn(
      (_file, _profession, options) =>
        new Promise<ReceiptOcrResult>((_resolve, reject) => {
          capturedSignal = options?.signal;
          options?.onProgress?.({ status: "recognizing text", progress: 0.42 });
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    );
    renderFlow({ analyzeReceipt });

    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recognising receipt on this device — 42%",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(capturedSignal?.aborted).toBe(true);
    expect(screen.getByLabelText("Choose receipt")).toBeInTheDocument();
  });

  it("previews structured suggestions, shows confidence, and focuses the first uncertain field", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderFlow();

    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());

    expect(await screen.findByRole("heading", { name: "Review receipt" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Check this expense" })).toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
    const preview = screen.getByRole("img", { name: "Receipt preview" });
    expect(preview).toHaveAttribute(
      "src",
      "blob:fictional-preview",
    );
    expect(preview.closest("figure")).toHaveClass("receipt-scan__preview-card");
    expect(preview).toHaveClass("receipt-scan__preview--compact");
    await waitFor(() => expect(screen.getByLabelText("How much did it cost?")).toHaveFocus());
    const previewToggle = within(preview.closest("figure")!).getByRole("button", {
      name: "Expand receipt preview",
    });
    expect(screen.getAllByRole("button", { name: "Expand receipt preview" })).toHaveLength(1);
    expect(screen.getAllByRole("button", {
      name: "View receipt, Receipt attached, fictional-receipt.png",
    })).toHaveLength(1);
    await user.click(previewToggle);
    expect(preview).toHaveClass("receipt-scan__preview--expanded");
    expect(screen.getAllByRole("button", { name: "Collapse receipt preview" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Collapse receipt preview" }));
    expect(preview).toHaveClass("receipt-scan__preview--compact");
    expect(screen.getByLabelText("What did you buy?")).toHaveValue(
      "Fictional Medical Supplies",
    );
    expect(screen.getByLabelText("What did you buy?")).toHaveClass("record-form__control");
    expect(screen.getByLabelText("What did you buy?").closest("form")).toHaveClass("record-form--receipt-review");
    expect(screen.getByLabelText("How much did it cost?")).toHaveValue("42.99");
    expect(screen.getByLabelText("When did you buy it?")).toHaveValue("2026-08-08");
    expect(screen.getByRole("combobox", { name: "What type of expense is it?" })).toHaveValue(
      "professional_memberships",
    );
    expect(screen.getByText("Supplier: High confidence")).toBeInTheDocument();
    expect(screen.getByText("Amount: Check this suggestion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save expense" }).parentElement).toHaveClass("record-form__actions--sticky");
    expect(screen.getByRole("button", { name: "Save expense" })).toHaveClass("button");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("button--quiet");
    expect(screen.getByRole("link", { name: "Enter manually" })).toHaveClass("button--quiet");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps edits and raw recognition text out of the explicit save submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const analyzeReceipt = successfulAnalysis({
      rawText: "PRIVATE RAW OCR MUST NEVER PERSIST",
    });
    renderFlow({ analyzeReceipt, onSubmit });
    const receipt = fictionalReceipt();

    await user.upload(screen.getByLabelText("Choose receipt"), receipt);
    await screen.findByRole("heading", { name: "Review receipt" });
    await user.clear(screen.getByLabelText("What did you buy?"));
    await user.type(screen.getByLabelText("What did you buy?"), "Edited fictional supplier");
    await user.clear(screen.getByLabelText("How much did it cost?"));
    await user.type(screen.getByLabelText("How much did it cost?"), "45.25");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "What type of expense is it?" }),
      "home_office",
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submission = onSubmit.mock.calls[0][0];
    expect(submission).toMatchObject({
      data: {
        amountPence: 4525,
        categoryKey: "home_office",
        supplierDescription: "Edited fictional supplier",
      },
      receipt,
    });
    expect(JSON.stringify(submission)).not.toContain("PRIVATE RAW OCR");
  });

  it("keeps raw recognition text out of records, outbox, backup, and MTD exports", async () => {
    const user = userEvent.setup();
    const database = createLocumDatabase(
      `receipt-scan-privacy-${Date.now()}-${Math.random()}`,
    );
    const repository = new OfflineRepository(database, "owner-a", {
      now: () => "2026-08-08T12:00:00.000Z",
      uuid: () => "00000000-0000-4000-8000-000000000001",
    });
    await repository.initialize();
    const rawText = "PRIVATE RAW OCR MUST NEVER ENTER STORAGE";
    const onSubmit = vi.fn(async (submission) => {
      await saveNewExpense(
        repository,
        "owner-a",
        "expense-1",
        submission,
        () => "receipt-1",
      );
    });

    try {
      renderFlow({ analyzeReceipt: successfulAnalysis({ rawText }), onSubmit });
      await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
      await screen.findByRole("heading", { name: "Review receipt" });
      await user.click(screen.getByRole("button", { name: "Save expense" }));

      await waitFor(async () =>
        expect(await repository.getRecord("expenses", "expense-1")).toBeTruthy(),
      );
      const record = await repository.getRecord("expenses", "expense-1");
      const outbox = await repository.pendingMutations();
      const backupRecords = await collectBackupRecords(repository);
      const encryptedBackup = await exportEncryptedBackup(
        backupRecords,
        "fictional backup passphrase",
        "2026-08-08T12:00:00.000Z",
      );
      const recoveredBackup = await decryptBackupForRecovery(
        encryptedBackup,
        "fictional backup passphrase",
      );
      const data = record?.data as {
        allowablePercentage: number;
        amountPence: number;
        expenseDate: string;
        isDemo: boolean;
        mtdCategory: "professional_fees";
        needsAccountantReview: boolean;
        reimbursedByPractice: boolean;
        supplierDescription: string;
      };
      const mtdFiles = createMtdExportFiles({
        createdAt: "2026-08-08T12:00:00.000Z",
        expenses: [{ id: "expense-1", ...data }],
        invoices: [],
        period: {
          id: "quarter-1",
          label: "Quarter 1",
          start: "2026-04-06",
          end: "2026-10-05",
        },
      });

      expect(
        JSON.stringify({
          record,
          outbox,
          recoveredBackup,
          mtdJson: mtdFiles.json,
          mtdCsv: mtdFiles.csv,
        }),
      ).not.toContain(rawText);
    } finally {
      cleanup();
      database.close();
      await database.delete();
    }
  });

  it("confirms before discarding a completed review to try again", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("dialog", { name: "Discard receipt changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("heading", { name: "Review receipt" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(screen.getByLabelText("Choose receipt")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fictional-preview");
  });

  it("offers confirmed manual entry and hides internal analysis failures", async () => {
    const user = userEvent.setup();
    const analyzeReceipt = vi
      .fn()
      .mockRejectedValue(new Error("PRIVATE OCR ENGINE DETAIL"));
    renderFlow({ analyzeReceipt });

    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This receipt could not be analysed on this device.",
    );
    expect(screen.getByText("Enter the details, then save the expense.")).toBeInTheDocument();
    expect(screen.queryByText("Check the suggested answers, then save the expense.")).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE OCR ENGINE DETAIL/)).not.toBeInTheDocument();
    const manual = screen.getByRole("link", { name: "Enter manually" });
    expect(manual).toHaveAttribute("href", "/expenses/new/manual");
    await user.click(manual);
    expect(screen.getByRole("dialog", { name: "Discard receipt changes?" })).toBeInTheDocument();
  });

  it("keeps an unsupported receipt attached for explicit manual review and save", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const analyzeReceipt = vi.fn().mockResolvedValue({
      status: "manual-fallback",
      reason: "unsupported-local-preview",
      message: "Enter this receipt manually on this device.",
    } satisfies ReceiptOcrResult);
    renderFlow({ analyzeReceipt, onSubmit });
    const receipt = new File(["fictional pdf"], "fictional-receipt.pdf", {
      type: "application/pdf",
    });

    await user.upload(screen.getByLabelText("Choose receipt"), receipt);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter this receipt manually on this device.",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Check this expense" })).toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.getByText("Enter the details, then save the expense.")).toBeInTheDocument();
    expect(screen.queryByText("Check the suggested answers, then save the expense.")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("What did you buy?"),
      "Fictional supplier",
    );
    await user.type(screen.getByLabelText("How much did it cost?"), "12.50");
    await user.clear(screen.getByLabelText("When did you buy it?"));
    await user.type(screen.getByLabelText("When did you buy it?"), "2026-08-08");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "What type of expense is it?" }),
      "home_office",
    );
    await user.click(screen.getByRole("button", { name: "Save expense" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ receipt });
  });

  it("uses an accessible discard dialog for page and form navigation after a receipt is chosen", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });

    for (const linkName of ["← Add expense", "Can't find it? Add a category.", "Enter manually"]) {
      await user.click(screen.getByRole("link", { name: linkName }));
      const dialog = screen.getByRole("dialog", { name: "Discard receipt changes?" });
      expect(dialog).toBeInTheDocument();
      expect(routerPush).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole("link", { name: "← Add expense" }));
    await user.click(screen.getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/expenses/new"));
  });

  it("captures persistent shell links while dirty but preserves new-tab navigation", async () => {
    const user = userEvent.setup();
    render(<>
      <nav>
        <Link href="/dashboard">Shell Home</Link>
        <Link href="/sessions" target="_blank">Shell Sessions new tab</Link>
        <Link href="/invoices">Shell Invoices modified click</Link>
        <a href="https://example.test" target="_blank">External new tab</a>
      </nav>
      <ReceiptScanFlow
        analyzeReceipt={successfulAnalysis()}
        customCategories={[]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        practices={[]}
        profession="gp"
      />
    </>);
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });

    await user.click(screen.getByRole("link", { name: "Shell Home" }));
    expect(screen.getByRole("dialog", { name: "Discard receipt changes?" })).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    const dispatchNativeClick = (link: HTMLElement, init: MouseEventInit) => {
      let preventedByGuard: boolean | undefined;
      link.addEventListener("click", (event) => {
        preventedByGuard = event.defaultPrevented;
        event.preventDefault();
      }, { once: true });
      link.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
        ...init,
      }));
      expect(preventedByGuard).toBe(false);
    };
    dispatchNativeClick(
      screen.getByRole("link", { name: "Shell Sessions new tab" }),
      {},
    );
    dispatchNativeClick(
      screen.getByRole("link", { name: "Shell Invoices modified click" }),
      { ctrlKey: true },
    );
    dispatchNativeClick(
      screen.getByRole("link", { name: "External new tab" }),
      {},
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("guards browser Back and reload with a same-URL sentinel", async () => {
    const user = userEvent.setup();
    const historyPush = vi.spyOn(window.history, "pushState");
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(
      <ReceiptScanFlow
        analyzeReceipt={successfulAnalysis()}
        customCategories={[]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        practices={[]}
        profession="gp"
      />,
    );
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });
    expect(historyPush).toHaveBeenCalledWith(
      expect.objectContaining({ __locumReceiptReviewGuard: expect.any(String) }),
      "",
      window.location.href,
    );

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("dialog", { name: "Discard receipt changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  it("removes navigation guards after a successful save", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <ReceiptScanFlow
        analyzeReceipt={successfulAnalysis()}
        customCategories={[]}
        onSaved={onSaved}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        practices={[]}
        profession="gp"
      />,
    );
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });

    await user.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const afterSaveUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSaveUnload);
    expect(afterSaveUnload.defaultPrevented).toBe(false);
  });

  it("cleans the unload guard on unmount", async () => {
    const user = userEvent.setup();
    const view = render(
      <ReceiptScanFlow
        analyzeReceipt={successfulAnalysis()}
        customCategories={[]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        practices={[]}
        profession="gp"
      />,
    );
    await user.upload(screen.getByLabelText("Choose receipt"), fictionalReceipt());
    await screen.findByRole("heading", { name: "Review receipt" });
    view.unmount();

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("keeps a locked scanned receipt viewable but not replaceable", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const receipt = new File(["fictional pdf"], "fictional-receipt.pdf", {
      type: "application/pdf",
    });
    renderFlow({ onSubmit });
    await user.upload(screen.getByLabelText("Choose receipt"), receipt);
    await screen.findByRole("heading", { name: "Review receipt" });

    expect(screen.getByText("Receipt attached")).toBeInTheDocument();
    expect(within(screen.getByTestId("expense-primary-fields")).getByText("fictional-receipt.pdf")).toBeInTheDocument();
    const opener = within(screen.getByTestId("expense-primary-fields")).getByRole("button", {
      name: "View receipt, Receipt attached, fictional-receipt.pdf",
    });
    expect(opener).toHaveTextContent("View receipt");
    expect(screen.getAllByRole("button", {
      name: "View receipt, Receipt attached, fictional-receipt.pdf",
    })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Expand receipt preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse receipt preview" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Change receipt", { selector: "input" })).not.toBeInTheDocument();
    expect([...screen.getByTestId("expense-primary-fields").querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")]
      .filter((field) => field.getAttribute("type") !== "hidden")
      .map((field) => field.getAttribute("aria-label") ?? field.labels?.[0]?.textContent)
      .slice(0, 5)).toEqual([
        "What did you buy?",
        "How much did it cost?",
        "When did you buy it?",
        "What type of expense is it?",
        "Which practice?",
      ]);
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].receipt).toBe(receipt);
  });
});
