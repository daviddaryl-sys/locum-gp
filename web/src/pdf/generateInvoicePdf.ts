import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";

import { InvoiceDocument, type InvoicePdfData } from "@/pdf/InvoiceDocument";

type ShareNavigator = {
  canShare?: (data: ShareData) => boolean;
  share: (data: ShareData) => Promise<void>;
};

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Blob,
        options: { contentType: string; upsert: boolean },
      ) => PromiseLike<{ error: unknown }>;
    };
  };
};

export async function generateInvoicePdf(data: InvoicePdfData) {
  const document = createElement(InvoiceDocument, { data }) as unknown as Parameters<
    typeof pdf
  >[0];
  return pdf(document).toBlob();
}

export async function shareInvoicePdf(
  blob: Blob,
  filename: string,
  shareNavigator: ShareNavigator = navigator,
) {
  const file = new File([blob], filename, { type: "application/pdf" });
  const shareData: ShareData = {
    files: [file],
    title: filename.replace(/\.pdf$/i, ""),
  };
  if (!shareNavigator.canShare?.(shareData)) return false;
  await shareNavigator.share(shareData);
  return true;
}

export function downloadInvoicePdf(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function issuedInvoiceArtifactPath(ownerId: string, invoiceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ownerId)) {
    throw new Error("Invoice owner is invalid.");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(invoiceId)) {
    throw new Error("Invoice identifier is invalid.");
  }
  return `${ownerId}/invoices/${invoiceId}.pdf`;
}

export async function uploadIssuedInvoicePdf(
  client: StorageClient,
  ownerId: string,
  invoiceId: string,
  blob: Blob,
) {
  const path = issuedInvoiceArtifactPath(ownerId, invoiceId);
  const result = await client.storage.from("invoice-artifacts").upload(path, blob, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (result.error) throw new Error("Invoice PDF could not be stored securely.");
  return path;
}
