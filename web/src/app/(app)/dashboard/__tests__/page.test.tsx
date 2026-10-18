import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DashboardPage from "../page";

vi.mock("@/features/dashboard/DashboardSummary", () => ({
  DashboardWorkspace: () => <div data-testid="dashboard-workspace" />,
}));

describe("DashboardPage", () => {
  it("delegates the visible page heading to the next-session workspace", () => {
    render(<DashboardPage />);

    expect(screen.queryByText("Locum Manager")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();
    expect(
      screen.queryByText(
        "A clear overview of your locum work and invoice progress.",
      ),
    ).toBeNull();
    expect(screen.getByTestId("dashboard-workspace")).toBeVisible();
  });
});
