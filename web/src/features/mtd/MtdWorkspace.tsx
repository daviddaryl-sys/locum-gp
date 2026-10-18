"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { parseExpenseData } from "@/domain/expense";
import {
  buildMtdPeriods,
  buildMtdSummary,
  MTD_EXPENSE_CATEGORIES,
  resolveMtdPeriod,
  type MtdExpenseRecord,
  type MtdInvoiceRecord,
  type MtdPeriod,
} from "@/domain/mtd";
import { parseInvoiceData } from "@/features/invoices/InvoiceViews";
import { useOfflineRecords } from "@/offline/useRecords";

function formatSignedGBP(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    style: "currency",
  }).format(pence / 100);
}

function todayInLondon() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/London",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function MtdWorkspaceView({
  expenses,
  invoices,
  referenceDate,
}: {
  expenses: MtdExpenseRecord[];
  invoices: MtdInvoiceRecord[];
  referenceDate: string;
}) {
  const periods = useMemo(() => buildMtdPeriods(referenceDate), [referenceDate]);
  const [periodId, setPeriodId] = useState(
    () => resolveMtdPeriod("", referenceDate).id,
  );
  const period = resolveMtdPeriod(periodId, referenceDate);
  const summary = buildMtdSummary({ expenses, invoices, period });
  const categoryLabels = new Map(
    MTD_EXPENSE_CATEGORIES.map(({ key, label }) => [key, label]),
  );

  return (
    <section aria-labelledby="mtd-title" className="record-page mtd-workspace">
      <Link className="back-link" href="/more">← Back to My account</Link>
      <p className="eyebrow">Digital tax records</p>
      <h1 id="mtd-title">Tax &amp; MTD</h1>
      <p className="mtd-workspace__intro">
        Review cumulative income and allowable expenses for your selected update period.
      </p>

      <div className="mtd-period">
        <label htmlFor="mtd-period">Cumulative update period</label>
        <select
          id="mtd-period"
          onChange={(event) => setPeriodId(event.target.value as MtdPeriod["id"])}
          value={periodId}
        >
          {periods.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        <p>{period.start} to {period.end}</p>
      </div>

      <div className="mtd-status" data-status={summary.status}>
        <strong>{summary.status === "ready" ? "Ready for review" : "Needs review"}</strong>
        <span>{summary.issues.length} record issue{summary.issues.length === 1 ? "" : "s"}</span>
      </div>

      <div className="mtd-summary">
        <article><span>Turnover received</span><strong>{formatSignedGBP(summary.incomePence)}</strong><small>{summary.incomeCount} paid invoice{summary.incomeCount === 1 ? "" : "s"}</small></article>
        <article><span>Allowable expenses</span><strong>{formatSignedGBP(summary.allowableExpensesPence)}</strong><small>{summary.expenseCount} expense{summary.expenseCount === 1 ? "" : "s"}</small></article>
        <article><span>Net amount</span><strong>{formatSignedGBP(summary.netPence)}</strong><small>Before tax adjustments</small></article>
      </div>

      <section className="mtd-breakdown" aria-labelledby="mtd-breakdown-title">
        <h2 id="mtd-breakdown-title">Allowable expenses by HMRC category</h2>
        {summary.expensesByCategory.length ? (
          <dl>{summary.expensesByCategory.map((item) => (
            <div key={item.category}><dt>{categoryLabels.get(item.category)}</dt><dd>{formatSignedGBP(item.totalPence)}</dd></div>
          ))}</dl>
        ) : <p>No allowable expenses in this period.</p>}
      </section>

      {summary.issues.length ? (
        <section className="mtd-issues" aria-labelledby="mtd-issues-title">
          <h2 id="mtd-issues-title">Records to review</h2>
          <ul>{summary.issues.map((issue) => (
            <li key={`${issue.recordType}-${issue.recordId}-${issue.message}`}>
              <Link href={`/${issue.recordType === "invoice" ? "invoices" : "expenses"}/${issue.recordId}`}>{issue.message}</Link>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <aside className="mtd-notice">
        <strong>Not submitted to HMRC.</strong>
      </aside>
    </section>
  );
}

export function MtdWorkspace() {
  const invoiceRecords = useOfflineRecords("invoices") ?? [];
  const expenseRecords = useOfflineRecords("expenses") ?? [];
  const invoices = invoiceRecords.flatMap((record) => {
    const data = parseInvoiceData(record.data);
    return data ? [{ id: record.id, status: data.status, paidAt: data.paidAt, totalPence: data.totalPence, isDemo: record.data.isDemo === true }] : [];
  });
  const expenses = expenseRecords.flatMap((record) => {
    const data = parseExpenseData(record.data);
    return data ? [{ id: record.id, ...data }] : [];
  });

  return <MtdWorkspaceView expenses={expenses} invoices={invoices} referenceDate={todayInLondon()} />;
}
