"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { OfflineStorageAlert } from "@/components/runtime/OfflineStorageAlert";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type InvoiceStatus } from "@/components/ui/StatusBadge";
import { isDemoInvoicePayload } from "@/features/demo/demoFixtures";
import { deriveInvoiceDisplayStatus } from "@/domain/invoice";
import { isIsoDate } from "@/domain/mtd";
import { formatGBP } from "@/domain/money";
import {
  InvoiceDraft,
  InvoiceDraftItem,
  InvoicePractice,
  InvoiceSession,
  InvoiceWizard,
  IssuedInvoice,
} from "@/features/invoices/InvoiceWizard";
import { parsePracticeData } from "@/features/practices/PracticeViews";
import { parseSessionData } from "@/features/sessions/SessionViews";
import {
  createClient,
  hasPublicSupabaseConfiguration,
} from "@/lib/supabase/client";
import { useOfflineRecord, useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord, RecordPayload } from "@/offline/types";
import type { InvoicePdfData } from "@/pdf/InvoiceDocument";
import {
  parseServerPaymentEnvelope,
  type EncryptedPaymentEnvelope,
} from "@/security/paymentEnvelope";
import {
  type BankDetails,
} from "@/security/vault";
import { usePaymentConfiguration } from "@/features/invoices/usePaymentConfiguration";
import { useSync } from "@/sync/SyncProvider";
import type { Json, Tables } from "@/types/database";

export type InvoiceIssuer = {
  doctorName: string;
  tradingName: string;
  address: string;
  email: string;
};

export type EncryptedPaymentSnapshot = EncryptedPaymentEnvelope & {
  issuer?: InvoiceIssuer;
};

export type InvoiceData = {
  invoiceNumber: string | null;
  status: "draft" | "sent" | "paid" | "cancelled";
  issueDate: string | null;
  dueDate: string | null;
  totalPence: number;
  practiceId: string | null;
  practiceName: string;
  billingAddress: string;
  practiceSnapshot: Record<string, unknown> | null;
  paymentSnapshot: EncryptedPaymentSnapshot | null;
  issuedAt: string | null;
  artifactPath: string | null;
  paidAt: string | null;
};

type InvoiceEntry = { data: Pick<InvoiceData, "status" | "issueDate" | "dueDate"> & { paidAt?: string | null } };

const invoicePeriods = ["all", "calendar-year", "payment-year", "missing-payment-date"];

export function missingPaymentDatePayload(payload: RecordPayload, receivedDate: string): RecordPayload {
  if (payload.status !== "paid" || payload.paidAt) {
    throw new Error("This invoice has changed. Reload it before adding a payment date.");
  }
  return invoiceStatusPayload(payload, "paid", receivedDate);
}

export function filterInvoiceEntries<T extends InvoiceEntry>(
  entries: T[],
  filters: { status: string; period: string },
  today: string,
): T[] {
  const status = ["all", "draft", "sent", "paid", "overdue", "cancelled"].includes(filters.status) ? filters.status : "all";
  const period = invoicePeriods.includes(filters.period) ? filters.period : "all";
  const year = today.slice(0, 4);
  return entries.filter(({ data }) => {
    const matchesStatus = status === "all" ||
      (status === "overdue" ? data.status === "sent" && Boolean(data.dueDate) && data.dueDate! < today : data.status === status);
    const matchesPeriod = period === "all" ||
      (period === "calendar-year" && data.issueDate?.slice(0, 4) === year) ||
      (period === "payment-year" && data.status === "paid" && data.paidAt?.slice(0, 4) === year) ||
      (period === "missing-payment-date" && data.status === "paid" && !data.paidAt);
    return matchesStatus && matchesPeriod;
  });
}

