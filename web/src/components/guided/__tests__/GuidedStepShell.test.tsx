import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidedStepShell } from "../GuidedStepShell";

afterEach(cleanup);

describe("GuidedStepShell", () => {
  it("renders the title, intro, and a labelled action region without a step tracker", () => {
    render(
      <GuidedStepShell
        actionLabel="Save step actions"
        actions={<button type="button">Save expense</button>}
        intro="Answer a few short questions."
        title="Add expense"
      >
        <div>Form fields go here</div>
      </GuidedStepShell>,
    );

    expect(
      screen.getByRole("heading", { name: "Add expense" }),
    ).toBeVisible();
    expect(screen.getByText("Answer a few short questions.")).toBeVisible();
    expect(screen.queryByText(/Step \d of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByText("Guided steps")).not.toBeInTheDocument();
    expect(screen.getByText("Form fields go here")).toBeVisible();

    const actions = screen.getByRole("group", { name: "Save step actions" });
    expect(
      within(actions).getByRole("button", { name: "Save expense" }),
    ).toBeVisible();
  });

  it("keeps a labelled action region while allowing actions to submit a form rendered in children", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );
    const { container } = render(
      <GuidedStepShell
        actionFormId="expense-form"
        actionLabel="Expense form actions"
        actions={
          <div>
            <button type="submit">Save expense</button>
            <button type="button">Need help</button>
          </div>
        }
        intro="Answer a few short questions."
        title="Add expense"
      >
        <form aria-label="Expense form" id="expense-form" onSubmit={onSubmit}>
          <label>
            What did you buy?
            <input name="title" />
          </label>
        </form>
      </GuidedStepShell>,
    );

    expect(container.querySelectorAll("form")).toHaveLength(1);

    const actions = screen.getByRole("group", { name: "Expense form actions" });

    await user.click(within(actions).getByRole("button", { name: "Save expense" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(actions).toBeVisible();
  });
});
