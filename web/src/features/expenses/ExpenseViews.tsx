"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef } from "react";

import type { ExpenseData } from "@/domain/expense";
import { parseExpenseCategoryData, parseExpenseData } from "@/domain/expense";
import { readProfession, type Profession } from "@/domain/profession";
import { ExpenseForm, type ExpenseFormSubmission } from "./ExpenseForm";
import { MileageForm, type MileageSessionOption } from "./MileageForm";
import { ReceiptScanFlow } from "./ReceiptScanFlow";
import { openExpenseReceipt } from "./receiptViewer";
import { parseSessionData } from "@/features/sessions/SessionViews";
import { isoToLondonFormValues } from "@/features/sessions/SessionForm";
import { useOfflineRecord, useOfflineRecords } from "@/offline/useRecords";
import type { OfflineRepository } from "@/offline/repository";
import { useSync } from "@/sync/SyncProvider";

function extension(name: string) { return name.split(".").at(-1)?.toLowerCase() ?? "bin"; }

export async function saveNewExpense(repository: OfflineRepository, ownerId: string, expenseId: string, submission: ExpenseFormSubmission, uuid = () => crypto.randomUUID()) {
  const previousKey = submission.previousReceiptObjectKey ?? submission.data.receiptObjectKey;
  if (!submission.receipt) {
    const deletion = submission.removeExistingReceipt && previousKey
      ? { operation: "delete" as const, expenseId, objectKey: previousKey }
      : null;
    return repository.saveExpenseWithReceipt(expenseId, submission.data, deletion);
  }
  const objectKey = `${ownerId}/${expenseId}/${uuid()}.${extension(submission.receipt.name)}`;
  const data: ExpenseData = { ...submission.data, receiptObjectKey: objectKey, receiptOriginalName: submission.receipt.name, receiptMimeType: submission.receipt.type as ExpenseData["receiptMimeType"], receiptSizeBytes: submission.receipt.size, receiptSyncStatus: "pending" };
  return repository.saveExpenseWithReceipt(expenseId, data, { expenseId, objectKey, originalName: submission.receipt.name, mimeType: data.receiptMimeType!, sizeBytes: submission.receipt.size, blob: submission.receipt, deleteAfterUploadKey: previousKey });
}

export async function deleteStoredExpense(repository: OfflineRepository, id: string, data: ExpenseData) {
  return repository.deleteExpenseWithReceipt(id, data, data.receiptObjectKey);
}

function useOptions() {
  const practiceRecords = useOfflineRecords("practices") ?? [];
  const categoryRecords = useOfflineRecords("expenseCategories") ?? [];
  return {
    practices: practiceRecords.flatMap((record) => typeof record.data.name === "string" ? [{ id: record.id, name: record.data.name }] : []),
    categories: categoryRecords.flatMap((record) => { const data = parseExpenseCategoryData(record.data); return data && !data.archivedAt ? [{ id: record.id, name: data.name }] : []; }),
  };
}

function useSavedProfession(): Profession | null | undefined {
  const settingRecords = useOfflineRecords("settings");
  if (settingRecords === undefined) return undefined;
  return readProfession(settingRecords[0]?.data);
}

function ProfessionRequired() {
  return <section className="record-page record-page--form" aria-labelledby="profession-required-title">
    <Link href="/expenses">← Expenses</Link>
    <h1 id="profession-required-title">Choose your profession</h1>
    <p>Choose GP or Pharmacist once so expense categories use the right professional labels.</p>
    <Link href="/settings/profile">Choose profession in profile</Link>
  </section>;
}

export function NewExpense() {
  const { categories, practices } = useOptions();
  const profession = useSavedProfession();
  const { markSaving, repository, syncNow } = useSync();
  const router = useRouter();
  const id = useRef<string | null>(null);
  if (profession === undefined) return <p role="status">Preparing expense preferences</p>;
  if (profession === null) return <ProfessionRequired />;
  return <section className="record-page record-page--form"><Link className="record-page__back" href="/expenses/new">← Add expense</Link><ExpenseForm customCategories={categories} practices={practices} profession={profession} shellTitleAs="h1" onSubmit={async (submission) => {
    if (!repository) throw new Error("Offline storage unavailable");
    id.current ??= crypto.randomUUID();
    await saveNewExpense(repository, repository.ownerId, id.current, submission);
    markSaving(); void syncNow(); router.push("/expenses");
  }} /></section>;
}

