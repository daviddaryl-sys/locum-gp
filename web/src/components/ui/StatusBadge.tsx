export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

const statusLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const label = statusLabels[status];

  return (
    <span
      aria-label={`Invoice status: ${label}`}
      className="status-badge"
      data-status={status}
    >
      <span aria-hidden="true" className="status-badge__dot" />
      {label}
    </span>
  );
}
