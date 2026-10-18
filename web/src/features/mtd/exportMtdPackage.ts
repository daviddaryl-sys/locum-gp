import {
  buildMtdSummary,
  isIsoDate,
  isMtdExpenseCategory,
  type MtdExpenseRecord,
  type MtdInvoiceRecord,
  type MtdPeriod,
} from "@/domain/mtd";

type ExportExpense = MtdExpenseRecord & {
  supplierDescription?: string;
  receiptObjectKey?: string | null;
  notes?: string | null;
};

export function createMtdExportFiles({
  createdAt,
  expenses,
  invoices,
  period,
}: {
  createdAt: string;
  expenses: ExportExpense[];
  invoices: MtdInvoiceRecord[];
  period: MtdPeriod;
}) {
  const summary = buildMtdSummary({ expenses, invoices, period });
  const income = invoices
    .filter((invoice) =>
      !invoice.isDemo &&
      invoice.status === "paid" &&
      isIsoDate(invoice.paidAt) &&
      invoice.paidAt >= period.start &&
      invoice.paidAt <= period.end,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((invoice) => ({
      recordId: invoice.id,
      receivedDate: invoice.paidAt,
      turnoverPence: invoice.totalPence,
    }));
  const expenseRows = expenses
    .filter((expense) =>
      !expense.isDemo &&
      !expense.reimbursedByPractice &&
      expense.expenseDate >= period.start &&
      expense.expenseDate <= period.end &&
      isMtdExpenseCategory(expense.mtdCategory) &&
      Number.isInteger(expense.allowablePercentage) &&
      expense.allowablePercentage! >= 0 &&
      expense.allowablePercentage! <= 100,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((expense) => ({
      recordId: expense.id,
      date: expense.expenseDate,
      category: expense.mtdCategory,
      grossPence: expense.amountPence,
      allowablePercentage: expense.allowablePercentage,
      allowablePence: Math.round(expense.amountPence * expense.allowablePercentage! / 100),
      description: expense.supplierDescription ?? "",
    }));
  const payload = {
    schemaVersion: 1,
    filingStatus: "not-submitted",
    purpose: "Accountant or compatible bridging software review",
    createdAt,
    period,
    totals: {
      turnoverPence: summary.incomePence,
      allowableExpensesPence: summary.allowableExpensesPence,
      netPence: summary.netPence,
    },
    validationIssues: summary.issues,
    income,
    expenses: expenseRows,
  };
  const csvLines = [
    "record_type,record_id,date,category,gross_pence,allowable_percentage,allowable_pence",
    ...income.map((record) => `income,${record.recordId},${record.receivedDate},turnover,${record.turnoverPence},100,${record.turnoverPence}`),
    ...expenseRows.map((record) => `expense,${record.recordId},${record.date},${record.category},${record.grossPence},${record.allowablePercentage},${record.allowablePence}`),
  ];

  return {
    fileStem: `locum-manager-mtd-${period.start}-to-${period.end}`,
    json: JSON.stringify(payload, null, 2),
    csv: `${csvLines.join("\n")}\n`,
  };
}

export function downloadMtdFile(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