type DraftItemRecord = {
  id: string;
  data: RecordPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function billingAddressText(value: unknown) {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return typeof value.formatted === "string" ? value.formatted : "";
}

export function parseEncryptedPaymentSnapshot(
  value: unknown,
): EncryptedPaymentSnapshot | null {
  if (!isRecord(value) || !isRecord(value.kdfParameters)) return null;
  if (value.version === 2) {
    if (
      !hasOnlyKeys(value, new Set([
        "version", "ciphertext", "salt", "initializationVector", "kdfParameters", "issuer",
      ])) ||
      !hasOnlyKeys(value.kdfParameters, new Set(["name", "hash", "info"]))
    ) return null;
    const envelope = parseServerPaymentEnvelope({
      version: value.version,
      ciphertext: value.ciphertext,
      salt: value.salt,
      initializationVector: value.initializationVector,
      kdfParameters: value.kdfParameters,
    });
    if (!envelope) return null;
    if (!("issuer" in value)) return { ...envelope };
    const issuer = parseInvoiceIssuer(value.issuer);
    return issuer ? { ...envelope, issuer } : null;
  }
  if (
    value.version !== 1 ||
    typeof value.ciphertext !== "string" ||
    !value.ciphertext ||
    typeof value.salt !== "string" ||
    !value.salt ||
    typeof value.initializationVector !== "string" ||
    !value.initializationVector ||
    value.kdfParameters.name !== "PBKDF2" ||
    value.kdfParameters.hash !== "SHA-256" ||
    typeof value.kdfParameters.iterations !== "number" ||
    !Number.isSafeInteger(value.kdfParameters.iterations) ||
    value.kdfParameters.iterations < 300_000 ||
    "accountName" in value ||
    "sortCode" in value ||
    "accountNumber" in value
  ) {
    return null;
  }
  return value as EncryptedPaymentSnapshot;
}

export function parseInvoiceIssuer(value: unknown): InvoiceIssuer | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.doctorName !== "string" ||
    !value.doctorName.trim() ||
    typeof value.tradingName !== "string" ||
    typeof value.address !== "string" ||
    !value.address.trim() ||
    typeof value.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
  ) {
    return null;
  }
  return {
    doctorName: value.doctorName.trim(),
    tradingName: value.tradingName.trim(),
    address: value.address.trim(),
    email: value.email.trim(),
  };
}

export function vaultFromSettings(payload: RecordPayload) {
  return parseEncryptedPaymentSnapshot({
    version: payload.encryptionVersion,
    ciphertext: payload.ciphertext,
    salt: payload.salt,
    initializationVector: payload.initializationVector,
    kdfParameters: payload.kdfParameters,
  });
}

export function draftInvoiceRecord(draft: InvoiceDraft): RecordPayload {
  return {
    invoiceNumber: null,
    status: "draft",
    practiceId: draft.practiceId,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    totalPence: draft.totalPence,
    practiceSnapshot: draft.practiceId && draft.practiceSnapshot
      ? {
          id: draft.practiceId,
          name: draft.practiceSnapshot.name,
          billingAddress: { formatted: draft.practiceSnapshot.billingAddress },
        }
      : null,
    paymentSnapshot: null,
    issuedAt: null,
    artifactPath: null,
    paidAt: null,
  };
}

export function draftInvoiceItemRecords(
  draft: InvoiceDraft,
): DraftItemRecord[] {
  return draft.items.map((item) => ({
    id: item.id,
    data: {
      invoiceId: draft.id,
      sessionId: item.sessionId,
      description: item.description,
      quantity: item.quantity,
      unitRatePence: item.unitRatePence,
      lineTotalPence: item.lineTotalPence,
    },
  }));
}

function issueItem(item: InvoiceDraftItem) {
  return {
    sessionId: item.sessionId,
    description: item.description,
    quantity: item.quantity,
    unitRatePence: item.unitRatePence,
  };
}

export function invoiceIssueArguments(
  draft: InvoiceDraft,
  encryptedPaymentSnapshot: EncryptedPaymentEnvelope,
  prefix = "INV",
  issuer?: InvoiceIssuer,
) {
  if (!draft.practiceId) throw new Error("Choose a practice before issuing.");
  return {
    requested_invoice_id: draft.id,
    requested_practice_id: draft.practiceId,
    requested_issue_date: draft.issueDate,
    requested_payment_snapshot: issuer
      ? { ...encryptedPaymentSnapshot, issuer }
      : encryptedPaymentSnapshot,
    requested_items: draft.items.map(issueItem),
    requested_prefix: prefix,
  };
}

