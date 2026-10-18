import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExpenseData } from "@/domain/expense";
import { suggestMileage } from "@/domain/mileage";
import { MileageForm, priorMileageForDate } from "../MileageForm";

const sessionA = {
  id: "11111111-1111-4111-8111-111111111111",
  date: "2026-08-12",
  practiceId: "practice-a",
  practiceName: "Fictional Riverside Practice",
};
const sessionB = {
  id: "22222222-2222-4222-8222-222222222222",
  date: "2026-08-14",
  practiceId: "practice-b",
  practiceName: "Example Hill Practice",
};

function mileageExpense(overrides: Partial<ExpenseData> = {}): ExpenseData {
  return {
    expenseKind: "mileage",
    journeyOrigin: "Fictional Home",
    journeyDestination: "Fictional Riverside Practice",
    distanceMiles: 20,
    mileageRatePence: 55,
    linkedSessionId: null,
    expenseDate: "2026-07-01",
    amountPence: 1100,
    categoryKey: "mileage_business_travel",
    customCategoryId: null,
    mtdCategory: "travel_costs",
    allowablePercentage: 100,
    practiceId: "practice-a",
    supplierDescription: "Business mileage",
    notes: null,
    reimbursedByPractice: false,
    needsAccountantReview: false,
    receiptObjectKey: null,
    receiptOriginalName: null,
    receiptMimeType: null,
    receiptSizeBytes: null,
    receiptSyncStatus: "none",
    isDemo: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("priorMileageForDate", () => {
  it("sums only valid, non-demo mileage expenses in the selected UK tax year", () => {
    expect(priorMileageForDate([
      mileageExpense({ distanceMiles: 9990 }),
      mileageExpense({ expenseDate: "2026-04-05", distanceMiles: 400 }),
      mileageExpense({ expenseKind: "standard", journeyOrigin: null, journeyDestination: null, distanceMiles: null, mileageRatePence: null }),
      mileageExpense({ isDemo: true, distanceMiles: 300 }),
      { malformed: true },
    ], "2026-08-12")).toBe(9990);
  });

  it("includes an already-saved journey on the same day in cumulative mileage", () => {
    expect(priorMileageForDate([
      mileageExpense({ expenseDate: "2026-08-12", distanceMiles: 12.5 }),
    ], "2026-08-12")).toBe(12.5);
  });

  it("excludes parsed mileage records with an impossible calendar date", () => {
    const priorTaxYearMiles = priorMileageForDate([
      mileageExpense({ expenseDate: "2026-07-99", distanceMiles: 9990 }),
      mileageExpense({ expenseDate: "2026-07-01", distanceMiles: 10 }),
    ], "2026-08-12");

    expect(priorTaxYearMiles).toBe(10);
    expect(suggestMileage({
      date: "2026-08-12",
      distanceMiles: 20,
      priorTaxYearMiles,
    })).toMatchObject({
      amountPence: 1100,
      thresholdSplit: { firstBandMiles: 20, afterThresholdMiles: 0 },
    });
  });
});

describe("MileageForm", () => {
  it("uses the shared field, control, checkbox, and primary-action classes", () => {
    const props = {
      expenseRecords: [],
      onSubmit: vi.fn(),
      practices: [{ id: "practice-a", name: sessionA.practiceName }],
      sessions: [sessionA],
    };
    const view = render(<MileageForm {...props} />);

    const controlLabels = [
      "Link to session (optional)",
      "Journey date",
      "Journey from",
      "Journey to",
      "Practice (optional)",
      "Business miles",
      "Confirmed mileage amount",
      "Notes (optional)",
      "HMRC expense category",
    ];
    const controlIds = controlLabels.map((labelText) => {
      const control = screen.getByLabelText(labelText);
      const field = control.closest(".record-form__field");
      const label = field?.querySelector("label");
      expect(control).toHaveClass("record-form__control");
      expect(field).not.toBeNull();
      expect(control.id).not.toBe("");
      expect(label).toHaveAttribute("for", control.id);
      return control.id;
    });
    expect(screen.getByLabelText("Notes (optional)")).toHaveClass("record-form__control--textarea");
    expect(screen.getByLabelText("I have reviewed and confirm this amount")).toHaveClass("record-form__check-input");
    expect(screen.getByLabelText("Review with accountant")).toHaveClass("record-form__check-input");
    expect(screen.getByLabelText("HMRC expense category").closest(".record-form__advanced-fields")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save mileage expense" })).toHaveClass("button", "button--primary");

    view.rerender(<MileageForm {...props} />);
    expect(controlLabels.map((labelText) => screen.getByLabelText(labelText).id)).toEqual(controlIds);
  });

  it("shows the verified threshold split and an editable suggested amount", async () => {
    const user = userEvent.setup();
    render(<MileageForm expenseRecords={[mileageExpense({ distanceMiles: 9990 })]} onSubmit={vi.fn()} practices={[{ id: "practice-a", name: "Fictional Riverside Practice" }]} sessions={[]} />);

    await user.type(screen.getByLabelText("Journey date"), "2026-08-12");
    await user.type(screen.getByLabelText("Journey from"), "Fictional Home");
    await user.type(screen.getByLabelText("Journey to"), "Fictional Riverside Practice");
    await user.type(screen.getByLabelText("Business miles"), "20");

    expect(screen.getByText(/Prior valid mileage in 2026-27: 9,990 miles/i)).toBeInTheDocument();
    expect(screen.getByText(/10 miles at 55p/i)).toBeInTheDocument();
    expect(screen.getByText(/10 miles at 25p/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmed mileage amount")).toHaveValue("8.00");
    expect(screen.getByLabelText("HMRC expense category")).toHaveValue("travel_costs");
    expect(screen.getByText(/verified support.*2026-27/i)).toBeInTheDocument();
    expect(screen.getByText(/actual vehicle costs.*accountant/i)).toBeInTheDocument();
  });

  it("requires positive miles, a supported date, journey details, and explicit amount confirmation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MileageForm expenseRecords={[]} onSubmit={onSubmit} practices={[]} sessions={[]} />);

    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid journey date");

    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: "2026-08-12" } });
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/where the journey started/i);

    fireEvent.change(screen.getByLabelText("Journey from"), { target: { value: "Fictional Home" } });
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/destination or practice/i);

    fireEvent.change(screen.getByLabelText("Journey to"), { target: { value: "Example Practice" } });
    fireEvent.change(screen.getByLabelText("Business miles"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/greater than zero/i);

    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: "2027-04-06" } });
    fireEvent.change(screen.getByLabelText("Business miles"), { target: { value: "10" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/No verified mileage rate/i);
    expect(screen.getByRole("button", { name: "Save mileage expense" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prefills from a same-owner session but never overwrites later user edits", async () => {
    const user = userEvent.setup();
    render(<MileageForm expenseRecords={[]} onSubmit={vi.fn()} practices={[{ id: "practice-a", name: sessionA.practiceName }, { id: "practice-b", name: sessionB.practiceName }]} sessions={[sessionA, sessionB]} />);

    await user.selectOptions(screen.getByLabelText("Link to session (optional)"), sessionA.id);
    expect(screen.getByLabelText("Journey date")).toHaveValue("2026-08-12");
    expect(screen.getByLabelText("Journey to")).toHaveValue(sessionA.practiceName);
    expect(screen.getByLabelText("Practice (optional)")).toHaveValue("practice-a");

    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: "2026-08-13" } });
    await user.clear(screen.getByLabelText("Journey to"));
    await user.type(screen.getByLabelText("Journey to"), "User edited destination");
    await user.selectOptions(screen.getByLabelText("Link to session (optional)"), sessionB.id);

    expect(screen.getByLabelText("Journey date")).toHaveValue("2026-08-13");
    expect(screen.getByLabelText("Journey to")).toHaveValue("User edited destination");
  });

  it("submits the confirmed structured mileage data through the shared save shape", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MileageForm expenseRecords={[]} onSubmit={onSubmit} practices={[{ id: "practice-a", name: sessionA.practiceName }]} sessions={[sessionA]} />);

    await user.selectOptions(screen.getByLabelText("Link to session (optional)"), sessionA.id);
    await user.type(screen.getByLabelText("Journey from"), "Fictional Home");
    await user.type(screen.getByLabelText("Business miles"), "20");
    await user.clear(screen.getByLabelText("Confirmed mileage amount"));
    await user.type(screen.getByLabelText("Confirmed mileage amount"), "10.50");
    await user.type(screen.getByLabelText("Notes (optional)"), "Fictional return journey record");
    await user.click(screen.getByLabelText("I have reviewed and confirm this amount"));
    await user.click(screen.getByLabelText("Review with accountant"));
    await user.click(screen.getByText("Advanced tax details"));
    await user.selectOptions(screen.getByLabelText("HMRC expense category"), "other_business_expenses");
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expenseKind: "mileage",
        expenseDate: "2026-08-12",
        journeyOrigin: "Fictional Home",
        journeyDestination: sessionA.practiceName,
        distanceMiles: 20,
        mileageRatePence: 55,
        linkedSessionId: sessionA.id,
        amountPence: 1050,
        categoryKey: "mileage_business_travel",
        mtdCategory: "other_business_expenses",
        practiceId: "practice-a",
        supplierDescription: "Business mileage: Fictional Home to Fictional Riverside Practice",
        notes: "Fictional return journey record",
        needsAccountantReview: true,
      }),
      receipt: null,
      removeExistingReceipt: false,
    });
  });

  it("invalidates confirmation when the miles or amount changes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MileageForm expenseRecords={[]} onSubmit={onSubmit} practices={[]} sessions={[]} />);
    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: "2026-08-12" } });
    await user.type(screen.getByLabelText("Journey from"), "A");
    await user.type(screen.getByLabelText("Journey to"), "B");
    await user.type(screen.getByLabelText("Business miles"), "10");
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm the amount/i);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("I have reviewed and confirm this amount"));
    expect(screen.getByLabelText("I have reviewed and confirm this amount")).toBeChecked();
    await user.type(screen.getByLabelText("Business miles"), "0");
    expect(screen.getByLabelText("I have reviewed and confirm this amount")).not.toBeChecked();
  });

  it("invalidates a confirmed manual amount when synced mileage changes the calculation basis", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = render(<MileageForm expenseRecords={[]} onSubmit={onSubmit} practices={[]} sessions={[]} />);
    fireEvent.change(screen.getByLabelText("Journey date"), { target: { value: "2026-08-12" } });
    await user.type(screen.getByLabelText("Journey from"), "A");
    await user.type(screen.getByLabelText("Journey to"), "B");
    await user.type(screen.getByLabelText("Business miles"), "20");
    await user.clear(screen.getByLabelText("Confirmed mileage amount"));
    await user.type(screen.getByLabelText("Confirmed mileage amount"), "10.00");
    await user.click(screen.getByLabelText("I have reviewed and confirm this amount"));

    view.rerender(<MileageForm expenseRecords={[mileageExpense({ distanceMiles: 9990 })]} onSubmit={onSubmit} practices={[]} sessions={[]} />);

    expect(screen.getByText(/10 miles at 55p/i)).toBeInTheDocument();
    expect(screen.getByText(/10 miles at 25p/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmed mileage amount")).toHaveValue("10.00");
    expect(screen.getByLabelText("I have reviewed and confirm this amount")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save mileage expense" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm the amount/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
