import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ExpenseForm } from "../ExpenseForm";

const globalStyles = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function cssDeclarations(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return globalStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

const expenseFormScope = ":is(.expense-form, .mileage-form)";

const standardMileageFields = {
  expenseKind: "standard" as const,
  journeyOrigin: null,
  journeyDestination: null,
  distanceMiles: null,
  mileageRatePence: null,
  linkedSessionId: null,
};

function persistedExpenseWithBusinessPercentage(allowablePercentage: number) {
  return {
    ...standardMileageFields,
    expenseDate: "2026-05-01",
    amountPence: 1250,
    categoryKey: "home_office" as const,
    customCategoryId: null,
    mtdCategory: "premises_costs" as const,
    allowablePercentage,
    practiceId: null,
    supplierDescription: "Fictional desk",
    notes: null,
    reimbursedByPractice: false,
    needsAccountantReview: false,
    receiptObjectKey: null,
    receiptOriginalName: null,
    receiptMimeType: null,
    receiptSizeBytes: null,
    receiptSyncStatus: "none" as const,
    isDemo: false,
  };
}

function persistedExpenseWithReceipt() {
  return {
    ...persistedExpenseWithBusinessPercentage(100),
    receiptObjectKey: "owner-a/expense-1/old.pdf",
    receiptOriginalName: "old.pdf",
    receiptMimeType: "application/pdf" as const,
    receiptSizeBytes: 10,
    receiptSyncStatus: "uploaded" as const,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps the compact expense-form CSS contract touch friendly and motion safe", () => {
  expect(cssDeclarations(".record-form__fields")).toMatch(
    /padding:\s*clamp\(20px,\s*5vw,\s*32px\)/,
  );
  expect(cssDeclarations(`${expenseFormScope} .record-form__fields`)).toMatch(
    /padding:\s*clamp\(16px,\s*4vw,\s*22px\)/,
  );
  expect(cssDeclarations(".record-form__control")).toMatch(/width:\s*100%/);
  expect(cssDeclarations(".record-form__control")).toMatch(/min-width:\s*0/);
  expect(cssDeclarations(".record-form__control")).toMatch(/min-height:\s*48px/);

  expect(cssDeclarations(`${expenseFormScope} .record-form__file-input`)).toMatch(/position:\s*absolute/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__file-input`)).toMatch(/clip-path:\s*inset\(50%\)/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__file-picker`)).toMatch(/min-height:\s*48px/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__file-name`)).toMatch(/display:\s*block/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__file-name`)).toMatch(/text-overflow:\s*ellipsis/);

  expect(cssDeclarations(`${expenseFormScope} .record-form__check`)).toMatch(/width:\s*100%/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__check-input`)).toMatch(/flex:\s*0 0 22px/);
  expect(cssDeclarations(".record-form__advanced")).toMatch(/border-top:\s*1px solid var\(--color-border\)/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__advanced-fields`)).toMatch(/gap:\s*14px/);
  expect(cssDeclarations(`${expenseFormScope} .record-form__actions`)).toMatch(/min-width:\s*0/);
  expect(cssDeclarations(".expense-form .record-form__section-title")).toMatch(/font-size:\s*var\(--font-section-title\)/);
  expect(cssDeclarations(".expense-form .record-form__money-control")).toMatch(/position:\s*relative/);
  expect(cssDeclarations(".expense-form .record-form__currency")).toMatch(/position:\s*absolute/);
  expect(cssDeclarations(".expense-form .record-form__advanced-status")).toMatch(/margin-left:\s*auto/);
  expect(cssDeclarations(".expense-form .record-form__actions")).toMatch(/display:\s*grid/);
  expect(cssDeclarations(".expense-form__receipt-row--locked")).toMatch(/min-width:\s*0/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary")).toMatch(/grid-template-columns:/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action")).toMatch(/min-width:\s*44px/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action")).toMatch(/min-height:\s*44px/);
  expect(cssDeclarations(".expense-form__receipt-name")).toMatch(/min-width:\s*0/);
  expect(cssDeclarations(".expense-form__receipt-name")).toMatch(/overflow:\s*hidden/);
  expect(cssDeclarations(".expense-form__receipt-name")).toMatch(/text-overflow:\s*ellipsis/);
  expect(cssDeclarations(".expense-form__receipt-name")).toMatch(/white-space:\s*nowrap/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action:hover:not\(:disabled\)")).toMatch(/background:/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action:active:not\(:disabled\)")).toMatch(/background:/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action:disabled")).toMatch(/cursor:\s*not-allowed/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action:disabled")).toMatch(/opacity:\s*0\.55/);
  expect(cssDeclarations(".expense-form__receipt-locked-summary .expense-form__receipt-action:focus-visible")).toMatch(/outline:/);
  expect(cssDeclarations(".expense-form .expense-form__delete:hover:not\(:disabled\)")).toMatch(/background:/);
  expect(cssDeclarations(".expense-form .expense-form__delete:active:not\(:disabled\)")).toMatch(/background:/);
  expect(globalStyles).toMatch(
    /@media\s*\(max-width:\s*899px\)[\s\S]*?\.expense-form \.record-form__actions\s*\{[\s\S]*?position:\s*fixed/,
  );
  expect(globalStyles).toMatch(
    /@media\s*\(max-width:\s*899px\)[\s\S]*?\.expense-form \.record-form__actions\s*\{[\s\S]*?transform:\s*none/,
  );
  expect(globalStyles).toMatch(
    /@media\s*\(max-width:\s*899px\)[\s\S]*?\.expense-form\.record-form--receipt-review\s*\{[\s\S]*?padding-bottom:\s*calc\(158px \+ var\(--mobile-navigation-bottom-space\)\)/,
  );
  expect(globalStyles).toMatch(
    /@media\s*\(max-width:\s*899px\)[\s\S]*?\.expense-form__receipt-row\s*\{[\s\S]*?margin-bottom:\s*calc\(72px \+ var\(--mobile-navigation-bottom-space\)\)/,
  );
  expect(globalStyles).toMatch(
    /@media\s*\(min-width:\s*900px\)[\s\S]*?\.expense-form \.record-form__actions\s*\{[\s\S]*?position:\s*static/,
  );
  expect(globalStyles).toMatch(
    /@media\s*\(max-width:\s*899px\)[\s\S]*?\.expense-form \.record-form__actions \.expense-form__delete\s*\{[\s\S]*?min-height:\s*48px/,
  );
  expect(cssDeclarations(".expense-form .expense-form__delete")).toMatch(/color:\s*var\(--color-danger\)/);
  expect(cssDeclarations(".expense-form .record-form__advanced > summary")).toMatch(/min-height:\s*52px/);
  expect(cssDeclarations(".record-form__actions--sticky")).not.toMatch(/backdrop-filter/);
  expect(globalStyles).toMatch(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.record-form__advanced summary::before\s*\{[\s\S]*?transition:\s*none/,
  );
});

it("shows the main expense questions without a step tracker and keeps more details closed", () => {
  const { container } = render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[{ id: "practice-1", name: "Fictional Practice" }]}
      profession="gp"
    />,
  );

  const everydayFields = [
    "What did you buy?",
    "How much did it cost?",
    "When did you buy it?",
    "What type of expense is it?",
    "Which practice?",
  ].map((name) => screen.getByLabelText(name));
  expect(everydayFields).toHaveLength(5);
  expect(screen.getByRole("heading", { level: 2, name: "Add this expense" })).toBeInTheDocument();
  expect(screen.getByText("Answer the main questions, then save the expense.")).toBeInTheDocument();
  expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Expense details" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save expense" })).toBeInTheDocument();
  expect(screen.getByText("Add a receipt (optional)")).toBeInTheDocument();
  expect(screen.getByText("No receipt added", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("No receipt attached", { exact: true })).not.toBeInTheDocument();
  const allElements = [...container.querySelectorAll("input, select, textarea")];
  expect(everydayFields.map((field) => allElements.indexOf(field))).toEqual(
    [...everydayFields.map((field) => allElements.indexOf(field))].sort((a, b) => a - b),
  );
  expect(screen.getByRole("link", { name: "Can't find it? Add a category." })).toBeInTheDocument();
  expect(screen.getByText("More details").closest("details")).not.toHaveAttribute("open");
});

it("keeps receipt review focused without a step tracker", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      prefill={{
        amountPence: 4299,
        categoryKey: "professional_memberships",
        expenseDate: "2026-08-08",
        receipt: new File(["fictional"], "review.png", { type: "image/png" }),
        supplierDescription: "Fictional Medical Supplies",
      }}
      profession="gp"
      shellTitleAs="h2"
      variant="receipt-review"
    />,
  );

  expect(screen.getByRole("heading", { level: 2, name: "Check this expense" })).toBeInTheDocument();
  expect(screen.getByText("Check the suggested answers, then save the expense.")).toBeInTheDocument();
  expect(screen.queryByText(/Step \d of 3:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
});

it("allows a truthful guided intro for manual receipt review", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      prefill={{
        receipt: new File(["fictional"], "manual.pdf", { type: "application/pdf" }),
      }}
      profession="gp"
      shellIntro="Enter the details, then save the expense."
      shellTitleAs="h2"
      variant="receipt-review"
    />,
  );

  expect(screen.getByRole("heading", { level: 2, name: "Check this expense" })).toBeInTheDocument();
  expect(screen.getByText("Enter the details, then save the expense.")).toBeInTheDocument();
  expect(screen.queryByText("Check the suggested answers, then save the expense.")).not.toBeInTheDocument();
});

