export const MTD_EXPENSE_CATEGORIES = [
  { key: "cost_of_goods", label: "Cost of goods bought for resale or goods used" },
  { key: "construction_subcontractors", label: "Construction industry payments to subcontractors" },
  { key: "staff_costs", label: "Wages, salaries, and other staff costs" },
  { key: "travel_costs", label: "Car, van, and travel expenses" },
  { key: "premises_costs", label: "Rent, rates, power, and insurance" },
  { key: "repairs_maintenance", label: "Repairs and maintenance of property and equipment" },
  { key: "office_costs", label: "Phone, stationery, and other office costs" },
  { key: "advertising", label: "Advertising and business promotion" },
  { key: "business_entertainment", label: "Business entertainment costs" },
  { key: "interest", label: "Interest on bank and other business loans" },
  { key: "financial_charges", label: "Bank, credit card, and other financial charges" },
  { key: "professional_fees", label: "Accountancy, legal, and other professional fees" },
  { key: "other_business_expenses", label: "Other business expenses" },
] as const;

export type MtdExpenseCategory = (typeof MTD_EXPENSE_CATEGORIES)[number]["key"];
export type MtdPeriodId = "quarter-1" | "quarter-2" | "quarter-3" | "quarter-4";
export type MtdPeriod = {
  id: MtdPeriodId;
  label: string;
  start: string;
  end: string;
};

export type MtdInvoiceRecord = {
  id: string;
  status: string;
  paidAt: string | null;
  totalPence: number;
  isDemo: boolean;
};

export type MtdExpenseRecord = {
  id: string;
  expenseDate: string;
  amountPence: number;
  mtdCategory: MtdExpenseCategory | null;
  allowablePercentage: number | null;
  reimbursedByPractice: boolean;
  needsAccountantReview: boolean;
  isDemo: boolean;
};

export type MtdIssue = {
  recordType: "invoice" | "expense";
  recordId: string;
  message: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_KEYS = new Set<string>(MTD_EXPENSE_CATEGORIES.map(({ key }) => key));

export function isMtdExpenseCategory(value: unknown): value is MtdExpenseCategory {
  return typeof value === "string" && CATEGORY_KEYS.has(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function taxYearStart(referenceDate: string) {
  if (!isIsoDate(referenceDate)) throw new Error("Reference date must be a valid YYYY-MM-DD date.");
  const year = Number(referenceDate.slice(0, 4));
  return referenceDate.slice(5) < "04-06" ? year - 1 : year;
}

export function buildMtdPeriods(referenceDate: string): MtdPeriod[] {
  const year = taxYearStart(referenceDate);
  return [
    { id: "quarter-1", label: `Quarter 1 · to 5 July ${year}`, start: `${year}-04-06`, end: `${year}-07-05` },
    { id: "quarter-2", label: `Quarter 2 · to 5 October ${year}`, start: `${year}-04-06`, end: `${year}-10-05` },
    { id: "quarter-3", label: `Quarter 3 · to 5 January ${year + 1}`, start: `${year}-04-06`, end: `${year + 1}-01-05` },
    { id: "quarter-4", label: `Quarter 4 · to 5 April ${year + 1}`, start: `${year}-04-06`, end: `${year + 1}-04-05` },
  ];
}

export function resolveMtdPeriod(periodId: string, referenceDate: string): MtdPeriod {
  const periods = buildMtdPeriods(referenceDate);
  return periods.find(({ id }) => id === periodId)
    ?? periods.find(({ end }) => referenceDate <= end)
    ?? periods.at(-1)!;
}

function addPence(total: number, value: number) {
  const next = total + value;
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(next)) {
    throw new Error("MTD amount must be a non-negative safe integer number of pence.");
  }
  return next;
}

export function buildMtdSummary({
  period,
  invoices,
  expenses,
}: {
  period: MtdPeriod;
  invoices: MtdInvoiceRecord[];
  expenses: MtdExpenseRecord[];
}) {
  const issues: MtdIssue[] = [];
  let incomePence = 0;
  let incomeCount = 0;
  const categoryTotals = new Map<MtdExpenseCategory, number>();
  let expenseCount = 0;

  for (const invoice of invoices) {
    if (invoice.isDemo || invoice.status !== "paid") continue;
    if (!isIsoDate(invoice.paidAt)) {
      issues.push({ recordType: "invoice", recordId: invoice.id, message: "Add the payment-received date." });
      continue;
    }
    if (invoice.paidAt < period.start || invoice.paidAt > period.end) continue;
    incomePence = addPence(incomePence, invoice.totalPence);
    incomeCount += 1;
  }

  for (const expense of expenses) {
    if (expense.isDemo || expense.expenseDate < period.start || expense.expenseDate > period.end) continue;
    if (expense.needsAccountantReview) {
      issues.push({ recordType: "expense", recordId: expense.id, message: "Review this expense with your accountant." });
    }
    const allowablePercentage = expense.allowablePercentage;
    if (!isMtdExpenseCategory(expense.mtdCategory) || !Number.isInteger(allowablePercentage) || allowablePercentage! < 0 || allowablePercentage! > 100) {
      issues.push({ recordType: "expense", recordId: expense.id, message: "Choose an HMRC category and allowable percentage." });
      continue;
    }
    if (expense.reimbursedByPractice) continue;
    const allowablePence = Math.round(expense.amountPence * allowablePercentage! / 100);
    const current = categoryTotals.get(expense.mtdCategory) ?? 0;
    categoryTotals.set(expense.mtdCategory, addPence(current, allowablePence));
    expenseCount += 1;
  }

  const expensesByCategory = MTD_EXPENSE_CATEGORIES.flatMap(({ key }) => {
    const totalPence = categoryTotals.get(key);
    return totalPence === undefined ? [] : [{ category: key, totalPence }];
  });
  const allowableExpensesPence = expensesByCategory.reduce(
    (total, item) => addPence(total, item.totalPence),
    0,
  );

  return {
    incomePence,
    incomeCount,
    allowableExpensesPence,
    expenseCount,
    netPence: incomePence - allowableExpensesPence,
    expensesByCategory,
    issues,
    status: issues.length ? "needs-review" as const : "ready" as const,
  };
}
