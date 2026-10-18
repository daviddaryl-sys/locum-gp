import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpenseData } from "@/domain/expense";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ExpenseList } from "../ExpenseList";

afterEach(() => { cleanup(); replace.mockClear(); vi.restoreAllMocks(); });

const standardMileageFields = {
  expenseKind: "standard" as const,
  journeyOrigin: null,
  journeyDestination: null,
  distanceMiles: null,
  mileageRatePence: null,
  linkedSessionId: null,
};

const expenses = [
  { id: "expense-1", data: { ...standardMileageFields, expenseDate: "2026-05-02", amountPence: 12000, categoryKey: "home_office", customCategoryId: null, mtdCategory: "premises_costs", allowablePercentage: 100, practiceId: null, supplierDescription: "Demo — fictional supplier 16", notes: "Demo — fictional expense 16", reimbursedByPractice: false, needsAccountantReview: true, receiptObjectKey: "owner/expense/file.pdf", receiptOriginalName: "file.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded", isDemo: true } },
  { id: "expense-2", data: { ...standardMileageFields, expenseDate: "2026-05-01", amountPence: 2000, categoryKey: null, customCategoryId: "category-1", mtdCategory: "travel_costs", allowablePercentage: 100, practiceId: "practice-1", supplierDescription: "Travel", notes: "Keyboard and desk equipment", reimbursedByPractice: true, needsAccountantReview: false, receiptObjectKey: null, receiptOriginalName: null, receiptMimeType: null, receiptSizeBytes: null, receiptSyncStatus: "none", isDemo: false } },
] satisfies Array<{ id: string; data: ExpenseData }>;

const expenseCardStyles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

it("removes every Edit action while retaining accessible expense-card links", () => {
  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[]} referenceDate="2026-08-02" />);
  expect(screen.queryAllByRole("link", { name: /^Edit / })).toHaveLength(0);
  expect(screen.queryAllByRole("button", { name: /^Edit/ })).toHaveLength(0);
  expect(screen.queryAllByText("Edit", { exact: true })).toHaveLength(0);
  for (const card of screen.getAllByRole("article")) {
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    expect(within(card).getByRole("link", { name: /^Open expense:/ })).toHaveClass("expense-card__open");
  }
});

it("shows 14 exact periods, shared totals, labels, and descending rows", () => {
  render(<ExpenseList categories={[{ id: "category-1", name: "Custom travel" }]} expenses={expenses} practices={[{ id: "practice-1", name: "Demo practice" }]} receiptQueue={[]} referenceDate="2026-08-02" />);
  const selector = screen.getByLabelText("Tax period");
  expect(selector.closest("label")).toHaveClass("expenses-list__period");
  expect(selector).toHaveValue("tax-year");
  expect(within(selector).getAllByRole("option")).toHaveLength(14);
  expect(screen.getByTestId("expense-summary")).toHaveClass("expense-totals");
  expect(screen.getByTestId("net-expenses").closest("div")).toHaveClass("expense-totals__item");
  expect(screen.getByRole("link", { name: "Add expense" })).toHaveClass("primary-action");
  expect(screen.getByTestId("net-expenses")).toHaveTextContent("£120.00");
  expect(screen.getByTestId("reimbursed-expenses")).toHaveTextContent("£20.00");
  const cards = screen.getAllByRole("article");
  const firstCard = cards[0];
  const openExpense = within(firstCard).getByRole("link", { name: "Open expense: Sample expense" });
  const receipt = within(firstCard).getByRole("button", { name: "Open receipt for Sample expense" });
  expect(within(firstCard).getByText("Sample expense", { selector: ".expense-card__title" })).toHaveClass("expense-card__title");
  expect(within(firstCard).getByText("2 May 2026").closest("time")).toHaveAttribute("datetime", "2026-05-02");
  expect(within(firstCard).getByText("£120.00")).toHaveClass("expense-card__amount");
  expect(within(firstCard).getByText("Home office", { selector: ".expense-card__description" })).toBeVisible();
  expect(openExpense).toHaveAttribute("href", "/expenses/expense-1");
  expect(receipt).toBeVisible();
  expect(openExpense).toHaveClass("expense-card__open");
  expect(receipt).toHaveClass("expense-card__receipt");
  expect(openExpense.contains(receipt)).toBe(false);
  expect(within(firstCard).getByText("£120.00").closest(".expense-card__top")).not.toBeNull();
  expect(within(firstCard).getByText("Accountant review")).toHaveClass("expense-card__badge");
  expect(within(firstCard).queryByText("Demo")).not.toBeInTheDocument();
  expect(within(firstCard).queryByText(/fictional supplier/i)).not.toBeInTheDocument();
  expect(within(firstCard).queryByText(/fictional expense/i)).not.toBeInTheDocument();
  expect(screen.queryByText("No receipt")).not.toBeInTheDocument();
  expect(screen.queryByText("Demo practice")).not.toBeInTheDocument();
  expect(within(firstCard).getByText("Accountant review", { selector: ".expense-card__badge" })).toBeVisible();
  expect(within(cards[1]).getByText("Reimbursed", { selector: ".expense-card__badge" })).toBeVisible();
  expect(within(cards[1]).getByText("Keyboard and desk equipment", { selector: ".expense-card__description" })).toBeVisible();
});

