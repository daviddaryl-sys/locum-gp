import { describe, expect, it } from "vitest";

import type { InvoiceDraft } from "@/features/invoices/InvoiceWizard";
import {
  draftInvoiceItemRecords,
  draftInvoiceRecord,
  invoiceIssueArguments,
  invoiceStatusPayload,
  parseEncryptedPaymentSnapshot,
  parseInvoiceData,
  filterInvoiceEntries,
  missingPaymentDatePayload,
} from "@/features/invoices/InvoiceViews";
import type { EncryptedVault } from "@/security/vault";

const encryptedVault: EncryptedVault = {
  version: 1,
  ciphertext: "opaque-ciphertext",
  salt: "opaque-salt",
  initializationVector: "opaque-iv",
  kdfParameters: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 310_000,
  },
};

const encryptedServerSnapshot = {
  version: 2 as const,
  ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
  salt: "AAECAwQFBgcICQoLDA0ODw==",
  initializationVector: "EBESExQVFhcYGRob",
  kdfParameters: {
    name: "HKDF" as const,
    hash: "SHA-256" as const,
    info: "locum-manager-payment:v2" as const,
  },
};

const draft: InvoiceDraft = {
  id: "invoice-1",
  practiceId: "practice-1",
  issueDate: "2026-08-12",
  dueDate: "2026-09-11",
  selectedSessionIds: ["session-1"],
  items: [
    {
      id: "item-1",
      sessionId: "session-1",
      description: "GP locum session",
      quantity: 4,
      unitRatePence: 6500,
      lineTotalPence: 26000,
    },
  ],
  totalPence: 26000,
  practiceSnapshot: {
    name: "Riverside Medical Centre",
    billingAddress: "1 Riverside Road, London",
  },
  paymentSnapshot: {
    accountName: "Dr Private",
    sortCode: "12-34-56",
    accountNumber: "12345678",
  },
};

describe("invoice offline and issuance adapters", () => {
  it("persists a recoverable draft and its items without plaintext payment data", () => {
    const record = draftInvoiceRecord(draft);
    const items = draftInvoiceItemRecords(draft);
    const persisted = JSON.stringify({ record, items });

    expect(record).toMatchObject({
      practiceId: "practice-1",
      issueDate: "2026-08-12",
      totalPence: 26000,
      status: "draft",
      paidAt: null,
    });
    expect(items).toEqual([
      expect.objectContaining({
        id: "item-1",
        data: expect.objectContaining({
          invoiceId: "invoice-1",
          sessionId: "session-1",
          lineTotalPence: 26000,
        }),
      }),
    ]);
    expect(persisted).not.toContain("Dr Private");
    expect(persisted).not.toContain("12-34-56");
    expect(persisted).not.toContain("12345678");
  });

  it("sends only the encrypted payment snapshot to atomic issuance", () => {
    const args = invoiceIssueArguments(draft, encryptedVault);
    const serialized = JSON.stringify(args);

    expect(args).toMatchObject({
      requested_invoice_id: "invoice-1",
      requested_practice_id: "practice-1",
      requested_prefix: "INV",
      requested_payment_snapshot: encryptedVault,
    });
    expect(serialized).not.toContain("Dr Private");
    expect(serialized).not.toContain("12-34-56");
    expect(serialized).not.toContain("12345678");
  });

  it("issues new invoices with an exact version 2 encrypted snapshot", () => {
    const args = invoiceIssueArguments(draft, encryptedServerSnapshot);
    expect(args.requested_payment_snapshot).toEqual(encryptedServerSnapshot);
    expect(JSON.stringify(args)).not.toContain("12345678");
  });

  it("accepts only the versioned encrypted envelope from issued records", () => {
    expect(parseEncryptedPaymentSnapshot(encryptedVault)).toEqual(encryptedVault);
    expect(parseEncryptedPaymentSnapshot(encryptedServerSnapshot)).toEqual(encryptedServerSnapshot);
    expect(
      parseEncryptedPaymentSnapshot({
        accountName: "Dr Private",
        sortCode: "12-34-56",
        accountNumber: "12345678",
      }),
    ).toBeNull();
  });

  it("rejects readable or non-exact version 2 payment envelopes", () => {
    expect(parseEncryptedPaymentSnapshot({
      ...encryptedServerSnapshot,
      accountNumber: "12345678",
    })).toBeNull();
    expect(parseEncryptedPaymentSnapshot({
      ...encryptedServerSnapshot,
      kdfParameters: { ...encryptedServerSnapshot.kdfParameters, info: "wrong" },
    })).toBeNull();
  });

  it("parses immutable issued invoice fields for the list and detail routes", () => {
    expect(
      parseInvoiceData({
        invoiceNumber: "INV-2026-0001",
        status: "sent",
        issueDate: "2026-08-12",
        dueDate: "2026-09-11",
        totalPence: 26000,
        practiceId: "practice-1",
        practiceSnapshot: {
          id: "practice-1",
          name: "Riverside Medical Centre",
          billingAddress: { formatted: "1 Riverside Road, London" },
        },
        paymentSnapshot: encryptedVault,
        issuedAt: "2026-08-12T12:00:00.000Z",
        artifactPath: null,
        paidAt: "2026-08-20",
      }),
    ).toMatchObject({
      invoiceNumber: "INV-2026-0001",
      practiceName: "Riverside Medical Centre",
      billingAddress: "1 Riverside Road, London",
      totalPence: 26000,
      issuedAt: "2026-08-12T12:00:00.000Z",
      paidAt: "2026-08-20",
    });
  });

  it("requires a valid received date when an invoice is marked paid", () => {
    const payload = { status: "sent", paidAt: null, totalPence: 26000 };
    expect(invoiceStatusPayload(payload, "paid", "2026-08-20")).toEqual({
      status: "paid",
      paidAt: "2026-08-20",
      totalPence: 26000,
    });
    expect(invoiceStatusPayload({ ...payload, paidAt: "2026-08-20" }, "sent")).toEqual({
      status: "sent",
      paidAt: null,
      totalPence: 26000,
    });
    expect(() => invoiceStatusPayload(payload, "paid", "2026-02-30")).toThrow("Choose a valid payment-received date.");
  });

  it("rejects invalid stored payment dates", () => {
    expect(parseInvoiceData({
      invoiceNumber: "INV-2026-0001",
      status: "paid",
      issueDate: "2026-08-12",
      dueDate: "2026-09-11",
      totalPence: 26000,
      practiceId: "practice-1",
      practiceSnapshot: null,
      paymentSnapshot: null,
      issuedAt: "2026-08-12T12:00:00.000Z",
      artifactPath: null,
      paidAt: "not-a-date",
    })).toBeNull();
  });
});