it("keeps meaningful saved extras collapsed and announces them", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      initialData={{
        ...standardMileageFields,
        expenseDate: "2026-05-01",
        amountPence: 1250,
        categoryKey: "home_office",
        customCategoryId: null,
        mtdCategory: "premises_costs",
        allowablePercentage: 80,
        practiceId: null,
        supplierDescription: "Fictional desk",
        notes: "Check apportionment",
        reimbursedByPractice: false,
        needsAccountantReview: true,
        receiptObjectKey: null,
        receiptOriginalName: null,
        receiptMimeType: null,
        receiptSizeBytes: null,
        receiptSyncStatus: "none",
        isDemo: false,
      }}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  const details = screen.getByText("More details").closest("details");
  expect(details).not.toHaveAttribute("open");
  expect(screen.getByText("Extra details saved")).toBeInTheDocument();
  expect(screen.queryByText("Extra details added")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Business-use percentage")).toHaveValue(80);
  expect(screen.getByLabelText("Review with accountant")).toBeChecked();

  fireEvent.change(screen.getByLabelText("Business-use percentage"), {
    target: { value: "70" },
  });
  expect(screen.getByText("Extra details saved")).toBeInTheDocument();
  expect(screen.getByText("Extra details added")).toBeInTheDocument();
});

it("does not announce generated defaults as saved extra details", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      initialData={{
        ...standardMileageFields,
        expenseDate: "2026-05-01",
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
        receiptObjectKey: null,
        receiptOriginalName: null,
        receiptMimeType: null,
        receiptSizeBytes: null,
        receiptSyncStatus: "none",
        isDemo: false,
      }}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  expect(screen.queryByText("Extra details saved")).not.toBeInTheDocument();
  expect(screen.queryByText("Extra details added")).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "Fictional unsaved edit note" },
  });
  expect(screen.queryByText("Extra details saved")).not.toBeInTheDocument();
  expect(screen.getByText("Extra details added")).toBeInTheDocument();
});

