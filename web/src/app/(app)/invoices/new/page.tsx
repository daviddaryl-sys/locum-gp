import { NewInvoice } from "@/features/invoices/InvoiceViews";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { draft } = await searchParams;
  return <NewInvoice draftId={draft} />;
}
