import { describe, expect, it } from "vitest";

import {
  buildDemoFixtures,
  DEMO_ADDRESS,
  isDemoInvoicePayload,
  isDemoPracticePayload,
  isDemoSessionPayload,
} from "../demoFixtures";
import { DEMO_PRACTICE_SOURCES } from "../practiceSources";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("standalone demo fixtures", () => {
  it("builds the same owner-scoped 11-practice dataset without private data", async () => {
    const first = await buildDemoFixtures(ownerA, "2026-08-03");
    const second = await buildDemoFixtures(ownerA, "2026-08-03");
    const otherOwner = await buildDemoFixtures(ownerB, "2026-08-03");

    expect(first).toEqual(second);
    expect(first.ids.practices).toHaveLength(11);
    expect(first.ids.sessions).toHaveLength(8);
    expect(first.ids.invoices).toHaveLength(6);
    expect(first.ids.invoiceItems).toHaveLength(6);
    expect(first.ids.expenses).toHaveLength(16);
    expect(first.fixtures).toHaveLength(47);
    expect(first.fixtures.every((fixture) => uuidPattern.test(fixture.id))).toBe(
      true,
    );
    expect(first.fixtures.map((fixture) => fixture.id)).not.toEqual(
      otherOwner.fixtures.map((fixture) => fixture.id),
    );

    const practices = first.fixtures.filter(
      (fixture) => fixture.recordType === "practices",
    );
    expect(practices.map((fixture) => fixture.data.name)).toEqual(
      DEMO_PRACTICE_SOURCES.map((practice) => practice.name),
    );
    expect(
      practices.every(
        (fixture) =>
          (fixture.data.billingAddress as { formatted: string }).formatted ===
          DEMO_ADDRESS,
      ),
    ).toBe(true);

    const sessions = first.fixtures.filter(
      (fixture) => fixture.recordType === "sessions",
    );
    const invoices = first.fixtures.filter(
      (fixture) => fixture.recordType === "invoices",
    );
    const expenses = first.fixtures.filter(
      (fixture) => fixture.recordType === "expenses",
    );
    expect(expenses).toHaveLength(16);
    expect(expenses.every((fixture) => typeof fixture.data.mtdCategory === "string")).toBe(true);
    expect(expenses.every((fixture) => fixture.data.allowablePercentage === 100)).toBe(true);
    expect(invoices.filter((fixture) => fixture.data.status === "paid").every((fixture) => typeof fixture.data.paidAt === "string")).toBe(true);
    expect(new Set(invoices.map((fixture) => fixture.data.status))).toEqual(
      new Set(["draft", "sent", "paid"]),
    );
    expect(
      invoices.some(
        (fixture) =>
          fixture.data.status === "sent" &&
          String(fixture.data.dueDate) < "2026-08-03",
      ),
    ).toBe(true);
    expect(invoices.every((fixture) => fixture.data.issuedAt === null)).toBe(
      true,
    );
    expect(invoices.every((fixture) => fixture.data.paymentSnapshot === null)).toBe(
      true,
    );
    expect(practices.every((fixture) => isDemoPracticePayload(fixture.data))).toBe(
      true,
    );
    expect(sessions.every((fixture) => isDemoSessionPayload(fixture.data))).toBe(
      true,
    );
    expect(invoices.every((fixture) => isDemoInvoicePayload(fixture.data))).toBe(
      true,
    );

    const serialized = JSON.stringify(first).toLocaleLowerCase("en-GB");
    for (const forbidden of [
      "accountnumber",
      "sortcode",
      "patient",
      "telephone",
      "email",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