it("does not mark a numerically unchanged saved business percentage as added", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      initialData={persistedExpenseWithBusinessPercentage(75)}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  expect(screen.getByText("Extra details saved")).toBeInTheDocument();
  expect(screen.queryByText("Extra details added")).not.toBeInTheDocument();
  const percentage = screen.getByLabelText("Business-use percentage");
  fireEvent.change(percentage, { target: { value: "075" } });

  expect((percentage as HTMLInputElement).value).toBe("075");
  expect(screen.getByText("Extra details saved")).toBeInTheDocument();
  expect(screen.queryByText("Extra details added")).not.toBeInTheDocument();
});

it("does not mark a blank invalid business percentage as added", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <ExpenseForm
      customCategories={[]}
      initialData={persistedExpenseWithBusinessPercentage(100)}
      onSubmit={onSubmit}
      practices={[]}
      profession="gp"
    />,
  );

  const percentage = screen.getByLabelText("Business-use percentage");
  fireEvent.change(percentage, { target: { value: "" } });

  expect(screen.queryByText("Extra details saved")).not.toBeInTheDocument();
  expect(screen.queryByText("Extra details added")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter a business percentage from 0 to 100.",
  );
  expect(screen.getByText("More details").closest("details")).toHaveAttribute("open");
  await waitFor(() => expect(percentage).toHaveFocus());
  expect(onSubmit).not.toHaveBeenCalled();
});