type InvoiceItemData = Omit<InvoiceDraftItem, "id">;

export function parseInvoiceItemData(payload: RecordPayload): InvoiceItemData | null {
  if (
    (payload.sessionId !== null && typeof payload.sessionId !== "string") ||
    typeof payload.description !== "string" ||
    !payload.description.trim() ||
    typeof payload.quantity !== "number" ||
    payload.quantity <= 0 ||
    typeof payload.unitRatePence !== "number" ||
    !Number.isSafeInteger(payload.unitRatePence) ||
    typeof payload.lineTotalPence !== "number" ||
    !Number.isSafeInteger(payload.lineTotalPence)
  ) {
    return null;
  }
  return {
    sessionId: payload.sessionId,
    description: payload.description,
    quantity: payload.quantity,
    unitRatePence: payload.unitRatePence,
    lineTotalPence: payload.lineTotalPence,
  };
}

export function parseInvoiceData(payload: RecordPayload): InvoiceData | null {
  const paidAt = payload.paidAt ?? null;
  if (
    (payload.invoiceNumber !== null && typeof payload.invoiceNumber !== "string") ||
    typeof payload.status !== "string" ||
    !["draft", "sent", "paid", "cancelled"].includes(payload.status) ||
    (payload.issueDate !== null && typeof payload.issueDate !== "string") ||
    (payload.dueDate !== null && typeof payload.dueDate !== "string") ||
    typeof payload.totalPence !== "number" ||
    (payload.practiceId !== null && typeof payload.practiceId !== "string") ||
    (payload.issuedAt !== null && typeof payload.issuedAt !== "string") ||
    (payload.artifactPath !== null && typeof payload.artifactPath !== "string")
    || !(paidAt === null || isIsoDate(paidAt))
  ) {
    return null;
  }

  const snapshot = isRecord(payload.practiceSnapshot)
    ? payload.practiceSnapshot
    : null;
  const practiceName =
    snapshot && typeof snapshot.name === "string" ? snapshot.name : "Draft invoice";
  const billingAddress = snapshot
    ? billingAddressText(snapshot.billingAddress)
    : "";

  return {
    invoiceNumber: payload.invoiceNumber,
    status: payload.status as InvoiceData["status"],
    issueDate: payload.issueDate,
    dueDate: payload.dueDate,
    totalPence: payload.totalPence,
    practiceId: payload.practiceId,
    practiceName,
    billingAddress,
    practiceSnapshot: snapshot,
    paymentSnapshot: parseEncryptedPaymentSnapshot(payload.paymentSnapshot),
    issuedAt: payload.issuedAt,
    artifactPath: payload.artifactPath,
    paidAt: paidAt as string | null,
  };
}

export function invoiceStatusPayload(
  payload: RecordPayload,
  status: "sent" | "paid" | "cancelled",
  paidAt?: string,
): RecordPayload {
  if (status === "paid" && !isIsoDate(paidAt)) {
    throw new Error("Choose a valid payment-received date.");
  }
  return {
    ...payload,
    status,
    paidAt: status === "paid" ? paidAt! : null,
  };
}

function todayIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/London",
  });
  return formatter.format(new Date());
}

