import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  calculateDashboardMetrics,
  DashboardSummary,
} from "@/features/dashboard/DashboardSummary";

afterEach(cleanup);

describe("DashboardSummary", () => {
  it("calculates distinct integer-pence totals and excludes cancelled records", () => {
    const metrics = calculateDashboardMetrics({
      invoices: [
        { status: "paid", totalPence: 10001, issueDate: "2026-07-01", dueDate: "2026-07-31", issuedAt: "2026-07-01T12:00:00Z", paidAt: "2026-07-10" },
        { status: "sent", totalPence: 20002, issueDate: "2026-06-01", dueDate: "2026-07-01", issuedAt: "2026-06-01T12:00:00Z" },
        { status: "draft", totalPence: 30003, issueDate: "2026-07-20", dueDate: "2026-08-20", issuedAt: null },
        { status: "cancelled", totalPence: 99999, issueDate: "2026-07-01", dueDate: "2026-07-31", issuedAt: "2026-07-01T12:00:00Z" },
      ],
      sessions: [
        { id: "completed", status: "completed", startsAt: "2026-07-19T08:00:00Z" },
        { id: "invoiced", status: "invoiced", startsAt: "2026-07-18T08:00:00Z" },
        { id: "session-next", status: "planned", startsAt: "2026-07-21T08:00:00Z" },
      ],
      now: new Date("2026-07-20T12:00:00+01:00"),
    });

    expect(metrics).toMatchObject({
      paidThisYearPence: 10001,
      outstandingPence: 20002,
      overduePence: 20002,
      draftPence: 30003,
      uninvoicedCompletedCount: 1,
      upcomingSessionCount: 1,
    });
  });

  it("renders task-focused work tools and the next session", () => {
    render(
      <DashboardSummary
        metrics={{
          paidThisYearPence: 120000,
          outstandingPence: 50500,
          overduePence: 24000,
          draftPence: 18000,
          uninvoicedCompletedCount: 2,
          upcomingSessionCount: 1,
          nextSessionStartsAt: "2026-07-21T08:00:00.000Z",
          nextSessionId: "session-next",
          expenseThisTaxYearPence: 3450,
        }}
      />,
    );

    expect(screen.getByText("Next session")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Manage your work" }),
    ).toBeVisible();
    const workTools = within(
      screen.getByRole("heading", { name: "Manage your work" }).closest("section")!,
    ).getAllByRole("link");
    expect(workTools.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Add session",
      "Expenses",
      "Tax & MTD",
      "Create invoice",
    ]);
    const expensesLink = screen.getByRole("link", { name: "Expenses" });
    expect(expensesLink).toHaveAttribute("href", "/expenses");
    expect(expensesLink).toHaveAttribute(
      "aria-describedby",
      "dashboard-tool-expenses-description",
    );
    expect(screen.getByText("Record costs and receipts")).toHaveAttribute(
      "id",
      "dashboard-tool-expenses-description",
    );
    const taxLink = screen.getByRole("link", { name: "Tax & MTD" });
    expect(
      taxLink.querySelector('.dashboard-tool__icon[data-tone="tax-mtd"]'),
    ).not.toBeNull();
    expect(taxLink).toHaveAttribute("href", "/tax-mtd");
    expect(taxLink).toHaveAttribute(
      "aria-describedby",
      "dashboard-tool-tax-mtd-description",
    );
    expect(
      screen.getByText("Review quarterly digital tax totals"),
    ).toHaveAttribute("id", "dashboard-tool-tax-mtd-description");
    const addSessionLink = screen.getByRole("link", { name: "Add session" });
    expect(addSessionLink).toHaveAttribute(
      "href",
      "/sessions/new",
    );
    expect(
      addSessionLink.querySelector('.dashboard-tool__icon[data-tone="session"]'),
    ).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Add session" })).toHaveLength(1);
    const createInvoiceLink = screen.getByRole("link", {
      name: "Create invoice",
    });
    expect(createInvoiceLink).toHaveAttribute("href", "/invoices/new");
    expect(createInvoiceLink).toHaveAttribute(
      "aria-describedby",
      "dashboard-tool-invoice-description",
    );
    expect(
      createInvoiceLink.querySelector(
        '.dashboard-tool__icon[data-tone="invoice"] svg[data-icon="invoice"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText("Prepare a new invoice")).toHaveAttribute(
      "id",
      "dashboard-tool-invoice-description",
    );
    expect(screen.getAllByRole("link", { name: "Create invoice" })).toHaveLength(
      1,
    );
    expect(document.querySelector(".dashboard-shortcuts")).toBeNull();
    expect(screen.getByRole("link", { name: /Paid this year/ })).toHaveAttribute("href", "/invoices?status=paid&period=payment-year");
    expect(screen.getByRole("link", { name: /Outstanding/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Overdue/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Draft invoices/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Ready to invoice/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Expenses this tax year/ }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Next session/ })).toHaveAttribute("href", "/sessions/session-next");
  });

  it("puts the next session and useful actions ahead of the financial overview and tools", () => {
    const { container } = render(
      <DashboardSummary
        metrics={{
          paidThisYearPence: 0,
          outstandingPence: 0,
          overduePence: 0,
          draftPence: 0,
          uninvoicedCompletedCount: 0,
          upcomingSessionCount: 1,
          nextSessionStartsAt: "2026-08-11T09:00:00.000Z",
          nextSessionId: "session-next",
          expenseThisTaxYearPence: 0,
        }}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeVisible();
    const summary = container.querySelector(".dashboard-summary")!;
    expect(summary.children[0]).toHaveClass("dashboard-heading");
    expect(summary.children[1]).toHaveClass("dashboard-focus");
    expect(summary.children[2]).toHaveClass("financial-overview");
    expect(screen.getByText("You’re up to date")).toBeVisible();
  });

  it("offers a new booking when there is no next session", () => {
    render(
      <DashboardSummary
        metrics={{
          paidThisYearPence: 0,
          outstandingPence: 0,
          overduePence: 0,
          draftPence: 0,
          uninvoicedCompletedCount: 0,
          upcomingSessionCount: 0,
          nextSessionStartsAt: null,
          nextSessionId: null,
          expenseThisTaxYearPence: 0,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: /Next session/ })).toHaveAttribute(
      "href",
      "/sessions/new",
    );
  });

  it("counts money in its received year and flags undated paid invoices without estimating dates", () => {
    const invoice = { status: "paid" as const, totalPence: 10000, issueDate: "2026-07-01", dueDate: null, issuedAt: null };
    const metrics = calculateDashboardMetrics({
      invoices: [
        { ...invoice, issueDate: "2025-12-20", paidAt: "2026-01-03", totalPence: 12501 },
        { ...invoice, paidAt: "2027-01-02", totalPence: 25000 },
        { ...invoice, paidAt: null },
        { ...invoice, status: "cancelled", paidAt: "2026-07-05" },
      ],
      sessions: [],
      now: new Date("2026-09-05T12:00:00Z"),
    });
    expect(metrics.paidThisYearPence).toBe(12501);
    expect(metrics.undatedPaidCount).toBe(1);
    render(<DashboardSummary metrics={metrics} />);
    expect(screen.getByRole("link", { name: /Check payment dates/ })).toHaveAttribute("href", "/invoices?status=paid&period=missing-payment-date");
    expect(screen.getByRole("link", { name: /excluded. Review payment dates/ })).toBeVisible();
  });

  it("changes the received-year total at the London new-year boundary", () => {
    const invoices = [
      { status: "paid" as const, totalPence: 10001, issueDate: "2026-12-01", dueDate: null, issuedAt: null, paidAt: "2026-12-31" },
      { status: "paid" as const, totalPence: 20002, issueDate: "2026-12-01", dueDate: null, issuedAt: null, paidAt: "2027-01-01" },
    ];
    expect(calculateDashboardMetrics({ invoices, sessions: [], now: new Date("2026-12-31T23:59:59Z") }).paidThisYearPence).toBe(10001);
    expect(calculateDashboardMetrics({ invoices, sessions: [], now: new Date("2027-01-01T00:00:00Z") }).paidThisYearPence).toBe(20002);
  });

  it("identifies the practice for the earliest upcoming planned session", () => {
    const metrics = calculateDashboardMetrics({
      invoices: [],
      sessions: [
        { id: "later", status: "planned", startsAt: "2026-09-09T08:00:00Z", practiceName: "Later Practice (Demo)" },
        { id: "next", status: "planned", startsAt: "2026-09-07T08:00:00Z", practiceName: "Riverside Practice (Demo)" },
        { id: "cancelled", status: "cancelled", startsAt: "2026-09-06T08:00:00Z", practiceName: "Cancelled Practice (Demo)" },
      ],
      now: new Date("2026-09-05T12:00:00Z"),
    });
    render(<DashboardSummary metrics={metrics} />);
    expect(screen.getByRole("link", { name: /Next session: Riverside Practice/ })).toHaveAttribute("href", "/sessions/next");
    expect(metrics.upcomingSessionCount).toBe(2);
  });
});