it("preserves extra values when more details is closed and reopened", () => {
  render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);
  const summary = screen.getByText("More details");

  fireEvent.click(summary);
  fireEvent.change(screen.getByLabelText("Business-use percentage"), {
    target: { value: "75" },
  });
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "Fictional review note" },
  });
  expect(screen.queryByText("Extra details saved")).not.toBeInTheDocument();
  expect(screen.getByText("Extra details added")).toBeInTheDocument();

  fireEvent.click(summary);
  fireEvent.click(summary);
  expect(screen.getByLabelText("Business-use percentage")).toHaveValue(75);
  expect(screen.getByLabelText("Notes")).toHaveValue("Fictional review note");
});

it("opens advanced details and associates its error with an invalid advanced field", async () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional supplier" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("Business-use percentage"), { target: { value: "101" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  const field = screen.getByLabelText("Business-use percentage");
  const error = await screen.findByRole("alert");
  expect(screen.getByText("More details").closest("details")).toHaveAttribute("open");
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAttribute("aria-describedby", error.id);
  await waitFor(() => expect(field).toHaveFocus());
});

it("shows GP expense labels when the required profession is GP", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  expect(
    screen.getByRole("option", {
      name: "GMC, BMA, RCGP, and other professional memberships",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", {
      name: "GPhC, PDA, and other professional memberships",
    }),
  ).not.toBeInTheDocument();
});

it("shows pharmacist expense labels when the required profession is Pharmacist", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="pharmacist"
    />,
  );

  expect(
    screen.getByRole("option", {
      name: "GPhC, PDA, and other professional memberships",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Pharmacist training and CPD" }),
  ).toBeInTheDocument();
});

it("suggests an editable HMRC category when a predefined category is chosen", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "professional_indemnity" },
  });

  expect(screen.getByLabelText("HMRC expense category")).toHaveValue(
    "professional_fees",
  );
});

it("preserves a user's HMRC override when the expense category changes again", () => {
  render(
    <ExpenseForm
      customCategories={[{ id: "custom-1", name: "Fictional category" }]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="pharmacist"
    />,
  );

  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "professional_indemnity" },
  });
  fireEvent.change(screen.getByLabelText("HMRC expense category"), {
    target: { value: "other_business_expenses" },
  });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "mileage_business_travel" },
  });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "custom:custom-1" },
  });

  expect(screen.getByLabelText("HMRC expense category")).toHaveValue(
    "other_business_expenses",
  );
});

it("resets an automatic HMRC suggestion when switching to a custom category", () => {
  render(
    <ExpenseForm
      customCategories={[{ id: "custom-1", name: "Fictional category" }]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="gp"
    />,
  );

  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "mileage_business_travel" },
  });
  expect(screen.getByLabelText("HMRC expense category")).toHaveValue(
    "travel_costs",
  );

  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "custom:custom-1" },
  });
  expect(screen.getByLabelText("HMRC expense category")).toHaveValue(
    "other_business_expenses",
  );
});

it("uses the conservative HMRC fallback for ambiguous accountancy and bank fees", () => {
  render(
    <ExpenseForm
      customCategories={[]}
      onSubmit={vi.fn()}
      practices={[]}
      profession="pharmacist"
    />,
  );

  fireEvent.change(screen.getByLabelText("What type of expense is it?"), {
    target: { value: "accountancy_legal_bank_fees" },
  });

  expect(screen.getByLabelText("HMRC expense category")).toHaveValue(
    "other_business_expenses",
  );
});