describe("invoice URL filters", () => {
  it("adds a missing received date without changing invoice contents or replacing an existing date", () => {
    const payload = { status: "paid", paidAt: null, totalPence: 38500, invoiceNumber: "DEMO-OLD", issueDate: "2025-12-20" };
    expect(missingPaymentDatePayload(payload, "2026-01-03")).toEqual({ ...payload, paidAt: "2026-01-03" });
    expect(() => missingPaymentDatePayload(payload, "2026-02-30")).toThrow("Choose a valid payment-received date.");
    expect(() => missingPaymentDatePayload({ ...payload, paidAt: "2026-01-01" }, "2026-01-03")).toThrow("This invoice has changed.");
    expect(() => missingPaymentDatePayload({ ...payload, status: "cancelled" }, "2026-01-03")).toThrow("This invoice has changed.");
  });
  const entries = [
    { data: { status: "paid", issueDate: "2026-01-02", dueDate: "2026-02-01" } },
    { data: { status: "sent", issueDate: "2025-12-01", dueDate: "2026-01-01" } },
  ] as never;
  it("filters paid calendar-year and overdue invoices", () => {
    expect(filterInvoiceEntries(entries, { status: "paid", period: "calendar-year" }, "2026-08-02")).toHaveLength(1);
    expect(filterInvoiceEntries(entries, { status: "overdue", period: "all" }, "2026-08-02")).toHaveLength(1);
  });
  it("falls back to all entries for invalid URL filters", () => {
    expect(filterInvoiceEntries(entries, { status: "unknown", period: "future" }, "2026-08-02")).toHaveLength(2);
  });

  it("opens received-year invoices using payment dates rather than issue dates", () => {
    const invoices = [
      { id: "received", data: { status: "paid" as const, issueDate: "2025-12-20", dueDate: null, paidAt: "2026-01-03" } },
      { id: "next-year", data: { status: "paid" as const, issueDate: "2026-12-20", dueDate: null, paidAt: "2027-01-03" } },
      { id: "undated", data: { status: "paid" as const, issueDate: "2026-07-01", dueDate: null, paidAt: null } },
    ];
    expect(filterInvoiceEntries(invoices, { status: "paid", period: "payment-year" }, "2026-09-05").map(({ id }) => id)).toEqual(["received"]);
    expect(filterInvoiceEntries(invoices, { status: "paid", period: "calendar-year" }, "2026-09-05").map(({ id }) => id)).toEqual(["next-year", "undated"]);
    expect(filterInvoiceEntries(invoices, { status: "paid", period: "missing-payment-date" }, "2026-09-05").map(({ id }) => id)).toEqual(["undated"]);
  });
});
