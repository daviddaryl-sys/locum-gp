import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PracticeForm, emptyPracticeFormValues } from "@/features/practices/PracticeForm";
import { SessionForm, emptySessionFormValues } from "@/features/sessions/SessionForm";
import { buildDemoFixtures } from "@/features/demo/demoFixtures";
import { DEMO_RECEIPT_HEADING, DemoReceiptDocument } from "@/features/demo/DemoReceiptDocument";
import { DEMO_PRACTICE_SOURCES } from "@/features/demo/practiceSources";

afterEach(cleanup);

const ownerId = "11111111-1111-4111-8111-111111111111";
const approvedNames = [
  "Wembley Park Medical Centre",
  "The Wembley Practice",
  "The Civic Medical Centre",
  "Ealing Park Health Centre",
  "London Fields Medical Centre",
  "The Streatfield Medical Centre",
  "Perivale Medical Clinic",
  "Hillview Surgery",
  "Elmtrees Surgery",
  "Greenford Road Medical Centre",
  "Allendale Road Surgery",
];

describe("demo fixtures", () => {
  it("builds the same owner-scoped fictional dataset every time", async () => {
    const first = await buildDemoFixtures(ownerId, "2026-08-02");
    const second = await buildDemoFixtures(ownerId, "2026-08-02");
    const byType = (recordType: string) =>
      first.fixtures.filter((fixture) => fixture.recordType === recordType);
    const practices = byType("practices");
    const sessions = byType("sessions");
    const invoices = byType("invoices");
    const invoiceItems = byType("invoiceItems");
    const expenses = byType("expenses");

    expect(first).toEqual(second);
    expect(practices).toHaveLength(11);
    expect(sessions).toHaveLength(8);
    expect(invoices).toHaveLength(6);
    expect(invoiceItems).toHaveLength(6);
    expect(expenses).toHaveLength(16);
    expect(expenses.filter((item) => item.data.reimbursedByPractice)).toHaveLength(2);
    expect(expenses.filter((item) => item.data.needsAccountantReview).length).toBeGreaterThanOrEqual(4);
    expect(expenses.every((item) => item.data.isDemo)).toBe(true);
    expect(practices.map((item) => item.data.name)).toEqual(approvedNames);
    expect(practices.every((item) => (item.data.billingAddress as { formatted: string }).formatted === "Demo address — not for correspondence")).toBe(true);
    expect(invoices.every((item) => String(item.data.invoiceNumber).startsWith("DEMO-"))).toBe(true);
    expect(new Set(invoices.map((item) => item.data.status))).toEqual(new Set(["paid", "sent", "draft"]));
    expect(invoices.some((item) => item.data.status === "sent" && String(item.data.dueDate) < "2026-08-02")).toBe(true);
    expect(practices.every((item) => !Object.keys(item.data).some((key) => /telephone|phone|email|patient|staff/i.test(key)))).toBe(true);
  });

  it("marks every generated receipt page as unmistakable demo data", () => {
    const document = DemoReceiptDocument({ amountPence: 1250, date: "2026-04-09", reference: "Demo expense 1" });
    expect(JSON.stringify(document)).toContain(DEMO_RECEIPT_HEADING);
  });

  it("records only reviewed public practice names and NHS sources", () => {
    expect(DEMO_PRACTICE_SOURCES.map((item) => item.name)).toEqual(approvedNames);
    expect(DEMO_PRACTICE_SOURCES.every((item) => item.verifiedAt === "2026-08-02")).toBe(true);
    expect(DEMO_PRACTICE_SOURCES.every((item) => item.sourceUrl.startsWith("https://www.nhs.uk/"))).toBe(true);
  });

  it("shows all 11 seeded practices in the session choice while Add Practice stays free text", async () => {
    const fixtures = await buildDemoFixtures(ownerId, "2026-08-02");
    const practices = fixtures.fixtures.filter((fixture) => fixture.recordType === "practices");
    render(
      <SessionForm
        initialValues={emptySessionFormValues}
        onSubmit={vi.fn()}
        practices={practices.map((item) => ({
          archived: Boolean(item.data.archived),
          defaultHourlyRatePence: Number(item.data.defaultHourlyRatePence),
          id: item.id,
          name: String(item.data.name),
        }))}
      />,
    );
    for (const name of approvedNames) {
      expect(screen.getByRole("option", { name })).toBeVisible();
    }
    cleanup();

    render(<PracticeForm initialValues={emptyPracticeFormValues} onSubmit={vi.fn()} />);
    const nameField = screen.getByLabelText("Practice name");
    expect(nameField.tagName).toBe("INPUT");
    fireEvent.change(nameField, { target: { value: "My manually entered practice" } });
    expect(nameField).toHaveValue("My manually entered practice");
  });
});
