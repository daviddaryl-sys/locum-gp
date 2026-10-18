import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyPracticeFormValues,
  PracticeForm,
} from "@/features/practices/PracticeForm";

afterEach(cleanup);

const validValues = {
  name: " Example Medical Centre ",
  billingAddress: " 1 Example Road ",
  hourlyRatePounds: "60.10",
  paymentTermsDays: "30",
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Practice name"), {
    target: { value: validValues.name },
  });
  fireEvent.change(screen.getByLabelText("Billing address"), {
    target: { value: validValues.billingAddress },
  });
  fireEvent.change(screen.getByLabelText("Default hourly rate"), {
    target: { value: validValues.hourlyRatePounds },
  });
  fireEvent.change(screen.getByLabelText("Payment terms"), {
    target: { value: validValues.paymentTermsDays },
  });
}

describe("PracticeForm", () => {
  it("requires a practice name and exposes the error accessibly", async () => {
    const onSubmit = vi.fn();
    render(
      <PracticeForm initialValues={emptyPracticeFormValues} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save practice" }));

    expect(await screen.findByText("Enter a practice name.")).toBeVisible();
    expect(screen.getByLabelText("Practice name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["60.10", 6010],
    ["0.29", 29],
    ["60", 6000],
    ["60.1", 6010],
  ])("parses GBP %s to exactly %i integer pence", async (pounds, pence) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PracticeForm initialValues={emptyPracticeFormValues} onSubmit={onSubmit} />,
    );
    fillValidForm();
    fireEvent.change(screen.getByLabelText("Default hourly rate"), {
      target: { value: pounds },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save practice" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ defaultHourlyRatePence: pence }),
      ),
    );
  });

  it.each(["-1", "1.5", "abc"])(
    "requires non-negative whole-number payment terms: %s",
    async (terms) => {
      const onSubmit = vi.fn();
      render(
        <PracticeForm initialValues={validValues} onSubmit={onSubmit} />,
      );
      fireEvent.change(screen.getByLabelText("Payment terms"), {
        target: { value: terms },
      });

      fireEvent.click(screen.getByRole("button", { name: "Save practice" }));

      expect(
        await screen.findByText("Enter a non-negative whole number of days."),
      ).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("submits normalized values using the cloud payload shape", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PracticeForm initialValues={validValues} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Save practice" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Example Medical Centre",
        billingAddress: { formatted: "1 Example Road" },
        defaultHourlyRatePence: 6010,
        paymentTermsDays: 30,
        archived: false,
      }),
    );
  });

  it("preserves entries while hiding storage error details", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("IndexedDB secret-token-123"));
    render(<PracticeForm initialValues={validValues} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Save practice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Practice could not be saved. Your entries have been kept.",
    );
    expect(screen.queryByText("IndexedDB secret-token-123")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Practice name")).toHaveValue(validValues.name);
  });

  it("freezes inputs and guards duplicate submissions until save resolves", () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined));
    render(<PracticeForm initialValues={validValues} onSubmit={onSubmit} />);
    const button = screen.getByRole("button", { name: "Save practice" });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Practice name")).toBeDisabled();
    expect(screen.getByLabelText("Billing address")).toBeDisabled();
  });

  it("archives only through the explicit archive action", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(
      <PracticeForm
        initialValues={validValues}
        onArchive={onArchive}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive practice" }));

    await waitFor(() => expect(onArchive).toHaveBeenCalledTimes(1));
  });

  it("makes an archived practice read-only", () => {
    render(
      <PracticeForm
        archived
        initialValues={validValues}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("This practice is archived and is read-only."),
    ).toBeVisible();
    expect(screen.getByLabelText("Practice name")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save practice" }),
    ).not.toBeInTheDocument();
  });
});