function formatDate(value: string | null) {
  if (!value) return "Not issued";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function displayStatus(data: InvoiceData): InvoiceStatus {
  if (data.status === "cancelled") return "cancelled";
  if (!data.dueDate || data.status === "draft") return data.status;
  return deriveInvoiceDisplayStatus({
    dueDate: data.dueDate,
    storedStatus: data.status,
    today: todayIso(),
  });
}

function invoiceEmptyMessage(invoiceCount: number, filteredCount: number) {
  if (invoiceCount === 0) {
    return "No invoices yet. Make one when you are ready to be paid.";
  }
  if (filteredCount === 0) {
    return "No matching invoices. Create one from completed sessions.";
  }
  return null;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let active = true;
    const update = async () => {
      if (!navigator.onLine) {
        if (active) setOnline(false);
        return;
      }
      try {
        // This route intentionally returns a normal same-origin response while
        // online and is never handled by the service worker while offline.
        await fetch("/api/connectivity", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (active) setOnline(true);
      } catch {
        if (active) setOnline(false);
      }
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    void update();
    return () => {
      active = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function practiceForInvoice(record: LocalRecord): InvoicePractice | null {
  const practice = parsePracticeData(record.data);
  if (!practice) return null;
  return {
    id: record.id,
    name: practice.name,
    billingAddress: practice.billingAddress.formatted,
    paymentTermsDays: practice.paymentTermsDays,
    archived: practice.archived,
  };
}

function sessionForInvoice(record: LocalRecord): InvoiceSession | null {
  const session = parseSessionData(record.data);
  return session ? { id: record.id, ...session } : null;
}

function invoicePayloadFromRow(
  row: Tables<"invoice_records">,
): RecordPayload {
  return {
    invoiceNumber: row.invoice_number,
    status: row.status,
    practiceId: row.practice_id,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    totalPence: row.total_pence,
    practiceSnapshot: row.practice_snapshot,
    paymentSnapshot: row.payment_snapshot,
    issuedAt: row.issued_at,
    artifactPath: row.artifact_path,
    paidAt: row.paid_at,
  };
}

function issuedInvoiceFromRow(row: Tables<"invoice_records">): IssuedInvoice {
  if (
    !row.invoice_number ||
    !row.issue_date ||
    !row.due_date ||
    !row.issued_at ||
    !["draft", "sent", "paid", "cancelled"].includes(row.status)
  ) {
    throw new Error("Issued invoice response is incomplete.");
  }
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    issuedAt: row.issued_at,
    totalPence: row.total_pence,
    status: row.status as IssuedInvoice["status"],
  };
}

function pdfData(
  invoice: IssuedInvoice,
  draft: InvoiceDraft,
  issuer: InvoiceIssuer,
): InvoicePdfData {
  if (!draft.practiceSnapshot) throw new Error("Invoice recipient is unavailable.");
  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    issuer: {
      name: issuer.tradingName || issuer.doctorName,
      address: issuer.address,
    },
    practice: {
      name: draft.practiceSnapshot.name,
      billingAddress: draft.practiceSnapshot.billingAddress,
    },
    payment: draft.paymentSnapshot,
    items: draft.items,
    totalPence: invoice.totalPence,
  };
}

export function InvoiceList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initializationError } = useSync();
  const records = useOfflineRecords("invoices");
  const [query, setQuery] = useState("");
  const requestedStatus = searchParams.get("status") ?? "all";
  const status = ["all", "draft", "sent", "paid", "overdue", "cancelled"].includes(requestedStatus) ? requestedStatus : "all";
  const requestedPeriod = searchParams.get("period") ?? "all";
  const period = invoicePeriods.includes(requestedPeriod) ? requestedPeriod : "all";
  const invoices = filterInvoiceEntries((records ?? [])
    .map((record) => ({ record, data: parseInvoiceData(record.data) }))
    .filter((entry): entry is { record: LocalRecord; data: InvoiceData } => Boolean(entry.data)), { status, period }, todayIso())
    .filter(({ data }) => {
      const needle = query.trim().toLocaleLowerCase("en-GB");
      return !needle || `${data.invoiceNumber ?? "draft"} ${data.practiceName}`.toLocaleLowerCase("en-GB").includes(needle);
    })
    .sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt));
  const emptyMessage = records === undefined
    ? null
    : invoiceEmptyMessage(records.length, invoices.length);

  return (
    <section className="record-page" aria-labelledby="invoices-title">
      <div className="record-page__header">
        <div><h1 id="invoices-title">Invoices</h1></div>
        <Link className="primary-action" href="/invoices/new">Create invoice</Link>
      </div>
      <OfflineStorageAlert initializationError={initializationError} />
      <div className="invoice-filters">
        <label>Search invoices<input onChange={(event) => setQuery(event.target.value)} type="search" value={query} /></label>
        <label>Status<select onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          if (event.target.value === "all") params.delete("status"); else params.set("status", event.target.value);
          router.replace(`/invoices${params.size ? `?${params.toString()}` : ""}`);
        }} value={status}><option value="all">All</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option></select></label>
        <label>Period<select onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          if (event.target.value === "all") params.delete("period"); else params.set("period", event.target.value);
          router.replace(`/invoices${params.size ? `?${params.toString()}` : ""}`);
        }} value={period}><option value="all">All dates</option><option value="calendar-year">Issued this calendar year</option><option value="payment-year">Received this calendar year</option><option value="missing-payment-date">Missing payment dates</option></select></label>
      </div>
      {invoices.length ? (
        <ul className="record-list">
          {invoices.map(({ record, data }) => (
            <li key={record.id}>
              <Link className="record-card invoice-card" href={`/invoices/${record.id}`}>
                <span><span className="record-card__title">{data.invoiceNumber ?? "Draft invoice"}</span><span>{data.practiceName}</span></span>
                {isDemoInvoicePayload(record.data) ? <span className="demo-badge">Demo</span> : null}
                <strong>{formatGBP(data.totalPence)}</strong>
                <span>{period === "payment-year" ? `Received ${formatDate(data.paidAt)}` : formatDate(data.issueDate)}</span>
                <StatusBadge status={displayStatus(data)} />
              </Link>
            </li>
          ))}
        </ul>
      ) : emptyMessage ? <p className="record-page__empty">{emptyMessage}</p> : null}
    </section>
  );
}

