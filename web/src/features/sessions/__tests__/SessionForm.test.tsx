import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptySessionFormValues,
  isoToLondonFormValues,
  londonDateTimeToIso,
  sessionFormValuesForDate,
  SessionForm,
  type SessionFormValues,
} from "@/features/sessions/SessionForm";

const globalStyles = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

afterEach(cleanup);

const practices = [
  {
    id: "practice-springfield",
    name: "Springfield Medical Centre",
    defaultHourlyRatePence: 6000,
    archived: false,
  },
  {
    id: "practice-riverside",
    name: "Riverside Practice",
    defaultHourlyRatePence: 7500,
    archived: false,
  },
  {
    id: "practice-archived-current",
    name: "Archived Current Practice",
    defaultHourlyRatePence: 7000,
    archived: true,
  },
  {
    id: "practice-archived-other",
    name: "Another Archived Practice",
    defaultHourlyRatePence: 8000,
    archived: true,
  },
];

const validValues: SessionFormValues = {
  practiceId: "practice-springfield",
  date: "2026-07-21",
  startTime: "08:00",
  endTime: "12:00",
  hourlyRatePounds: "60.00",
  notes: "",
  completed: true,
};

describe("sessionFormValuesForDate", () => {
  it("uses a valid calendar date without changing the other defaults", () => {
    expect(sessionFormValuesForDate("2026-08-11")).toEqual({
      ...emptySessionFormValues,
      date: "2026-08-11",
    });
  });

  it.each([null, "", "11-08-2026", "2026-02-30", "2026-13-01"])(
    "falls back for an absent or invalid date value: %s",
    (dateKey) => {
      expect(sessionFormValuesForDate(dateKey)).toEqual(emptySessionFormValues);
    },
  );
});

describe("SessionForm Europe/London time conversion", () => {
  it("round-trips a summer date across the UTC day boundary", () => {
    expect(londonDateTimeToIso("2026-07-21", "00:30")).toBe(
      "2026-07-20T23:30:00.000Z",
    );
    expect(isoToLondonFormValues("2026-07-20T23:30:00.000Z")).toEqual({
      date: "2026-07-21",
      time: "00:30",
    });
  });

  it("rejects nonexistent and repeated London wall times", () => {
    expect(() => londonDateTimeToIso("2026-03-29", "01:30")).toThrow(
      "Choose a valid local date and time.",
    );
    expect(() => londonDateTimeToIso("2026-10-25", "01:30")).toThrow(
      "This local time occurs twice. Choose another time.",
    );
  });
});

describe("SessionForm", () => {
  it("shows one simple form without guided session questions", () => {
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    expect(screen.queryByRole("region", { name: "Session questions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Guided steps")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Where did you work\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/When did you work\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/How long did you work\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/How much were you paid\?/)).not.toBeInTheDocument();

    for (const label of [
      "Practice",
      "Session date",
      "Start time",
      "End time",
      "Completed",
      "Notes",
      "Hourly rate",
    ]) {
      expect(screen.getByLabelText(label)).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Save session" })).toBeVisible();
  });

  it("keeps the non-expense Completed checkbox on the shared protected sizing rule", () => {
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    const completed = screen.getByLabelText("Completed");
    expect(completed.closest("form")).toHaveClass("record-form");
    expect(completed.closest("form")).not.toHaveClass("expense-form", "mileage-form");
    expect(globalStyles).toMatch(
      /\.record-form__check input\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*accent-color:\s*var\(--color-primary\)/,
    );
  });

  it("requires a practice and a later end time", async () => {
    const onSubmit = vi.fn();
    render(
      <SessionForm
        initialValues={{ ...validValues, practiceId: "", endTime: "08:00" }}
        onSubmit={onSubmit}
        practices={practices}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save session" }));

    expect(await screen.findByText("Choose a practice.")).toBeVisible();
    expect(
      screen.getByText("End time must be later than start time."),
    ).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fills a default rate on first practice selection", () => {
    render(
      <SessionForm
        initialValues={emptySessionFormValues}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    fireEvent.change(screen.getByLabelText("Practice"), {
      target: { value: "practice-springfield" },
    });

    expect(screen.getByLabelText("Hourly rate")).toHaveValue("60.00");
  });

  it("preserves a manually overridden rate when the practice changes", () => {
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );
    fireEvent.change(screen.getByLabelText("Hourly rate"), {
      target: { value: "68.50" },
    });

    fireEvent.change(screen.getByLabelText("Practice"), {
      target: { value: "practice-riverside" },
    });

    expect(screen.getByLabelText("Hourly rate")).toHaveValue("68.50");
  });

  it("allows the retained archived practice but disables other archived choices", () => {
    render(
      <SessionForm
        initialValues={{
          ...validValues,
          practiceId: "practice-archived-current",
        }}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    expect(
      screen.getByRole("option", { name: "Archived Current Practice — archived" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("option", { name: "Another Archived Practice — archived" }),
    ).toBeDisabled();
  });

  it("shows actual duration and integer-pence value across the autumn clock change", () => {
    render(
      <SessionForm
        initialValues={{
          ...validValues,
          date: "2026-10-25",
          startTime: "00:30",
          endTime: "02:30",
        }}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    expect(screen.getByText("3 hours × £60.00 = £180.00")).toBeVisible();
  });

  it("uses native date and time inputs with accessible fallback text", () => {
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    expect(screen.getByLabelText("Session date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Start time")).toHaveAttribute("type", "time");
    expect(screen.getByText("Times use Europe/London.")).toBeVisible();
  });

  it("submits canonical timestamps and normalized values", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={onSubmit}
        practices={practices}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save session" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        practiceId: "practice-springfield",
        startsAt: "2026-07-21T07:00:00.000Z",
        endsAt: "2026-07-21T11:00:00.000Z",
        hourlyRatePence: 6000,
        status: "completed",
        notes: "",
      }),
    );
  });

  it("makes an invoiced session read-only with a clear explanation", () => {
    render(
      <SessionForm
        initialValues={validValues}
        invoiced
        onSubmit={vi.fn()}
        practices={practices}
      />,
    );

    expect(
      screen.getByText("This session is included on an invoice and is read-only."),
    ).toBeVisible();
    expect(screen.getByLabelText("Session date")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save session" }),
    ).not.toBeInTheDocument();
  });

  it("preserves entries and hides raw details when save fails", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("IndexedDB private-detail"));
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={onSubmit}
        practices={practices}
      />,
    );
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Keep this note" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session could not be saved. Your entries have been kept.",
    );
    expect(screen.queryByText("IndexedDB private-detail")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Keep this note")).toBeVisible();
  });

  it("guards duplicate submissions synchronously", () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <SessionForm
        initialValues={validValues}
        onSubmit={onSubmit}
        practices={practices}
      />,
    );
    const button = screen.getByRole("button", { name: "Save session" });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Practice")).toBeDisabled();
  });
});
