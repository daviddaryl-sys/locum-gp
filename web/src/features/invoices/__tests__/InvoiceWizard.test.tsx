import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InvoiceWizard,
  type IssuedInvoice,
} from "@/features/invoices/InvoiceWizard";

afterEach(cleanup);

const practices = [
  {
    id: "practice-1",
    name: "Riverside Medical Centre",
    billingAddress: "1 Riverside Road, London",
    paymentTermsDays: 30,
    archived: false,
  },
  {
    id: "practice-archived",
    name: "Archived Practice",
    billingAddress: "2 Old Road, London",
    paymentTermsDays: 30,
    archived: true,
  },
];

const sessions = [
  {
    id: "session-1",
    practiceId: "practice-1",
    startsAt: "2026-08-12T08:00:00.000Z",
    endsAt: "2026-08-12T12:00:00.000Z",
    hourlyRatePence: 6500,
    status: "completed" as const,
  },
  {
    id: "session-planned",
    practiceId: "practice-1",
    startsAt: "2026-08-13T08:00:00.000Z",
    endsAt: "2026-08-13T12:00:00.000Z",
    hourlyRatePence: 6500,
    status: "planned" as const,
  },
];

const paymentDetails = {
  accountName: "Dr Alex Example",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};

const issued: IssuedInvoice = {
  id: "invoice-1",
  invoiceNumber: "INV-2026-0001",
  issueDate: "2026-08-12",
  dueDate: "2026-09-11",
  issuedAt: "2026-08-12T12:00:00.000Z",
  totalPence: 26000,
  status: "draft",
};

function renderWizard(overrides: Partial<React.ComponentProps<typeof InvoiceWizard>> = {}) {
  const props: React.ComponentProps<typeof InvoiceWizard> = {
    initialIssueDate: "2026-08-12",
    isOnline: true,
    onIssue: vi.fn().mockResolvedValue(issued),
    onSaveDraft: vi.fn().mockResolvedValue(undefined),
    paymentDetails,
    practices,
    sessions,
    ...overrides,
  };
  render(<InvoiceWizard {...props} />);
  return props;
}

async function reachIssueStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "Riverside Medical Centre" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("checkbox", { name: /12 August 2026/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("InvoiceWizard", () => {
  it("keeps the invoice flow simple and gates progress on valid selections", async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 5/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose practice" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByText("Archived Practice")).not.toBeInTheDocument();
    expect(screen.getByText("Choose the practice to invoice.")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Riverside Medical Centre" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Choose work" })).toBeVisible();
    expect(screen.getByText("Choose the completed sessions to include.")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /12 August 2026/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Check details" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Preview invoice" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 5/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send invoice" })).toBeVisible();
  });

  it("calculates session totals in integer pence", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("radio", { name: "Riverside Medical Centre" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("checkbox", { name: /12 August 2026/ }));

    expect(screen.getByText("1 session selected · £260.00")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("GP locum session")).toBeVisible();
    expect(screen.getAllByText("£260.00")).toHaveLength(2);
  });

  it("saves a recoverable draft without requiring connectivity", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn().mockResolvedValue(undefined);
    renderWizard({ isOnline: false, onSaveDraft });
    await user.click(screen.getByRole("radio", { name: "Riverside Medical Centre" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ practiceId: "practice-1" }),
    );
    expect(await screen.findByText("Draft saved on this device.")).toBeVisible();
  });

  it("blocks final issuance while offline", async () => {
    const user = userEvent.setup();
    const onIssue = vi.fn();
    renderWizard({ isOnline: false, onIssue });
    await reachIssueStep(user);

    expect(
      screen.getByText("Connect to the internet to issue this invoice."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Issue invoice" })).toBeDisabled();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("keeps the final step recoverable when atomic issuance fails", async () => {
    const user = userEvent.setup();
    const onIssue = vi.fn().mockRejectedValue(new Error("database private detail"));
    renderWizard({ onIssue });
    await reachIssueStep(user);

    await user.click(screen.getByRole("button", { name: "Issue invoice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invoice could not be issued. Your draft has been kept.",
    );
    expect(screen.queryByText("database private detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue invoice" })).toBeEnabled();
  });

  it("keeps an issued invoice recoverable when automatic PDF retention fails", async () => {
    const user = userEvent.setup();
    const onCreatePdf = vi.fn().mockRejectedValue(new Error("private detail"));
    renderWizard({ onCreatePdf });
    await reachIssueStep(user);

    await user.click(screen.getByRole("button", { name: "Issue invoice" }));

    expect(await screen.findByText("INV-2026-0001")).toBeVisible();
    expect(onCreatePdf).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invoice issued, but its PDF could not be retained. Use Download PDF to retry.",
    );
    expect(screen.queryByText("private detail")).not.toBeInTheDocument();
  });

  it("locks issued content and marks sent only after explicit share confirmation", async () => {
    const user = userEvent.setup();
    const onCreatePdf = vi
      .fn()
      .mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const onSharePdf = vi.fn().mockResolvedValue(true);
    const onMarkSent = vi.fn().mockResolvedValue(undefined);
    renderWizard({ onCreatePdf, onMarkSent, onSharePdf });
    await reachIssueStep(user);

    await user.click(screen.getByRole("button", { name: "Issue invoice" }));

    expect(await screen.findByText("INV-2026-0001")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share invoice" }));
    expect(await screen.findByText("Did you complete the share?")).toBeVisible();
    expect(onMarkSent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, mark as sent" }));
    expect(onMarkSent).toHaveBeenCalledWith("invoice-1");
  });
});