it("scopes the compact expense card layout and accessible action targets to expense cards", () => {
  expect(expenseCardStyles).toMatch(/\.expense-card\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden[^}]*\}/);
  expect(expenseCardStyles).toMatch(/\.expense-card__open\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*z-index:\s*1[^}]*\}/);
  expect(expenseCardStyles).toMatch(/\.expense-card__top\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\) max-content[^}]*\}/);
  expect(expenseCardStyles).toMatch(/\.expense-card__receipt\s*\{[^}]*z-index:\s*2[^}]*min-width:\s*44px[^}]*min-height:\s*44px[^}]*\}/);
  expect(expenseCardStyles).toMatch(/\.expense-card__bottom\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
  expect(expenseCardStyles).not.toContain(".expense-card__edit");
  expect(expenseCardStyles).toMatch(/\.expense-card__title,\s*\.expense-card__description\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap[^}]*\}/);
  expect(expenseCardStyles).not.toMatch(/\.record-card\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden[^}]*\}/);
});

it("uses queue failure over uploaded metadata and updates only period state", async () => {
  const user = userEvent.setup();
  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[{ expenseId: "expense-1", state: "failed" }]} referenceDate="2026-08-02" />);
  expect(screen.getByText("Upload failed")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Tax period"), "month-05");
  expect(replace).toHaveBeenCalledWith("?period=month-05");
});

it("keeps receipt states compact and opens only an uploaded receipt", async () => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ url: "https://receipts.invalid/fictional-signed-url" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));

  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[]} referenceDate="2026-08-02" />);
  await user.click(screen.getByRole("button", { name: "Open receipt for Sample expense" }));

  expect(fetchMock).toHaveBeenCalledWith("/api/expenses/expense-1/receipt", {
    cache: "no-store",
    credentials: "include",
  });
  expect(open).toHaveBeenCalledWith("https://receipts.invalid/fictional-signed-url", "_blank", "noopener,noreferrer");
  expect(screen.getByRole("img", { name: "No receipt attached for Travel" })).toBeInTheDocument();
  expect(screen.queryByText("No receipt")).not.toBeInTheDocument();
});

it("shows a compact uploading state beside independent card actions", () => {
  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[{ expenseId: "expense-1", state: "pending" }]} referenceDate="2026-08-02" />);

  const card = screen.getAllByRole("article")[0];
  const openExpense = within(card).getByRole("link", { name: "Open expense: Sample expense" });
  const receiptState = within(card).getByText("Uploading").closest(".expense-card__receipt") as HTMLElement;
  expect(receiptState).toBeVisible();
  expect(within(card).queryByRole("button", { name: "Open receipt for Sample expense" })).not.toBeInTheDocument();
  expect(openExpense).toHaveAttribute("href", "/expenses/expense-1");
  expect(openExpense).not.toContainElement(receiptState);
  expect(openExpense.parentElement).toBe(card);
});

it("shows a compact failed state beside independent card actions", () => {
  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[{ expenseId: "expense-1", state: "failed" }]} referenceDate="2026-08-02" />);

  const card = screen.getAllByRole("article")[0];
  const openExpense = within(card).getByRole("link", { name: "Open expense: Sample expense" });
  const receiptState = within(card).getByText("Upload failed").closest(".expense-card__receipt") as HTMLElement;
  expect(receiptState).toBeVisible();
  expect(within(card).queryByRole("button", { name: "Open receipt for Sample expense" })).not.toBeInTheDocument();
  expect(openExpense).toHaveAttribute("href", "/expenses/expense-1");
  expect(openExpense).not.toContainElement(receiptState);
  expect(openExpense.parentElement).toBe(card);
});

it("keeps receipt failures generic", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("owner/expense/file.pdf failed"));
  render(<ExpenseList categories={[]} expenses={expenses} practices={[]} receiptQueue={[]} referenceDate="2026-08-02" />);

  await user.click(screen.getByRole("button", { name: "Open receipt for Sample expense" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Receipt is temporarily unavailable.");
  expect(screen.queryByText("owner/expense/file.pdf failed")).not.toBeInTheDocument();
  expect(screen.queryByText(/owner\/expense\/file\.pdf/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/fictional-signed-url/i)).not.toBeInTheDocument();
});

it("keeps corrupt dates editable but excludes them from totals", () => {
  render(<ExpenseList categories={[]} expenses={[{ ...expenses[0], id: "broken", data: { ...expenses[0].data, expenseDate: "2026-02-30" } }]} practices={[]} receiptQueue={[]} referenceDate="2026-08-02" />);
  expect(screen.getByText("Date needs attention")).toBeInTheDocument();
  expect(screen.getByTestId("net-expenses")).toHaveTextContent("£0.00");
});

it("uses the UK calendar day at the tax-year boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-05T23:30:00.000Z"));
  render(<ExpenseList categories={[]} expenses={[{ ...expenses[0], data: { ...expenses[0].data, expenseDate: "2026-04-06" } }]} practices={[]} receiptQueue={[]} />);

  expect(screen.getByTestId("net-expenses")).toHaveTextContent("£120.00");
  vi.useRealTimers();
});
