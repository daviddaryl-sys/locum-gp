import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MtdWorkspaceView } from "../MtdWorkspace";

afterEach(cleanup);

it("shows cumulative records, review issues, and the explicit non-filing boundary", () => {
  render(<MtdWorkspaceView
    expenses={[
      { id: "expense-1", expenseDate: "2026-07-21", amountPence: 10_000, mtdCategory: "travel_costs", allowablePercentage: 75, reimbursedByPractice: false, needsAccountantReview: false, isDemo: false },
      { id: "expense-review", expenseDate: "2026-08-01", amountPence: 2_000, mtdCategory: "professional_fees", allowablePercentage: 100, reimbursedByPractice: false, needsAccountantReview: true, isDemo: false },
    ]}
    invoices={[
      { id: "invoice-1", status: "paid", paidAt: "2026-07-20", totalPence: 48_000, isDemo: false },
      { id: "invoice-missing", status: "paid", paidAt: null, totalPence: 20_000, isDemo: false },
    ]}
    referenceDate="2026-08-04"
  />);

  expect(screen.getByRole("heading", { name: "Tax & MTD" })).toBeVisible();
  expect(screen.getByLabelText("Cumulative update period")).toHaveValue("quarter-2");
  expect(screen.getByText("£480.00")).toBeVisible();
  expect(screen.getByText("£95.00")).toBeVisible();
  expect(screen.getByText("£385.00")).toBeVisible();
  expect(screen.getByText("Needs review")).toBeVisible();
  expect(screen.getByRole("link", { name: "Add the payment-received date." })).toHaveAttribute("href", "/invoices/invoice-missing");
  expect(screen.getByRole("link", { name: "Review this expense with your accountant." })).toHaveAttribute("href", "/expenses/expense-review");
  expect(screen.getByText("Not submitted to HMRC.", { exact: true })).toBeVisible();
  expect(screen.queryByText(/Use this export/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download accountant JSON" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download accountant CSV" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /submit.*hmrc/i })).not.toBeInTheDocument();
});

it("marks an issue-free period ready for review without export controls", () => {
  render(<MtdWorkspaceView
    expenses={[]}
    invoices={[]}
    referenceDate="2026-08-04"
  />);

  expect(screen.getByText("Ready for review")).toBeVisible();
  expect(screen.getByText("Not submitted to HMRC.", { exact: true })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Download accountant/ })).not.toBeInTheDocument();
});