function restoredDraft(
  invoiceId: string,
  invoice: InvoiceData,
  itemRecords: LocalRecord[],
  paymentDetails: BankDetails,
): InvoiceDraft | null {
  if (
    invoice.status !== "draft" ||
    !invoice.practiceId ||
    !invoice.issueDate ||
    !invoice.dueDate ||
    !invoice.practiceSnapshot
  ) {
    return null;
  }
  const items = itemRecords
    .filter((record) => record.data.invoiceId === invoiceId)
    .map((record) => {
      const data = parseInvoiceItemData(record.data);
      return data ? { id: record.id, ...data } : null;
    })
    .filter((item): item is InvoiceDraftItem => Boolean(item));
  return {
    id: invoiceId,
    practiceId: invoice.practiceId,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    selectedSessionIds: items
      .map((item) => item.sessionId)
      .filter((id): id is string => Boolean(id)),
    items,
    totalPence: invoice.totalPence,
    practiceSnapshot: {
      name: invoice.practiceName,
      billingAddress: invoice.billingAddress,
    },
    paymentSnapshot: paymentDetails,
  };
}

export function NewInvoice({ draftId }: { draftId?: string }) {
  const practiceRecords = useOfflineRecords("practices");
  const sessionRecords = useOfflineRecords("sessions");
  const invoiceItemRecords = useOfflineRecords("invoiceItems");
  const draftRecord = useOfflineRecord("invoices", draftId ?? "");
  const { initializationError, markSaving, ownerId, ready, repository, syncNow } = useSync();
  const isOnline = useOnlineStatus();
  const payment = usePaymentConfiguration(ownerId, isOnline);

  const practices = (practiceRecords ?? [])
    .map(practiceForInvoice)
    .filter((practice): practice is InvoicePractice => Boolean(practice));
  const sessions = (sessionRecords ?? [])
    .map(sessionForInvoice)
    .filter((session): session is InvoiceSession => Boolean(session));
  const parsedDraft = draftRecord ? parseInvoiceData(draftRecord.data) : null;
  const initialDraft =
    draftId && parsedDraft && invoiceItemRecords && payment.state === "ready"
      ? restoredDraft(draftId, parsedDraft, invoiceItemRecords, payment.paymentDetails)
      : null;

  if (
    practiceRecords === undefined ||
    sessionRecords === undefined ||
    (draftId && (draftRecord === undefined || invoiceItemRecords === undefined))
  ) {
    return <section className="record-page"><OfflineStorageAlert initializationError={initializationError} /></section>;
  }

  if (payment.state === "loading") {
    return <section className="record-page"><OfflineStorageAlert initializationError={initializationError} /></section>;
  }

  if (payment.state === "offline") {
    return (
      <section className="record-page record-page--form">
        <Link className="record-page__back" href="/invoices">← Invoices</Link>
        <p className="eyebrow">Secure invoicing</p>
        <h1>Create invoice</h1>
        <div className="record-page__empty">Connect to load your payment details.</div>
      </section>
    );
  }

  if (payment.state === "missing" || payment.state === "upgrade_required") {
    return (
      <section className="record-page record-page--form">
        <Link className="record-page__back" href="/invoices">← Invoices</Link>
        <p className="eyebrow">Secure invoicing</p>
        <h1>Create invoice</h1>
        <div className="record-page__empty">
          Enter your bank details once in <Link href="/settings/profile">Profile and payments</Link>.
        </div>
      </section>
    );
  }

  if (payment.state !== "ready") {
    return (
      <section className="record-page record-page--form">
        <Link className="record-page__back" href="/invoices">← Invoices</Link>
        <p className="eyebrow">Secure invoicing</p>
        <h1>Create invoice</h1>
        <div className="record-page__empty">Payment details are temporarily unavailable.</div>
      </section>
    );
  }

  if (draftId && (!draftRecord || !parsedDraft || parsedDraft.status !== "draft")) {
    return <section className="record-page"><h1>Draft not found</h1><Link href="/invoices">Back to invoices</Link></section>;
  }

  const saveDraftRecords = async (draft: InvoiceDraft) => {
    if (!ready || !repository) throw new Error("Offline storage is not ready.");
    const invoicePayload = draftInvoiceRecord(draft);
    const existingInvoice = await repository.getRecord("invoices", draft.id);
    if (JSON.stringify(existingInvoice?.data) !== JSON.stringify(invoicePayload)) {
      await repository.saveRecord("invoices", draft.id, invoicePayload);
    }

    const nextItems = draftInvoiceItemRecords(draft);
    const existingItems = (await repository
      .tableFor("invoiceItems")
      .where("ownerId")
      .equals(repository.ownerId)
      .toArray())
      .filter((record) => record.data.invoiceId === draft.id && !record.deletedAt);
    const nextIds = new Set(nextItems.map((item) => item.id));
    for (const existing of existingItems) {
      if (!nextIds.has(existing.id)) {
        await repository.saveRecord("invoiceItems", existing.id, existing.data, "delete");
      }
    }
    for (const item of nextItems) {
      const existing = existingItems.find((candidate) => candidate.id === item.id);
      if (JSON.stringify(existing?.data) !== JSON.stringify(item.data)) {
        await repository.saveRecord("invoiceItems", item.id, item.data);
      }
    }
    markSaving();
  };

  return (
    <section className="record-page invoice-workspace" aria-labelledby="new-invoice-title">
      <Link className="record-page__back" href="/invoices">← Invoices</Link>
      <p className="eyebrow">Secure invoicing</p>
      <h1 id="new-invoice-title">{draftId ? "Continue draft" : "Create invoice"}</h1>
      <OfflineStorageAlert initializationError={initializationError} />
      <InvoiceWizard
        initialDraft={initialDraft ?? undefined}
        initialIssueDate={todayIso()}
        isOnline={isOnline}
        onCreatePdf={async (invoice, draft) => {
          const { generateInvoicePdf, uploadIssuedInvoicePdf } = await import(
            "@/pdf/generateInvoicePdf"
          );
          const blob = await generateInvoicePdf(pdfData(invoice, draft, payment.issuer));
          if (!hasPublicSupabaseConfiguration() || !repository) {
            throw new Error("Cloud artifact storage is unavailable.");
          }
          const client = createClient();
          const path = await uploadIssuedInvoicePdf(
            client,
            repository.ownerId,
            invoice.id,
            blob,
          );
          const { data: updated, error } = await client
            .from("invoice_records")
            .update({ artifact_path: path, updated_at: new Date().toISOString() })
            .eq("id", invoice.id)
            .select("*")
            .single();
          if (error) throw new Error("Invoice artifact could not be linked.");
          await repository.putServerRecord(
            "invoices",
            updated.id,
            invoicePayloadFromRow(updated),
            updated.revision,
            updated.updated_at,
            updated.deleted_at,
          );
          return blob;
        }}
        onIssue={async (draft) => {
          await saveDraftRecords(draft);
          await syncNow();
          if (!repository || !hasPublicSupabaseConfiguration()) {
            throw new Error("Cloud issuance is unavailable.");
          }
          const localInvoice = await repository.getRecord("invoices", draft.id);
          const pending = await repository.pendingMutations();
          if (
            localInvoice?.syncState !== "synced" ||
            pending.some((mutation) =>
              mutation.recordId === draft.id ||
              (mutation.recordType === "invoiceItems" &&
                mutation.payload.invoiceId === draft.id),
            )
          ) {
            throw new Error("Draft must finish syncing before issuance.");
          }
          const args = invoiceIssueArguments(
            draft,
            payment.encryptedSnapshot,
            payment.invoicePrefix,
            payment.issuer,
          );
          const client = createClient();
          const { data, error } = await client.rpc("issue_invoice", {
            ...args,
            requested_items: args.requested_items as unknown as Json,
            requested_payment_snapshot:
              args.requested_payment_snapshot as unknown as Json,
          });
          const row = data?.[0];
          if (error || !row) throw new Error("Atomic invoice issuance failed.");
          await repository.putServerRecord(
            "invoices",
            row.id,
            invoicePayloadFromRow(row),
            row.revision,
            row.updated_at,
            row.deleted_at,
          );
          await syncNow();
          return issuedInvoiceFromRow(row);
        }}
        onMarkSent={async (invoiceId) => {
          if (!repository) throw new Error("Offline storage is not ready.");
          const record = await repository.getRecord("invoices", invoiceId);
          if (!record) throw new Error("Invoice is unavailable.");
          await repository.saveRecord("invoices", invoiceId, {
            ...record.data,
            status: "sent",
          });
          markSaving();
          await syncNow();
        }}
        onSaveDraft={async (draft) => {
          await saveDraftRecords(draft);
          void syncNow();
        }}
        onSharePdf={async (blob, filename) => {
          const { shareInvoicePdf } = await import("@/pdf/generateInvoicePdf");
          return shareInvoicePdf(blob, filename);
        }}
        paymentDetails={payment.paymentDetails}
        practices={practices}
        sessions={sessions}
      />
    </section>
  );
}