function GuidedExpensePlaceholder({ description, title }: { description: string; title: string }) {
  return <section className="record-page record-page--form">
    <Link className="record-page__back" href="/expenses/new">← Add expense</Link>
    <h1>{title}</h1>
    <div className="record-page__empty">
      <p>{description}</p>
      <Link href="/expenses/new/manual">Enter this expense manually</Link>
    </div>
  </section>;
}

export function ReceiptScanPlaceholder() {
  return <GuidedExpensePlaceholder
    description="Private receipt scanning is being prepared. Your receipt is not uploaded or analysed on this screen yet."
    title="Scan receipt"
  />;
}

export function ReceiptScanExpense() {
  const { categories, practices } = useOptions();
  const profession = useSavedProfession();
  const { markSaving, repository, syncNow } = useSync();
  const router = useRouter();
  const id = useRef<string | null>(null);
  if (profession === undefined) return <p role="status">Preparing expense preferences</p>;
  if (profession === null) return <ProfessionRequired />;

  return <section className="record-page record-page--form">
    <ReceiptScanFlow
      customCategories={categories}
      onSaved={() => router.push("/expenses")}
      practices={practices}
      profession={profession}
      onSubmit={async (submission) => {
        if (!repository) throw new Error("Offline storage unavailable");
        id.current ??= crypto.randomUUID();
        await saveNewExpense(
          repository,
          repository.ownerId,
          id.current,
          submission,
        );
        markSaving();
        void syncNow();
      }}
    />
  </section>;
}

export function MileageExpense() {
  const { practices } = useOptions();
  const expenseRecords = useOfflineRecords("expenses");
  const sessionRecords = useOfflineRecords("sessions") ?? [];
  const { markSaving, repository, syncNow } = useSync();
  const router = useRouter();
  const id = useRef<string | null>(null);
  if (expenseRecords === undefined) {
    return <p role="status">Preparing mileage records</p>;
  }
  const practiceNames = new Map(practices.map((practice) => [practice.id, practice.name]));
  const sessions = sessionRecords.flatMap<MileageSessionOption>((record) => {
    const session = parseSessionData(record.data);
    const practiceName = session ? practiceNames.get(session.practiceId) : null;
    if (!session || !practiceName) return [];
    try {
      return [{
        id: record.id,
        date: isoToLondonFormValues(session.startsAt).date,
        practiceId: session.practiceId,
        practiceName,
      }];
    } catch {
      return [];
    }
  });

  return <section className="record-page record-page--form">
    <Link className="record-page__back" href="/expenses/new">← Add expense</Link>
    <h1>Mileage</h1>
    <MileageForm
      expenseRecords={expenseRecords.map((record) => record.data)}
      onSubmit={async (submission) => {
        if (!repository) throw new Error("Offline storage unavailable");
        id.current ??= crypto.randomUUID();
        await saveNewExpense(repository, repository.ownerId, id.current, submission);
        markSaving();
        void syncNow();
        router.push("/expenses");
      }}
      practices={practices}
      sessions={sessions}
    />
  </section>;
}

export function EditExpense() {
  const { id } = useParams<{ id: string }>();
  const record = useOfflineRecord("expenses", id);
  const { categories, practices } = useOptions();
  const profession = useSavedProfession();
  const { markSaving, repository, syncNow } = useSync();
  const router = useRouter();
  if (record === undefined || profession === undefined) return <p role="status">Preparing expense</p>;
  if (profession === null) return <ProfessionRequired />;
  const data = record ? parseExpenseData(record.data) : null;
  if (!data || !repository) return <section><h1>Expense not found</h1><Link href="/expenses">Back to expenses</Link></section>;
  return <section className="record-page record-page--form"><Link href="/expenses">← Expenses</Link><ExpenseForm customCategories={categories} initialData={data} onViewExistingReceipt={() => openExpenseReceipt(id)} practices={practices} profession={profession} shellTitleAs="h1" onDelete={async () => {
    await deleteStoredExpense(repository, id, data); markSaving(); void syncNow(); router.push("/expenses");
  }} onSubmit={async (submission) => {
    await saveNewExpense(repository, repository.ownerId, id, submission); markSaving(); void syncNow(); router.push("/expenses");
  }} /></section>;
}