it("defaults a new expense to today's Europe/London calendar date", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-02T23:30:00.000Z"));
  render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);

  expect(screen.getByLabelText("When did you buy it?")).toHaveValue("2026-08-03");
});

it("validates required fields and converts positive pounds to integer pence", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter how much you paid.");
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("When did you buy it?"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "parking_tolls_congestion" } });
  fireEvent.change(screen.getByLabelText("HMRC expense category"), { target: { value: "travel_costs" } });
  fireEvent.change(screen.getByLabelText("Business-use percentage"), { target: { value: "75" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional car park" } });
  fireEvent.click(screen.getByLabelText("Reimbursed by practice"));
  fireEvent.click(screen.getByLabelText("Review with accountant"));
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      amountPence: 1250,
      mtdCategory: "travel_costs",
      allowablePercentage: 75,
      practiceId: null,
      isDemo: false,
      reimbursedByPractice: true,
      needsAccountantReview: true,
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
    }),
    receipt: null,
    removeExistingReceipt: false,
  })));
});

it("uses plain validation copy and focuses the first problem", async () => {
  render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  const field = screen.getByLabelText("What did you buy?");
  expect(await screen.findByRole("alert")).toHaveTextContent("Tell us what you bought.");
  await waitFor(() => expect(field).toHaveFocus());
});

it("views a selected receipt locally without changing its File identity", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const createObjectURL = vi.fn(() => "blob:fictional-receipt");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const open = vi.spyOn(window, "open").mockImplementation(() => window);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);

  expect(screen.getByTestId("expense-primary-fields")).toHaveClass("record-form__section");
  expect(screen.getByTestId("expense-primary-fields").closest("form")).toHaveClass("expense-form");
  expect(screen.getByLabelText("Add receipt")).toHaveClass("record-form__file-input");
  expect(screen.getByText("JPG, PNG, HEIC, or PDF up to 10 MB.")).toHaveClass("record-form__hint");
  expect(screen.getByLabelText("Reimbursed by practice")).toHaveClass("record-form__check-input");
  expect(screen.getByLabelText("Review with accountant")).toHaveClass("record-form__check-input");

  const file = new File(["fictional receipt"], "fictional-receipt.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Add receipt"), { target: { files: [file] } });
  expect(screen.getByText("fictional-receipt.pdf")).toBeVisible();
  expect(screen.getByText("Receipt attached")).toBeInTheDocument();
  expect(screen.getByLabelText("Change receipt")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "View" }));
  expect(createObjectURL).toHaveBeenCalledWith(file);
  expect(open).toHaveBeenCalledWith("blob:fictional-receipt", "_blank", "noopener,noreferrer");

  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional desk" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0].receipt).toBe(file);
});

it("activates the hidden input from Change and submits the exact replacement File", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={persistedExpenseWithReceipt()} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const input = screen.getByLabelText("Change receipt");
  const inputClick = vi.spyOn(input, "click");
  const replacement = new File(["replacement"], "replacement.pdf", { type: "application/pdf" });

  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Change" }));
  expect(inputClick).toHaveBeenCalledTimes(1);

  await user.upload(input, replacement);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0].receipt).toBe(replacement);
});

it("treats a null local receipt window as a successful handoff until timed cleanup", () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:null-window-receipt");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  vi.spyOn(window, "open").mockImplementation(() => null);
  render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);
  const file = new File(["fictional receipt"], "receipt.pdf", { type: "application/pdf" });

  fireEvent.change(screen.getByLabelText("Add receipt"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "View receipt, Receipt attached, receipt.pdf" }));

  expect(screen.queryByText("Receipt is temporarily unavailable.")).not.toBeInTheDocument();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:null-window-receipt");
});