export function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const record = useOfflineRecord("invoices", id);
  const itemRecords = useOfflineRecords("invoiceItems");
  const { initializationError, markSaving, repository, syncNow } = useSync();
  const [message, setMessage] = useState("");
  const [paidDate, setPaidDate] = useState(todayIso());
  const [missingPaidDate, setMissingPaidDate] = useState("");
  const [savingDate, setSavingDate] = useState(false);
  const [dateError, setDateError] = useState("");
  const savingDateRef = useRef(false);
  const data = record ? parseInvoiceData(record.data) : null;
  const items = (itemRecords ?? [])
    .filter((item) => item.data.invoiceId === id)
    .map((item) => {
      const parsed = parseInvoiceItemData(item.data);
      return parsed ? { id: item.id, ...parsed } : null;
    })
    .filter((item): item is InvoiceDraftItem => Boolean(item));

  if (record === undefined || itemRecords === undefined) {
    return <section className="record-page"><OfflineStorageAlert initializationError={initializationError} /></section>;
  }
  if (!record || !data) {
    return <section className="record-page"><h1>Invoice not found</h1><Link href="/invoices">Back to invoices</Link></section>;
  }

  const updateStatus = async (status: "sent" | "paid" | "cancelled") => {
    if (!repository) return;
    await repository.saveRecord(
      "invoices",
      id,
      invoiceStatusPayload(record.data, status, status === "paid" ? paidDate : undefined),
    );
    markSaving();
    await syncNow();
    setMessage(`Invoice marked as ${status}.`);
  };

  const saveMissingPaymentDate = async () => {
    if (!repository || savingDateRef.current) return;
    savingDateRef.current = true;
    setSavingDate(true);
    setDateError("");
    setMessage("");
    try {
      await repository.transformRecordAtomically("invoices", id, (latest) => {
        if (!latest || latest.deletedAt) throw new Error("Invoice is no longer available.");
        return missingPaymentDatePayload(latest.data, missingPaidDate);
      });
      markSaving();
      setMessage("Payment date saved on this device.");
      void syncNow().catch(() => undefined);
    } catch {
      setDateError("The payment date could not be saved. Check the date and reload if the invoice has changed.");
    } finally {
      savingDateRef.current = false;
      setSavingDate(false);
    }
  };

  return (
    <section className="record-page invoice-detail" aria-labelledby="invoice-title">
      <Link className="record-page__back" href="/invoices">← Invoices</Link>
      <div className="record-page__header">
        <div><p className="eyebrow">Invoice</p><h1 id="invoice-title">{data.invoiceNumber ?? "Draft invoice"}</h1><p>{data.practiceName}</p></div>
        <StatusBadge status={displayStatus(data)} />
      </div>
      <div className="invoice-detail__card">
        <dl>
          <div><dt>Issue date</dt><dd>{formatDate(data.issueDate)}</dd></div>
          <div><dt>Due date</dt><dd>{formatDate(data.dueDate)}</dd></div>
          <div><dt>Total</dt><dd>{formatGBP(data.totalPence)}</dd></div>
          {data.paidAt ? <div><dt>Payment received</dt><dd>{formatDate(data.paidAt)}</dd></div> : null}
        </dl>
        <p>{data.billingAddress}</p>
      </div>
      <div className="invoice-detail__card">
        <h2>Items</h2>
        <ul className="invoice-items">
          {items.map((item) => <li key={item.id}><span><strong>{item.description}</strong><small>{item.quantity} × {formatGBP(item.unitRatePence)}</small></span><strong>{formatGBP(item.lineTotalPence)}</strong></li>)}
        </ul>
      </div>
      {data.status === "paid" && !data.paidAt ? (
        <form className="invoice-detail__card invoice-payment-correction" onSubmit={(event) => { event.preventDefault(); void saveMissingPaymentDate(); }}>
          <h2>Add the payment date</h2>
          <p>This invoice is paid, but its received date is missing. Add the actual date to include it in the correct year’s totals.</p>
          <label htmlFor="missing-payment-date">Payment received date</label>
          <input id="missing-payment-date" type="date" required max={todayIso()} value={missingPaidDate} onChange={(event) => setMissingPaidDate(event.target.value)} disabled={savingDate} />
          <Button type="submit" disabled={!repository || !missingPaidDate} loading={savingDate}>Save payment date</Button>
          {dateError ? <p className="record-form__error" role="alert">{dateError}</p> : null}
        </form>
      ) : null}
      <div className="invoice-detail__actions">
        {data.status === "draft" ? <Link className="primary-action" href={`/invoices/new?draft=${id}`}>Continue draft</Link> : null}
        {data.status === "draft" && data.issuedAt ? <Button onClick={() => void updateStatus("sent")}>Mark sent</Button> : null}
        {data.status === "sent" ? <><label>Payment received date<input onChange={(event) => setPaidDate(event.target.value)} type="date" value={paidDate} /></label><Button onClick={() => void updateStatus("paid")}>Mark paid</Button></> : null}
        {data.status !== "cancelled" ? <Button onClick={() => void updateStatus("cancelled")} variant="secondary">Cancel invoice</Button> : null}
      </div>
      {data.issuedAt ? <p className="record-form__notice">The issued financial content is locked. Download and share controls remain available from the issuance screen; retained artifacts are private.</p> : null}
      {message ? <p className="record-form__success" role="status">{message}</p> : null}
    </section>
  );
}
