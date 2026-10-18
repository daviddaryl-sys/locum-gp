"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { isExpenseDate, isPredefinedExpenseCategoryKey, validateReceiptFile, type ExpenseData, type PredefinedExpenseCategoryKey } from "@/domain/expense";
import { categoriesFor, defaultMtdCategory } from "@/domain/expenseCategoryCatalog";
import { MTD_EXPENSE_CATEGORIES, type MtdExpenseCategory } from "@/domain/mtd";
import type { Profession } from "@/domain/profession";

import { GuidedStepShell } from "@/components/guided/GuidedStepShell";
import { ReceiptAttachmentRow } from "./ReceiptAttachmentRow";

export type ExpenseFormSubmission = {
  data: ExpenseData;
  receipt: File | null;
  removeExistingReceipt: boolean;
  previousReceiptObjectKey?: string | null;
};

type Option = { id: string; name: string };
const CONSERVATIVE_MTD_FALLBACK: MtdExpenseCategory = "other_business_expenses";
type ExpenseErrorField = "date" | "amount" | "category" | "allowablePercentage" | "supplier" | "receipt";
export type ExpenseFormFocusField = "date" | "amount" | "category" | "supplier";
export type ExpenseFormPrefill = {
  amountPence?: number;
  categoryKey?: PredefinedExpenseCategoryKey;
  expenseDate?: string;
  focusField?: ExpenseFormFocusField;
  receipt?: File;
  supplierDescription?: string;
};

function amountInput(pence: number) {
  return (pence / 100).toFixed(2);
}