it("cleans an outstanding null-window receipt URL once when the form unmounts", () => {
  vi.useFakeTimers();
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:unmount-receipt") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  vi.spyOn(window, "open").mockImplementation(() => null);
  const view = render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);

  fireEvent.change(screen.getByLabelText("Add receipt"), { target: { files: [new File(["fictional receipt"], "receipt.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "View receipt, Receipt attached, receipt.pdf" }));
  expect(revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  vi.advanceTimersByTime(60_000);

  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:unmount-receipt");
});

it("revokes a local receipt URL and keeps an opener failure private", async () => {
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:throwing-receipt") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  vi.spyOn(window, "open").mockImplementation(() => { throw new Error("PRIVATE WINDOW FAILURE"); });
  const view = render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);

  fireEvent.change(screen.getByLabelText("Add receipt"), { target: { files: [new File(["fictional receipt"], "receipt.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "View receipt, Receipt attached, receipt.pdf" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt is temporarily unavailable.");
  expect(screen.queryByText("PRIVATE WINDOW FAILURE")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("uses the approved business-percentage error copy", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);
  fireEvent.change(screen.getByLabelText("When did you buy it?"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional desk" } });
  fireEvent.change(screen.getByLabelText("Business-use percentage"), { target: { value: "101" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a business percentage from 0 to 100.");
  expect(onSubmit).not.toHaveBeenCalled();
});

it("rejects a non-finite amount before submitting", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);
  fireEvent.change(screen.getByLabelText("When did you buy it?"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "999999999999999999999999999999999999999999999999999999" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional desk" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Enter how much you paid.");
  expect(onSubmit).not.toHaveBeenCalled();
});

it("rejects an empty receipt before submitting", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);
  fireEvent.change(screen.getByLabelText("When did you buy it?"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional desk" } });
  fireEvent.change(screen.getByLabelText("Add receipt"), {
    target: { files: [new File([], "receipt.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt must not be empty.");
  await waitFor(() => expect(
    screen.getByRole("button", { name: "View receipt, Receipt attached, receipt.pdf" }),
  ).toHaveFocus());
  expect(screen.getByLabelText("Change receipt")).not.toHaveFocus();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("accepts an owned practice, custom category, notes, and a PDF receipt", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[{ id: "category-1", name: "Locum bag" }]} onSubmit={onSubmit} practices={[{ id: "practice-1", name: "Demo practice" }]} profession="gp" />);
  fireEvent.change(screen.getByLabelText("When did you buy it?"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "1.20" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "custom:category-1" } });
  fireEvent.change(screen.getByLabelText("Which practice?"), { target: { value: "practice-1" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Demo supplier" } });
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Demo note" } });
  const file = new File(["demo"], "receipt.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Add receipt"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ customCategoryId: "category-1", categoryKey: null, practiceId: "practice-1", notes: "Demo note" }),
    receipt: file,
  })));
});

it("shows saving feedback and blocks duplicate submission", async () => {
  let finishSave: (() => void) | undefined;
  const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);

  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional paper" } });
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "stationery_office_supplies" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));

  const saving = await screen.findByRole("button", { name: "Saving…" });
  expect(saving).toBeDisabled();
  fireEvent.click(saving);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  finishSave?.();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save expense" })).toBeEnabled());
});

it("retains the prior receipt key for cleanup when an edit removes it", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const viewReceipt = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={persistedExpenseWithReceipt()} onSubmit={onSubmit} onViewExistingReceipt={viewReceipt} practices={[]} profession="gp" />);

  expect(screen.getByText("Receipt attached")).toBeVisible();
  expect(screen.getByLabelText("Change receipt")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  expect(screen.getByLabelText("Remove existing receipt").closest("details")).toBe(
    screen.getByText("More details", { exact: true }).closest("details"),
  );
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "View" }));
  await waitFor(() => expect(viewReceipt).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Remove existing receipt")).toHaveClass("record-form__check-input");
  await user.click(screen.getByRole("button", { name: "Remove" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("Receipt will be removed when you save.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("Receipt attached")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ receiptObjectKey: null, receiptSyncStatus: "none" }),
    removeExistingReceipt: true,
    previousReceiptObjectKey: "owner-a/expense-1/old.pdf",
  })));
});

it("removes an existing receipt without submitting a previously selected replacement", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const replacement = new File(["replacement"], "replacement.pdf", { type: "application/pdf" });

  await user.upload(screen.getByLabelText("Change receipt"), replacement);
  expect(screen.getByLabelText("Change receipt")).toHaveValue("C:\\fakepath\\replacement.pdf");
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));

  const clearedInput = screen.getByLabelText("Add receipt");
  expect(clearedInput).toHaveValue("");
  expect(screen.queryByText("replacement.pdf", { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    data: { receiptObjectKey: null, receiptSyncStatus: "none" },
    receipt: null,
    removeExistingReceipt: true,
  });
});

it("clears an unsaved local receipt without staging persisted removal", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const file = new File(["local receipt"], "local.pdf", { type: "application/pdf" });

  await user.upload(screen.getByLabelText("Add receipt"), file);
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));

  expect(screen.getByRole("button", { name: "Add receipt" })).toBeVisible();
  expect(screen.getByLabelText("Add receipt")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("How much did it cost?"), { target: { value: "12.50" } });
  fireEvent.change(screen.getByLabelText("What type of expense is it?"), { target: { value: "home_office" } });
  fireEvent.change(screen.getByLabelText("What did you buy?"), { target: { value: "Fictional desk" } });
  await user.click(screen.getByRole("button", { name: "Save expense" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    receipt: null,
    removeExistingReceipt: false,
  });
});

it("keeps the More details checkbox and receipt-row removal synchronized", async () => {
  const user = userEvent.setup();
  render(<ExpenseForm customCategories={[]} initialData={persistedExpenseWithReceipt()} onSubmit={vi.fn()} practices={[]} profession="gp" />);
  const checkbox = screen.getByLabelText("Remove existing receipt");

  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  expect(checkbox).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(checkbox).not.toBeChecked();

  await user.click(checkbox);
  expect(screen.getByText("Receipt will be removed when you save.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText("Receipt attached")).toBeVisible();
});

it("cancels receipt removal and submits the exact selected replacement File", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const replacement = new File(["replacement"], "replacement.pdf", { type: "application/pdf" });

  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  await user.upload(screen.getByLabelText("Add receipt"), replacement);

  expect(screen.getByLabelText("Remove existing receipt")).not.toBeChecked();
  expect(screen.getByText("Receipt attached", { exact: true })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0].removeExistingReceipt).toBe(false);
  expect(onSubmit.mock.calls[0]?.[0].receipt).toBe(replacement);
});

it("lets removal recover from an oversized hidden replacement without validating it", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "oversized.pdf", { type: "application/pdf" });

  await user.upload(screen.getByLabelText("Change receipt"), oversized);
  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Receipt must be 10 MB or smaller.", { exact: true })).not.toBeInTheDocument();
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ receipt: null, removeExistingReceipt: true });
});

