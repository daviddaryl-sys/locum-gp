"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { buildTaxYearPeriods, isExpenseDate, resolveExpensePeriod, summarizeExpenses, PREDEFINED_EXPENSE_CATEGORIES, type ExpenseData } from "@/domain/expense";
import { formatGBP } from "@/domain/money";
import { openExpenseReceipt } from "./receiptViewer";

type Named = { id: string; name: string };
type QueueState = { expenseId: string; state: "pending" | "failed" };

function londonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function formatExpenseDate(value: string) {
  if (!isExpenseDate(value)) return "Date needs attention";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function ReceiptIcon({ muted = false }: { muted?: boolean }) {
  return <svg aria-hidden="true" className={muted ? "expense-card__receipt-icon expense-card__receipt-icon--muted" : "expense-card__receipt-icon"} fill="none" viewBox="0 0 24 24">
    <path d="M7 3h8l3 3v15H7V3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M15 3v4h4M10 11h5M10 15h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </svg>;
}

export function ExpenseList({ categories, expenses, receiptQueue, referenceDate = londonDate() }: {
  categories: Named[];
  expenses: Array<{ id: string; data: ExpenseData }>;
  practices: Named[];
  receiptQueue: QueueState[];
  referenceDate?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periods = buildTaxYearPeriods(referenceDate);
  const requested = searchParams.get("period") ?? "tax-year";
  const period = resolveExpensePeriod(requested, referenceDate);
  const [receiptError, setReceiptError] = useState("");
  const visible = expenses.filter(({ data }) => !isExpenseDate(data.expenseDate) || (data.expenseDate >= period.start && data.expenseDate <= period.end)).sort((a, b) => b.data.expenseDate.localeCompare(a.data.expenseDate));
  const summary = summarizeExpenses(visible.map(({ data }) => data), period);
  const categoryNames = new Map(categories.map((item) => [item.id, item.name]));
  const predefined = new Map(PREDEFINED_EXPENSE_CATEGORIES.map((item) => [item.key, item.label]));

  async function openReceipt(id: string) {
    try {
      await openExpenseReceipt(id);
    } catch {
      setReceiptError("Receipt is temporarily unavailable.");
    }
  }

  return <section className="record-page expenses-list" aria-labelledby="expenses-title">
    <div className="record-page__header"><div><p className="eyebrow">Business records</p><h1 id="expenses-title">Expenses</h1></div><Link className="primary-action" href="/expenses/new">Add expense</Link></div>
    <label className="expenses-list__period"><span>Tax period</span><select onChange={(event) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", event.target.value);
      router.replace(`?${params.toString()}`);
    }} value={period.id}>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <dl className="expense-totals" data-testid="expense-summary"><div className="expense-totals__item"><dt>Net expenses</dt><dd data-testid="net-expenses">{formatGBP(summary.netPence)}</dd></div><div className="expense-totals__item"><dt>Reimbursed</dt><dd data-testid="reimbursed-expenses">{formatGBP(summary.reimbursedPence)}</dd></div></dl>
    {receiptError ? <p role="alert">{receiptError}</p> : null}
    {visible.length ? <ul className="record-list">{visible.map(({ id, data }) => {
      const queue = receiptQueue.find((entry) => entry.expenseId === id);
      const categoryLabel = data.categoryKey
        ? predefined.get(data.categoryKey) ?? "Other expense"
        : categoryNames.get(data.customCategoryId ?? "") ?? "Custom category";
      const displayTitle = data.isDemo ? "Sample expense" : data.supplierDescription.trim() || categoryLabel || "Expense";
      const description = data.isDemo ? categoryLabel : data.notes?.trim() || categoryLabel;
      const receiptState = queue?.state === "failed"
        ? "failed"
        : queue?.state === "pending"
          ? "pending"
          : data.receiptSyncStatus === "uploaded"
            ? "uploaded"
            : "missing";
      return <li key={id}><article className="record-card expense-card">
        <Link aria-label={`Open expense: ${displayTitle}`} className="expense-card__open" href={`/expenses/${id}`} />
        <div className="expense-card__top">
          {isExpenseDate(data.expenseDate)
            ? <time className="expense-card__date" dateTime={data.expenseDate}>{formatExpenseDate(data.expenseDate)}</time>
            : <span className="expense-card__date">Date needs attention</span>}
          <strong className="expense-card__title" title={displayTitle}>{displayTitle}</strong>
          <strong className="expense-card__amount">{formatGBP(data.amountPence)}</strong>
        </div>
        <p className="expense-card__description" title={description}>{description}</p>
        <div className="expense-card__bottom">
          {receiptState === "uploaded" ? (
            <button aria-label={`Open receipt for ${displayTitle}`} className="expense-card__receipt" onClick={() => openReceipt(id)} type="button">
              <ReceiptIcon />
            </button>
          ) : (
            <span aria-label={receiptState === "missing" ? `No receipt attached for ${displayTitle}` : undefined} className={`expense-card__receipt expense-card__receipt--${receiptState}`} role={receiptState === "missing" ? "img" : undefined}>
              <ReceiptIcon muted />
              {receiptState === "pending" ? <span>Uploading</span> : null}
              {receiptState === "failed" ? <span>Upload failed</span> : null}
            </span>
          )}
          <span className="expense-card__badges">
            {data.reimbursedByPractice ? <span className="expense-card__badge">Reimbursed</span> : null}
            {data.needsAccountantReview ? <span className="expense-card__badge">Accountant review</span> : null}
          </span>
        </div>
      </article></li>;
    })}</ul> : <p className="record-page__empty">No expenses in this period.</p>}
  </section>;
}
