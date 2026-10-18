import { describe, expect, it, vi } from "vitest";

import {
  invoiceTextContent,
  type InvoicePdfData,
} from "@/pdf/InvoiceDocument";
import {
  generateInvoicePdf,
  issuedInvoiceArtifactPath,
  shareInvoicePdf,
  uploadIssuedInvoicePdf,
} from "@/pdf/generateInvoicePdf";

const invoice: InvoicePdfData = {
  invoiceNumber: "INV-2026-0001",
  issueDate: "2026-08-12",
  dueDate: "2026-09-11",
  issuer: {
    name: "Dr Alex Example",
    address: "10 Example Street, London",
  },
  practice: {
    name: "Riverside Medical Centre",
    billingAddress: "1 Riverside Road, London",
  },
  payment: {
    accountName: "Dr Alex Example",
    sortCode: "12-34-56",
    accountNumber: "12345678",
  },
  items: [
    {
      description: "GP locum session",
      quantity: 4,
      unitRatePence: 6500,
      lineTotalPence: 26000,
    },
  ],
  totalPence: 26000,
};

describe("invoice PDF", () => {
  it("contains the immutable invoice, recipient, item, total, and payment snapshot", () => {
    const text = invoiceTextContent(invoice).join(" ");

    for (const expected of [
      "INV-2026-0001",
      "Riverside Medical Centre",
      "GP locum session",
      "£260.00",
      "12-34-56",
      "12345678",
      "12 August 2026",
      "11 September 2026",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("generates a non-empty A4 PDF blob", async () => {
    const blob = await generateInvoicePdf(invoice);

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(500);
  });

  it("uses Web Share only when file sharing is supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const blob = new Blob(["pdf"], { type: "application/pdf" });

    await expect(
      shareInvoicePdf(blob, "INV-2026-0001.pdf", { canShare, share }),
    ).resolves.toBe(true);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.any(File)] }),
    );
  });

  it("returns the download fallback when Web Share file support is absent", async () => {
    const share = vi.fn();
    const blob = new Blob(["pdf"], { type: "application/pdf" });

    await expect(
      shareInvoicePdf(blob, "INV-2026-0001.pdf", {
        canShare: () => false,
        share,
      }),
    ).resolves.toBe(false);
    expect(share).not.toHaveBeenCalled();
  });

  it("uses an owner-protected immutable storage path", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upload });
    const blob = new Blob(["pdf"], { type: "application/pdf" });

    expect(
      issuedInvoiceArtifactPath(
        "10000000-0000-0000-0000-000000000001",
        "invoice-1",
      ),
    ).toBe(
      "10000000-0000-0000-0000-000000000001/invoices/invoice-1.pdf",
    );
    await expect(
      uploadIssuedInvoicePdf(
        { storage: { from } },
        "10000000-0000-0000-0000-000000000001",
        "invoice-1",
        blob,
      ),
    ).resolves.toBe(
      "10000000-0000-0000-0000-000000000001/invoices/invoice-1.pdf",
    );
    expect(from).toHaveBeenCalledWith("invoice-artifacts");
    expect(upload).toHaveBeenCalledWith(
      "10000000-0000-0000-0000-000000000001/invoices/invoice-1.pdf",
      blob,
      expect.objectContaining({ contentType: "application/pdf", upsert: false }),
    );
  });
});