it("clears a receipt validation error when a valid replacement is selected", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const invalid = new File([], "invalid-replacement.pdf", { type: "application/pdf" });
  const valid = new File(["valid replacement"], "valid-replacement.pdf", { type: "application/pdf" });

  await user.upload(screen.getByLabelText("Change receipt"), invalid);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  const invalidInput = screen.getByLabelText("Change receipt");
  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt must not be empty.");
  expect(invalidInput).toHaveAttribute("aria-invalid", "true");
  expect(invalidInput.getAttribute("aria-describedby")).toContain("-error");

  await user.upload(invalidInput, valid);

  const recoveredInput = screen.getByLabelText("Change receipt");
  expect(screen.queryByText("Receipt must not be empty.", { exact: true })).not.toBeInTheDocument();
  expect(recoveredInput).not.toHaveAttribute("aria-invalid");
  expect(recoveredInput).toHaveAttribute("aria-describedby", "receipt-help");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0].removeExistingReceipt).toBe(false);
  expect(onSubmit.mock.calls[0]?.[0].receipt).toBe(valid);
});

it("clears a receipt validation error when existing-receipt removal is selected", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={onSubmit} practices={[]} profession="gp" />);
  const invalid = new File([], "invalid-replacement.pdf", { type: "application/pdf" });

  await user.upload(screen.getByLabelText("Change receipt"), invalid);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  const invalidInput = screen.getByLabelText("Change receipt");
  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt must not be empty.");
  expect(invalidInput).toHaveAttribute("aria-invalid", "true");

  await user.click(screen.getByRole("button", { name: "Receipt options" }));
  await user.click(screen.getByRole("button", { name: "Remove" }));

  const recoveredInput = screen.getByLabelText("Add receipt");
  expect(screen.queryByText("Receipt must not be empty.", { exact: true })).not.toBeInTheDocument();
  expect(recoveredInput).not.toHaveAttribute("aria-invalid");
  expect(recoveredInput).toHaveAttribute("aria-describedby", "receipt-help");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ receipt: null, removeExistingReceipt: true });
});

