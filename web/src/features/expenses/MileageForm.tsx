"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { isExpenseDate, parseExpenseData, type ExpenseData } from "@/domain/expense";
import { defaultMtdCategory } from "@/domain/expenseCategoryCatalog";
import { suggestMileage, type MileageSuggestion } from "@/domain/mileage";
import { MTD_EXPENSE_CATEGORIES, type MtdExpenseCategory } from "@/domain/mtd";
import type { ExpenseFormSubmission } from "./ExpenseForm";

type PracticeOption = { id: string; name: string };
export type MileageSessionOption = {
  id: string;
  date: string;
  practiceId: string;
  practiceName: string;
};

const MILEAGE_CATEGORY = "mileage_business_travel" as const;
const DEFAULT_MTD_CATEGORY =
  defaultMtdCategory(MILEAGE_CATEGORY) ?? "other_business_expenses";

function taxYearBounds(date: string): { start: string; end: string; label: string } | null {
  if (!isExpenseDate(date)) return null;
  const year = Number(date.slice(0, 4));
  const startYear = date.slice(5) >= "04-06" ? year : year - 1;
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

export function priorMileageForDate(expensePayloads: readonly unknown[], date: string): number {
  const bounds = taxYearBounds(date);
  if (!bounds) return 0;
  let centimiles = 0;
  for (const payload of expensePayloads) {
    const expense = parseExpenseData(payload);
    if (
      !expense ||
      expense.isDemo ||
      expense.expenseKind !== "mileage" ||
      !isExpenseDate(expense.expenseDate) ||
      expense.expenseDate < bounds.start ||
      expense.expenseDate > bounds.end ||
      expense.expenseDate > date ||
      expense.distanceMiles === null
    ) continue;
    centimiles += Math.round(expense.distanceMiles * 100);
  }
  return centimiles / 100;
}

function formatMiles(miles: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(miles);
}

function suggestionFor(date: string, distance: string, priorMiles: number): {
  suggestion: MileageSuggestion | null;
  error: string | null;
} {
  if (!isExpenseDate(date) || !/^\d+(?:\.\d{1,2})?$/.test(distance)) {
    return { suggestion: null, error: null };
  }
  const miles = Number(distance);
  if (miles <= 0) return { suggestion: null, error: null };
  try {
    return {
      suggestion: suggestMileage({ date, distanceMiles: miles, priorTaxYearMiles: priorMiles }),
      error: null,
    };
  } catch (error) {
    return {
      suggestion: null,
      error: error instanceof Error ? error.message : "Mileage cannot be calculated.",
    };
  }
}

export function MileageForm({
  expenseRecords,
  onSubmit,
  practices,
  sessions,
}: {
  expenseRecords: readonly unknown[];
  onSubmit: (submission: ExpenseFormSubmission) => Promise<void>;
  practices: readonly PracticeOption[];
  sessions: readonly MileageSessionOption[];
}) {
  const [date, setDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [distance, setDistance] = useState("");
  const [amount, setAmount] = useState("");
  const [practiceId, setPracticeId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [notes, setNotes] = useState("");
  const [review, setReview] = useState(false);
  const [confirmedFingerprint, setConfirmedFingerprint] = useState<string | null>(null);
  const [mtdCategory, setMtdCategory] = useState<MtdExpenseCategory>(DEFAULT_MTD_CATEGORY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idPrefix = useId();
  const dateEdited = useRef(false);
  const destinationEdited = useRef(false);
  const practiceEdited = useRef(false);
  const amountEdited = useRef(false);

  const priorMiles = useMemo(
    () => priorMileageForDate(expenseRecords, date),
    [date, expenseRecords],
  );
  const calculation = useMemo(
    () => suggestionFor(date, distance, priorMiles),
    [date, distance, priorMiles],
  );
  const calculationFingerprint = useMemo(() => calculation.suggestion ? JSON.stringify({
    amountPence: calculation.suggestion.amountPence,
    date,
    distanceMiles: Number(distance),
    priorMiles,
    rateVersion: calculation.suggestion.rateVersion,
    thresholdSplit: calculation.suggestion.thresholdSplit,
  }) : null, [calculation.suggestion, date, distance, priorMiles]);
  const confirmed = calculationFingerprint !== null && confirmedFingerprint === calculationFingerprint;

  useEffect(() => {
    if (!calculation.suggestion || amountEdited.current) return;
    setAmount((calculation.suggestion.amountPence / 100).toFixed(2));
  }, [calculation.suggestion]);

  function invalidateConfirmation() {
    setConfirmedFingerprint(null);
    setError(null);
  }

  function chooseSession(nextId: string) {
    setSessionId(nextId);
    invalidateConfirmation();
    const session = sessions.find((item) => item.id === nextId);
    if (!session) return;
    if (!dateEdited.current) setDate(session.date);
    if (!destinationEdited.current) setDestination(session.practiceName);
    if (!practiceEdited.current) setPracticeId(session.practiceId);
  }

  function showError(message: string) {
    setError(message);
  }

  function fieldId(field: string) {
    return `${idPrefix}-${field}`;
  }

  return <form className="record-form mileage-form" noValidate onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!isExpenseDate(date)) return showError("Enter a valid journey date.");
    if (!origin.trim()) return showError("Enter where the journey started.");
    if (!destination.trim()) return showError("Enter the destination or practice.");
    if (!/^\d+(?:\.\d{1,2})?$/.test(distance) || Number(distance) <= 0) {
      return showError("Enter business miles greater than zero, using at most two decimal places.");
    }
    if (calculation.error) return showError(calculation.error);
    if (!calculation.suggestion) return showError("A verified mileage suggestion is required before saving.");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      return showError("Enter a valid confirmed mileage amount greater than zero.");
    }
    const amountPence = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountPence)) return showError("Enter a valid confirmed mileage amount.");
    if (!confirmed) return showError("Review the suggestion and confirm the amount before saving.");

    const data: ExpenseData = {
      expenseKind: "mileage",
      journeyOrigin: origin.trim(),
      journeyDestination: destination.trim(),
      distanceMiles: Number(distance),
      mileageRatePence: calculation.suggestion.startingRatePence,
      linkedSessionId: sessionId || null,
      expenseDate: date,
      amountPence,
      categoryKey: MILEAGE_CATEGORY,
      customCategoryId: null,
      mtdCategory,
      allowablePercentage: 100,
      practiceId: practiceId || null,
      supplierDescription: `Business mileage: ${origin.trim()} to ${destination.trim()}`,
      notes: notes.trim() || null,
      reimbursedByPractice: false,
      needsAccountantReview: review,
      receiptObjectKey: null,
      receiptOriginalName: null,
      receiptMimeType: null,
      receiptSizeBytes: null,
      receiptSyncStatus: "none",
      isDemo: false,
    };
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ data, receipt: null, removeExistingReceipt: false });
    } catch {
      setError("Mileage expense could not be saved. Your entries have been kept.");
    } finally {
      setBusy(false);
    }
  }}>
    {error ? <p className="record-form__error" role="alert">{error}</p> : null}
    <div className="record-form__fields">
      {sessions.length ? <div className="record-form__field"><label htmlFor={fieldId("session")}>Link to session (optional)</label><select className="record-form__control" disabled={busy} id={fieldId("session")} onChange={(event) => chooseSession(event.target.value)} value={sessionId}><option value="">No linked session</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.date} · {session.practiceName}</option>)}</select></div> : null}
      <div className="record-form__field"><label htmlFor={fieldId("date")}>Journey date</label><input className="record-form__control" disabled={busy} id={fieldId("date")} onChange={(event) => { dateEdited.current = true; setDate(event.target.value); invalidateConfirmation(); }} type="date" value={date} /></div>
      <div className="record-form__field"><label htmlFor={fieldId("origin")}>Journey from</label><input className="record-form__control" disabled={busy} id={fieldId("origin")} maxLength={160} onChange={(event) => { setOrigin(event.target.value); invalidateConfirmation(); }} value={origin} /></div>
      <div className="record-form__field"><label htmlFor={fieldId("destination")}>Journey to</label><input className="record-form__control" disabled={busy} id={fieldId("destination")} maxLength={160} onChange={(event) => { destinationEdited.current = true; setDestination(event.target.value); invalidateConfirmation(); }} value={destination} /></div>
      <div className="record-form__field"><label htmlFor={fieldId("practice")}>Practice (optional)</label><select className="record-form__control" disabled={busy} id={fieldId("practice")} onChange={(event) => {
        practiceEdited.current = true;
        setPracticeId(event.target.value);
        const practice = practices.find((item) => item.id === event.target.value);
        if (practice && !destinationEdited.current) setDestination(practice.name);
        invalidateConfirmation();
      }} value={practiceId}><option value="">No practice</option>{practices.map((practice) => <option key={practice.id} value={practice.id}>{practice.name}</option>)}</select></div>
      <div className="record-form__field"><label htmlFor={fieldId("distance")}>Business miles</label><input className="record-form__control" disabled={busy} id={fieldId("distance")} inputMode="decimal" min="0.01" onChange={(event) => { setDistance(event.target.value); invalidateConfirmation(); }} step="0.01" type="number" value={distance} /></div>

      {calculation.suggestion ? <section className="mileage-form__suggestion" aria-live="polite">
        <h2>Mileage suggestion</h2>
        <p>Prior valid mileage in {calculation.suggestion.taxYear}: {formatMiles(priorMiles)} miles</p>
        <p>{calculation.suggestion.basis}</p>
        <p className="record-form__hint">Official verified support for tax year {calculation.suggestion.taxYear}; rate version {calculation.suggestion.rateVersion}.</p>
        <p className="record-form__notice">{calculation.suggestion.warning}</p>
      </section> : calculation.error ? <p className="record-form__error" role="alert">{calculation.error}</p> : null}

      <div className="record-form__field"><label htmlFor={fieldId("amount")}>Confirmed mileage amount</label><input className="record-form__control" disabled={busy || !calculation.suggestion} id={fieldId("amount")} inputMode="decimal" onChange={(event) => { amountEdited.current = true; setAmount(event.target.value); invalidateConfirmation(); }} value={amount} /></div>
      <label className="record-form__check"><input className="record-form__check-input" checked={confirmed} disabled={busy || !calculation.suggestion} onChange={(event) => { setConfirmedFingerprint(event.target.checked ? calculationFingerprint : null); setError(null); }} type="checkbox" />I have reviewed and confirm this amount</label>
      <div className="record-form__field"><label htmlFor={fieldId("notes")}>Notes (optional)</label><textarea className="record-form__control record-form__control--textarea" disabled={busy} id={fieldId("notes")} maxLength={2000} onChange={(event) => setNotes(event.target.value)} value={notes} /></div>
      <label className="record-form__check"><input className="record-form__check-input" checked={review} disabled={busy} onChange={(event) => setReview(event.target.checked)} type="checkbox" />Review with accountant</label>
      <p className="record-form__hint">This is a record-keeping suggestion, not a decision about tax eligibility. Mark uncertain mileage for review with your accountant.</p>
      <details className="record-form__advanced">
        <summary>Advanced tax details</summary>
        <div className="record-form__advanced-fields">
          <div className="record-form__field"><label htmlFor={fieldId("mtd-category")}>HMRC expense category</label><select className="record-form__control" disabled={busy} id={fieldId("mtd-category")} onChange={(event) => setMtdCategory(event.target.value as MtdExpenseCategory)} value={mtdCategory}>{MTD_EXPENSE_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
          <p className="record-form__hint">The conservative default is car, van, and travel expenses. Change it only when appropriate for your records.</p>
        </div>
      </details>
    </div>
    <div className="record-form__actions"><button className="button button--primary" disabled={busy || Boolean(calculation.error)} type="submit">Save mileage expense</button></div>
  </form>;
}