function parseBusinessPercentage(value: string) {
  if (!/^\d{1,3}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function todayInLondon() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/London",
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function ExpenseForm({ customCategories, initialData, lockPrefilledReceipt = false, onDelete, onSubmit, onViewExistingReceipt, practices, prefill, profession, shellIntro, shellTitleAs, variant = "default" }: {
  customCategories: Option[];
  initialData?: ExpenseData;
  lockPrefilledReceipt?: boolean;
  onDelete?: () => Promise<void>;
  onSubmit: (submission: ExpenseFormSubmission) => Promise<void>;
  onViewExistingReceipt?: () => Promise<void>;
  practices: Option[];
  prefill?: ExpenseFormPrefill;
  profession: Profession;
  shellIntro?: string;
  shellTitleAs?: "h1" | "h2";
  variant?: "default" | "receipt-review";
}) {
  const [date, setDate] = useState(initialData?.expenseDate ?? prefill?.expenseDate ?? todayInLondon());
  const [amount, setAmount] = useState(initialData ? amountInput(initialData.amountPence) : prefill?.amountPence !== undefined ? amountInput(prefill.amountPence) : "");
  const [category, setCategory] = useState(initialData?.categoryKey ?? (initialData?.customCategoryId ? `custom:${initialData.customCategoryId}` : prefill?.categoryKey ?? ""));
  const [mtdCategory, setMtdCategory] = useState<MtdExpenseCategory>(initialData?.mtdCategory ?? (prefill?.categoryKey ? defaultMtdCategory(prefill.categoryKey) : null) ?? CONSERVATIVE_MTD_FALLBACK);
  const [allowablePercentage, setAllowablePercentage] = useState(String(initialData?.allowablePercentage ?? 100));
  const [practiceId, setPracticeId] = useState(initialData?.practiceId ?? "");
  const [supplier, setSupplier] = useState(initialData?.supplierDescription ?? prefill?.supplierDescription ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [reimbursed, setReimbursed] = useState(initialData?.reimbursedByPractice ?? false);
  const [review, setReview] = useState(initialData?.needsAccountantReview ?? false);
  const [receipt, setReceipt] = useState<File | null>(prefill?.receipt ?? null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [error, setError] = useState<{ field: ExpenseErrorField | null; message: string } | null>(null);
  const [receiptViewError, setReceiptViewError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const idPrefix = useId();
  const errorId = `${idPrefix}-error`;
  const fieldId = (field: ExpenseErrorField) => `${idPrefix}-${field}`;
  const initialFocusId = prefill?.focusField ? fieldId(prefill.focusField) : null;
  const advancedDetails = useRef<HTMLDetailsElement>(null);
  const receiptAction = useRef<HTMLButtonElement>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const localReceiptViewTimers = useRef(new Map<string, ReturnType<typeof setTimeout> | null>());
  const mtdCategoryManuallyOverridden = useRef(false);
  const lastAutomaticMtdCategory = useRef<MtdExpenseCategory | null>(null);
  const expenseCategories = categoriesFor(profession);

  useEffect(() => {
    if (initialFocusId) document.getElementById(initialFocusId)?.focus();
  }, [initialFocusId]);

  useEffect(() => () => {
    for (const objectUrl of [...localReceiptViewTimers.current.keys()]) revokeLocalReceiptUrl(objectUrl);
  }, []);

  function handleCategoryChange(value: string) {
    setCategory(value);
    if (mtdCategoryManuallyOverridden.current) return;

    const suggestion = isPredefinedExpenseCategoryKey(value)
      ? defaultMtdCategory(value)
      : null;
    const nextMtdCategory = suggestion ?? CONSERVATIVE_MTD_FALLBACK;
    lastAutomaticMtdCategory.current = nextMtdCategory;
    setMtdCategory(nextMtdCategory);
  }

  function automaticMtdForSelection(value: string): MtdExpenseCategory {
    return isPredefinedExpenseCategoryKey(value)
      ? defaultMtdCategory(value) ?? CONSERVATIVE_MTD_FALLBACK
      : CONSERVATIVE_MTD_FALLBACK;
  }

  const currentBusinessPercentage = parseBusinessPercentage(allowablePercentage);
  const hasCurrentExtraDetails =
    Boolean(notes.trim()) ||
    reimbursed ||
    review ||
    (currentBusinessPercentage !== null && currentBusinessPercentage !== 100) ||
    mtdCategory !== automaticMtdForSelection(category);
  const initialCategory = initialData?.categoryKey ??
    (initialData?.customCategoryId ? `custom:${initialData.customCategoryId}` : "");
  const hasSavedExtraDetails = Boolean(initialData && (
    Boolean(initialData.notes?.trim()) ||
    initialData.reimbursedByPractice ||
    initialData.needsAccountantReview ||
    initialData.allowablePercentage !== 100 ||
    initialData.mtdCategory !== automaticMtdForSelection(initialCategory)
  ));
  const extraDetailsChanged = initialData
    ? notes.trim() !== (initialData.notes ?? "").trim() ||
      reimbursed !== initialData.reimbursedByPractice ||
      review !== initialData.needsAccountantReview ||
      (currentBusinessPercentage !== null &&
        currentBusinessPercentage !== initialData.allowablePercentage) ||
      mtdCategory !== initialData.mtdCategory
    : hasCurrentExtraDetails;
  const hasAddedExtraDetails = hasCurrentExtraDetails && extraDetailsChanged;
  const hasPersistedReceipt = Boolean(initialData?.receiptObjectKey) && !removeReceipt;
  const hasVisibleReceipt = Boolean(receipt) || hasPersistedReceipt;
  const receiptName = receipt?.name ?? initialData?.receiptOriginalName ?? "";
  const saveLabel = initialData ? "Save changes" : "Save expense";
  const shellTitle = initialData || variant === "receipt-review"
    ? "Check this expense"
    : "Add this expense";
  const defaultShellIntro = variant === "receipt-review"
    ? "Check the suggested answers, then save the expense."
    : initialData
      ? "Review each answer, then save your changes."
      : "Answer the main questions, then save the expense.";
  const resolvedShellIntro = shellIntro ?? defaultShellIntro;

  function revokeLocalReceiptUrl(objectUrl: string) {
    const timer = localReceiptViewTimers.current.get(objectUrl);
    if (timer === undefined) return;
    if (timer) clearTimeout(timer);
    localReceiptViewTimers.current.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }

  async function viewReceipt() {
    setReceiptViewError(null);
    try {
      if (receipt) {
        const objectUrl = URL.createObjectURL(receipt);
        localReceiptViewTimers.current.set(objectUrl, null);
        try {
          window.open(objectUrl, "_blank", "noopener,noreferrer");
        } catch (openError) {
          revokeLocalReceiptUrl(objectUrl);
          throw openError;
        }
        const timer = setTimeout(() => {
          revokeLocalReceiptUrl(objectUrl);
        }, 60_000);
        localReceiptViewTimers.current.set(objectUrl, timer);
        return;
      }
      if (hasPersistedReceipt && onViewExistingReceipt) {
        await onViewExistingReceipt();
        return;
      }
      throw new Error("Receipt is temporarily unavailable.");
    } catch {
      setReceiptViewError("Receipt is temporarily unavailable.");
    }
  }

  function showError(field: ExpenseErrorField, message: string, advanced = false) {
    setError({ field, message });
    if (advanced) {
      setAdvancedOpen(true);
      if (advancedDetails.current) advancedDetails.current.open = true;
    }
    queueMicrotask(() => {
      if (field === "receipt") receiptAction.current?.focus();
      else document.getElementById(fieldId(field))?.focus();
    });
  }

  function errorAttributes(field: ExpenseErrorField) {
    const invalid = error?.field === field;
    return {
      "aria-describedby": invalid ? errorId : undefined,
      "aria-invalid": invalid || undefined,
      id: fieldId(field),
    };
  }

  function fieldError(field: ExpenseErrorField) {
    return error?.field === field ? <span className="record-form__field-error" id={errorId} role="alert">{error.message}</span> : null;
  }

  function clearReceiptError() {
    setError((current) => current?.field === "receipt" ? null : current);
  }

  function requestReceiptChange() {
    if (!busy) receiptInput.current?.click();
  }

  function removeVisibleReceipt() {
    clearReceiptError();
    setReceiptViewError(null);
    setReceipt(null);
    if (receiptInput.current) receiptInput.current.value = "";
    setRemoveReceipt(Boolean(initialData?.receiptObjectKey));
  }

  function undoReceiptRemoval() {
    setRemoveReceipt(false);
    clearReceiptError();
    setReceiptViewError(null);
  }

  return <form className={`record-form expense-form${variant === "receipt-review" ? " record-form--receipt-review" : ""}`} noValidate onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!isExpenseDate(date)) return showError("date", "Choose the date you bought it.");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return showError("amount", "Enter how much you paid.");
    const amountPence = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountPence)) return showError("amount", "Enter how much you paid.");
    if (amountPence <= 0) return showError("amount", "Enter how much you paid.");
    if (!category) return showError("category", "Choose a type of expense.");
    if (currentBusinessPercentage === null) {
      return showError("allowablePercentage", "Enter a business percentage from 0 to 100.", true);
    }
    if (!supplier.trim()) return showError("supplier", "Tell us what you bought.");
    const receiptError = receipt ? validateReceiptFile(receipt) : null;
    if (receiptError) return showError("receipt", receiptError);
    const customCategoryId = category.startsWith("custom:") ? category.slice(7) : null;
    const data: ExpenseData = {
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
      expenseDate: date,
      amountPence,
      categoryKey: customCategoryId ? null : category as ExpenseData["categoryKey"],
      customCategoryId,
      mtdCategory,
      allowablePercentage: currentBusinessPercentage,
      practiceId: practiceId || null,
      supplierDescription: supplier.trim(),
      notes: notes.trim() || null,
      reimbursedByPractice: reimbursed,
      needsAccountantReview: review,
      receiptObjectKey: removeReceipt ? null : initialData?.receiptObjectKey ?? null,
      receiptOriginalName: removeReceipt ? null : initialData?.receiptOriginalName ?? null,
      receiptMimeType: removeReceipt ? null : initialData?.receiptMimeType ?? null,
      receiptSizeBytes: removeReceipt ? null : initialData?.receiptSizeBytes ?? null,
      receiptSyncStatus: removeReceipt ? "none" : initialData?.receiptSyncStatus ?? "none",
      isDemo: initialData?.isDemo ?? false,
    };
    setError(null);
    setBusy(true);
    try { await onSubmit({ data, receipt, removeExistingReceipt: removeReceipt, previousReceiptObjectKey: initialData?.receiptObjectKey ?? null }); }
    catch { setError({ field: null, message: `We couldn't save this expense. Your entries are still here.` }); }
    finally { setBusy(false); }
  }}>
    <GuidedStepShell
      actionLabel="Expense form actions"
      actions={<div className={`record-form__actions${variant === "receipt-review" ? " record-form__actions--sticky" : ""}`}><button className="button button--primary" disabled={busy} type="submit">{busy ? "Saving…" : saveLabel}</button>{onDelete ? <button className="button button--secondary expense-form__delete" disabled={busy} onClick={async () => { if (window.confirm("Delete this expense?")) await onDelete(); }} type="button">Delete expense</button> : null}</div>}
      intro={resolvedShellIntro}
      title={shellTitle}
      titleAs={shellTitleAs}
    >
      {error?.field === null ? <p className="record-form__error" id={errorId} role="alert">{error.message}</p> : null}
      <div className="record-form__fields record-form__section" data-testid="expense-primary-fields">
        <div className="record-form__field"><label htmlFor={fieldId("supplier")}>What did you buy?</label><input {...errorAttributes("supplier")} className="record-form__control" disabled={busy} maxLength={160} onChange={(e) => setSupplier(e.target.value)} value={supplier} />{fieldError("supplier")}</div>
        <div className="record-form__field"><label htmlFor={fieldId("amount")}>How much did it cost?</label><div className="record-form__money-control"><span aria-hidden="true" className="record-form__currency">£</span><input {...errorAttributes("amount")} className="record-form__control" disabled={busy} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0.00" value={amount} /></div>{fieldError("amount")}</div>
        <div className="record-form__field"><label htmlFor={fieldId("date")}>When did you buy it?</label><input {...errorAttributes("date")} className="record-form__control" disabled={busy} onChange={(e) => setDate(e.target.value)} type="date" value={date} />{fieldError("date")}</div>
        <div className="record-form__field"><label htmlFor={fieldId("category")}>What type of expense is it?</label><select {...errorAttributes("category")} aria-label="What type of expense is it?" className="record-form__control" disabled={busy} onChange={(e) => handleCategoryChange(e.target.value)} value={category}><option value="">Choose category</option>
          <optgroup label="Practice-linked">{expenseCategories.filter((item) => item.group === "practice").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>
          <optgroup label="General">{expenseCategories.filter((item) => item.group === "general").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>
          {customCategories.length ? <optgroup label="Custom">{customCategories.map((item) => <option key={item.id} value={`custom:${item.id}`}>Custom: {item.name}</option>)}</optgroup> : null}
        </select>{fieldError("category")}</div>
        <Link className="record-form__support-link" href="/expenses/categories">Can&apos;t find it? Add a category.</Link>
        <div className="record-form__field"><label htmlFor={`${idPrefix}-practice`}>Which practice?</label><select className="record-form__control" disabled={busy} id={`${idPrefix}-practice`} onChange={(e) => setPracticeId(e.target.value)} value={practiceId}><option value="">No practice</option>{practices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="record-form__field record-form__field--receipt">
          <span className="record-form__section-title">Add a receipt (optional)</span>
          <div className={`expense-form__receipt-row${lockPrefilledReceipt && hasVisibleReceipt ? " expense-form__receipt-row--locked" : ""}`}>
            {lockPrefilledReceipt && hasVisibleReceipt ? <div className="expense-form__receipt-locked-summary">
              <span>Receipt attached</span>
              {receiptName ? <span className="expense-form__receipt-name">{receiptName}</span> : null}
              <button aria-label={`View receipt, Receipt attached${receiptName ? `, ${receiptName}` : ""}`} className="button button--secondary expense-form__receipt-action" disabled={busy} onClick={() => void viewReceipt()} ref={receiptAction} type="button">View receipt</button>
            </div> : <>
              <ReceiptAttachmentRow
                busy={busy}
                canChange={!lockPrefilledReceipt}
                canRemove={!lockPrefilledReceipt && hasVisibleReceipt}
                filename={receiptName || null}
                focusTargetRef={receiptAction}
                hasReceipt={hasVisibleReceipt}
                removing={removeReceipt}
                onChange={requestReceiptChange}
                onRemove={removeVisibleReceipt}
                onUndo={undoReceiptRemoval}
                onView={() => void viewReceipt()}
              />
              <input {...errorAttributes("receipt")} accept=".jpg,.jpeg,.png,.heic,.pdf,image/jpeg,image/png,image/heic,application/pdf" aria-describedby={error?.field === "receipt" ? `${errorId} receipt-help` : "receipt-help"} aria-label={hasVisibleReceipt ? "Change receipt" : "Add receipt"} className="record-form__file-input" disabled={busy} onChange={(e) => { const nextReceipt = e.target.files?.[0] ?? null; setReceipt(nextReceipt); if (nextReceipt) setRemoveReceipt(false); clearReceiptError(); setReceiptViewError(null); }} ref={receiptInput} tabIndex={-1} type="file" />
              {fieldError("receipt")}
            </>}
            <p className="record-form__hint" id="receipt-help">JPG, PNG, HEIC, or PDF up to 10 MB.</p>
            {receiptViewError ? <p className="record-form__field-error" role="alert">{receiptViewError}</p> : null}
          </div>
        </div>
        <details className="record-form__advanced" onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} open={advancedOpen} ref={advancedDetails}>
          <summary><span className="record-form__advanced-label">More details</span>{hasSavedExtraDetails || hasAddedExtraDetails ? <span className="record-form__advanced-status">{hasSavedExtraDetails ? <span>Extra details saved</span> : null}{hasSavedExtraDetails && hasAddedExtraDetails ? <span aria-hidden="true"> · </span> : null}{hasAddedExtraDetails ? <span>Extra details added</span> : null}</span> : null}</summary>
          <div className="record-form__advanced-fields">
            {initialData?.receiptObjectKey && !lockPrefilledReceipt ? <label className="record-form__check"><input className="record-form__check-input" checked={removeReceipt} disabled={busy} onChange={(e) => { if (e.target.checked) removeVisibleReceipt(); else undoReceiptRemoval(); }} type="checkbox" />Remove existing receipt</label> : null}
            <div className="record-form__field"><label htmlFor={`${idPrefix}-mtd-category`}>HMRC expense category</label><select className="record-form__control" disabled={busy} id={`${idPrefix}-mtd-category`} onChange={(e) => { mtdCategoryManuallyOverridden.current = true; lastAutomaticMtdCategory.current = null; setMtdCategory(e.target.value as MtdExpenseCategory); }} value={mtdCategory}>{MTD_EXPENSE_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
            <div className="record-form__field"><label htmlFor={fieldId("allowablePercentage")}>Business-use percentage</label><input {...errorAttributes("allowablePercentage")} className="record-form__control" disabled={busy} inputMode="numeric" max="100" min="0" onChange={(e) => setAllowablePercentage(e.target.value)} step="1" type="number" value={allowablePercentage} />{fieldError("allowablePercentage")}</div>
            <p className="record-form__hint">How much of this cost was for work? Use 100 only if all of it was for work.</p>
            <label className="record-form__check"><input className="record-form__check-input" checked={reimbursed} disabled={busy} onChange={(e) => setReimbursed(e.target.checked)} type="checkbox" />Reimbursed by practice</label>
            <label className="record-form__check"><input className="record-form__check-input" checked={review} disabled={busy} onChange={(e) => setReview(e.target.checked)} type="checkbox" />Review with accountant</label>
            <p className="record-form__hint">Categories help organise records; they do not confirm tax deductibility. Mark uncertain items for review with your accountant.</p>
            <div className="record-form__field"><label htmlFor={`${idPrefix}-notes`}>Notes</label><textarea className="record-form__control record-form__control--textarea" disabled={busy} id={`${idPrefix}-notes`} maxLength={2000} onChange={(e) => setNotes(e.target.value)} value={notes} /></div>
          </div>
        </details>
      </div>
    </GuidedStepShell>
  </form>;
}