it("keeps receipt viewing failures private", async () => {
  const viewReceipt = vi.fn().mockRejectedValue(new Error("PRIVATE RECEIPT FAILURE"));
  render(<ExpenseForm customCategories={[]} initialData={{ ...persistedExpenseWithBusinessPercentage(100), receiptObjectKey: "owner-a/expense-1/old.pdf", receiptOriginalName: "old.pdf", receiptMimeType: "application/pdf", receiptSizeBytes: 10, receiptSyncStatus: "uploaded" }} onSubmit={vi.fn()} onViewExistingReceipt={viewReceipt} practices={[]} profession="gp" />);

  fireEvent.click(screen.getByRole("button", { name: "View receipt, Receipt attached, old.pdf" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Receipt is temporarily unavailable.");
  expect(screen.queryByText("PRIVATE RECEIPT FAILURE")).not.toBeInTheDocument();
});

it("keeps locked receipt review View-only", async () => {
  const user = userEvent.setup();
  const file = new File(["locked receipt"], "locked.pdf", { type: "application/pdf" });
  const createObjectURL = vi.fn(() => "blob:locked-receipt");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const open = vi.spyOn(window, "open").mockImplementation(() => window);
  const { container } = render(
    <ExpenseForm
      customCategories={[]}
      lockPrefilledReceipt
      onSubmit={vi.fn()}
      practices={[]}
      prefill={{ receipt: file }}
      profession="gp"
      variant="receipt-review"
    />,
  );

  expect(container.querySelector(".expense-form__receipt-row--locked")).not.toBeNull();
  expect(screen.getByText("Receipt attached")).toBeVisible();
  expect(screen.getByText("locked.pdf")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Receipt options" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Change receipt")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "View receipt, Receipt attached, locked.pdf" }));
  expect(createObjectURL).toHaveBeenCalledWith(file);
  expect(open).toHaveBeenCalledWith("blob:locked-receipt", "_blank", "noopener,noreferrer");
});

it("keeps a locked persisted receipt View-only and cannot stage its removal", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onViewExistingReceipt = vi.fn().mockResolvedValue(undefined);
  render(
    <ExpenseForm
      customCategories={[]}
      initialData={persistedExpenseWithReceipt()}
      lockPrefilledReceipt
      onSubmit={onSubmit}
      onViewExistingReceipt={onViewExistingReceipt}
      practices={[]}
      profession="gp"
      variant="receipt-review"
    />,
  );

  expect(screen.getByRole("button", { name: "View receipt, Receipt attached, old.pdf" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Receipt options" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Change receipt")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Remove existing receipt")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    data: { receiptObjectKey: "owner-a/expense-1/old.pdf" },
    receipt: null,
    removeExistingReceipt: false,
    previousReceiptObjectKey: "owner-a/expense-1/old.pdf",
  });
});

it("shows an empty receipt row, skips the hidden input when tabbing, and keeps the file hint", async () => {
  const user = userEvent.setup();
  render(<ExpenseForm customCategories={[]} onSubmit={vi.fn()} practices={[]} profession="gp" />);

  expect(screen.getByText("No receipt added")).toBeVisible();
  const addReceipt = screen.getByRole("button", { name: "Add receipt" });
  const input = screen.getByLabelText("Add receipt");
  expect(addReceipt).toBeVisible();
  expect(input).toHaveClass("record-form__file-input");
  expect(input).toHaveAttribute("tabindex", "-1");
  screen.getByLabelText("Which practice?").focus();
  await user.tab();
  expect(addReceipt).toHaveFocus();
  await user.tab();
  expect(input).not.toHaveFocus();
  expect(screen.getByText("JPG, PNG, HEIC, or PDF up to 10 MB.")).toBeVisible();
});
