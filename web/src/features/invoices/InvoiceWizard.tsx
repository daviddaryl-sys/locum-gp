"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { calculateDueDate } from "@/domain/invoice";
import { calculateLineTotal, formatGBP, sumPence } from "@/domain/money";
import { durationHours } from "@/domain/session";
import { parsePoundsToPence } from "@/features/practices/PracticeForm";
import { downloadInvoicePdf } from "@/pdf/generateInvoicePdf";
import type { BankDetails } from "@/security/vault";

export type InvoicePractice = {
  id: string;
  name: string;
  billingAddress: string;
  paymentTermsDays: number;
  archived: boolean;
};

export type InvoiceSession = {
  id: string;
  practiceId: string;
  startsAt: string;
  endsAt: string;
  hourlyRatePence: number;
  status: "planned" | "completed" | "invoiced" | "cancelled";
};

export type InvoiceDraftItem = {
  id: string;
  sessionId: string | null;
  description: string;
  quantity: number;
  unitRatePence: number;
  lineTotalPence: number;
};

export type InvoiceDraft = {
  id: string;
  practiceId: string | null;
  issueDate: string;
  dueDate: string;
  selectedSessionIds: string[];
  items: InvoiceDraftItem[];
  totalPence: number;
  practiceSnapshot: {
    name: string;
    billingAddress: string;
  } | null;
  paymentSnapshot: BankDetails;
};

export type IssuedInvoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  issuedAt: string;
  totalPence: number;
  status: "draft" | "sent" | "paid" | "cancelled";
};

type InvoiceWizardProps = {
  initialDraft?: InvoiceDraft;
  initialIssueDate: string;
  isOnline: boolean;
  onCreatePdf?: (
    invoice: IssuedInvoice,
    draft: InvoiceDraft,
  ) => Promise<Blob>;
  onIssue: (draft: InvoiceDraft) => Promise<IssuedInvoice>;
  onMarkSent?: (invoiceId: string) => Promise<void>;
  onSaveDraft: (draft: InvoiceDraft) => Promise<void>;
  onSharePdf?: (blob: Blob, filename: string) => Promise<boolean>;
  paymentDetails: BankDetails;
  practices: InvoicePractice[];
  sessions: InvoiceSession[];
};

type ExtraDraft = {
  description: string;
  quantity: string;
  unitRatePounds: string;
};

const STEP_TITLES = [
  "Choose practice",
  "Choose work",
  "Check details",
  "Preview invoice",
  "Send invoice",
] as const;

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatLondonTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function itemFromSession(session: InvoiceSession): InvoiceDraftItem {
  const quantity = durationHours(session.startsAt, session.endsAt);
  return {
    id: session.id,
    sessionId: session.id,
    description: "GP locum session",
    quantity,
    unitRatePence: session.hourlyRatePence,
    lineTotalPence: calculateLineTotal(quantity, session.hourlyRatePence),
  };
}

export function InvoiceWizard({
  initialDraft,
  initialIssueDate,
  isOnline,
  onCreatePdf,
  onIssue,
  onMarkSent,
  onSaveDraft,
  onSharePdf,
  paymentDetails,
  practices,
  sessions,
}: InvoiceWizardProps) {
  const [step, setStep] = useState(0);
  const [practiceId, setPracticeId] = useState<string | null>(
    initialDraft?.practiceId ?? null,
  );
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(
    initialDraft?.selectedSessionIds ?? [],
  );
  const [extraItems, setExtraItems] = useState<InvoiceDraftItem[]>(
    initialDraft?.items.filter((item) => item.sessionId === null) ?? [],
  );
  const [extraDraft, setExtraDraft] = useState<ExtraDraft | null>(null);
  const [extraError, setExtraError] = useState("");
  const [issueDate, setIssueDate] = useState(
    initialDraft?.issueDate ?? initialIssueDate,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [issuedInvoice, setIssuedInvoice] = useState<IssuedInvoice | null>(null);
  const [shareConfirmation, setShareConfirmation] = useState(false);
  const [markedSent, setMarkedSent] = useState(false);
  const [invoiceId] = useState(() => initialDraft?.id ?? crypto.randomUUID());
  const pdfBlob = useRef<Blob | null>(null);
  const inFlight = useRef(false);

  const practice = practices.find((candidate) => candidate.id === practiceId) ?? null;
  const eligibleSessions = sessions.filter(
    (session) => session.practiceId === practiceId && session.status === "completed",
  );
  const sessionItems = selectedSessionIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is InvoiceSession => Boolean(session))
    .map(itemFromSession);
  const items = [...sessionItems, ...extraItems];
  const totalPence = sumPence(items.map((item) => item.lineTotalPence));
  const dueDate = calculateDueDate(issueDate, practice?.paymentTermsDays ?? 0);

  const draft: InvoiceDraft = {
    id: invoiceId,
    practiceId,
    issueDate,
    dueDate,
    selectedSessionIds,
    items,
    totalPence,
    practiceSnapshot: practice
      ? { name: practice.name, billingAddress: practice.billingAddress }
      : null,
    paymentSnapshot: paymentDetails,
  };

  const canContinue =
    (step === 0 && Boolean(practice)) ||
    (step === 1 && selectedSessionIds.length > 0) ||
    (step === 2 && items.length > 0) ||
    step === 3;

  const saveDraft = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await onSaveDraft(draft);
      setMessage("Draft saved on this device.");
    } catch {
      setMessage("Draft could not be saved. Your entries have been kept.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!isOnline || inFlight.current || !practice || !items.length) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await onIssue(draft);
      setIssuedInvoice(result);
      setMessage("");
      if (onCreatePdf) {
        try {
          pdfBlob.current = await onCreatePdf(result, draft);
        } catch {
          setMessage(
            "Invoice issued, but its PDF could not be retained. Use Download PDF to retry.",
          );
        }
      }
    } catch {
      setMessage("Invoice could not be issued. Your draft has been kept.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const ensurePdf = async () => {
    if (!issuedInvoice || !onCreatePdf) {
      throw new Error("Invoice PDF is unavailable.");
    }
    pdfBlob.current ??= await onCreatePdf(issuedInvoice, draft);
    return pdfBlob.current;
  };

  const download = async () => {
    if (!issuedInvoice || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const blob = await ensurePdf();
      downloadInvoicePdf(blob, `${issuedInvoice.invoiceNumber}.pdf`);
    } catch {
      setMessage("Invoice PDF could not be prepared. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const share = async () => {
    if (!issuedInvoice || !onSharePdf || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const blob = await ensurePdf();
      const shared = await onSharePdf(blob, `${issuedInvoice.invoiceNumber}.pdf`);
      if (shared) setShareConfirmation(true);
      else setMessage("File sharing is unavailable. Use Download PDF instead.");
    } catch {
      setMessage("Invoice PDF could not be shared. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const markSent = async () => {
    if (!issuedInvoice || !onMarkSent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onMarkSent(issuedInvoice.id);
      setMarkedSent(true);
      setShareConfirmation(false);
    } catch {
      setMessage("Invoice status could not be updated. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const addExtra = () => {
    if (!extraDraft) return;
    const description = extraDraft.description.trim();
    const quantity = Number(extraDraft.quantity);
    const rate = parsePoundsToPence(extraDraft.unitRatePounds);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || rate === null) {
      setExtraError("Enter a description, positive quantity, and valid rate.");
      return;
    }
    try {
      setExtraItems((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          sessionId: null,
          description,
          quantity,
          unitRatePence: rate,
          lineTotalPence: calculateLineTotal(quantity, rate),
        },
      ]);
      setExtraDraft(null);
      setExtraError("");
    } catch {
      setExtraError("Enter a valid quantity and rate.");
    }
  };

  return (
    <section className="invoice-wizard" aria-labelledby="invoice-step-title">
      <h2 id="invoice-step-title">{STEP_TITLES[step]}</h2>

      {step === 0 ? (
        <fieldset className="invoice-wizard__choices">
          <legend>Choose the practice to invoice.</legend>
          {practices.filter((candidate) => !candidate.archived).map((candidate) => (
            <label className="invoice-wizard__choice" key={candidate.id}>
              <input
                aria-label={candidate.name}
                checked={practiceId === candidate.id}
                disabled={busy}
                name="invoice-practice"
                onChange={() => {
                  setPracticeId(candidate.id);
                  setSelectedSessionIds([]);
                  setExtraItems([]);
                  setMessage("");
                }}
                type="radio"
              />
              <span><strong>{candidate.name}</strong><small>{candidate.billingAddress}</small></span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <fieldset className="invoice-wizard__choices">
          <legend>Choose the completed sessions to include.</legend>
          {eligibleSessions.length ? eligibleSessions.map((session) => {
            const item = itemFromSession(session);
            const date = new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/London",
            }).format(new Date(session.startsAt));
            const label = `${date}, ${formatLondonTime(session.startsAt)} to ${formatLondonTime(session.endsAt)}, ${formatGBP(item.lineTotalPence)}`;
            return (
              <label className="invoice-wizard__choice" key={session.id}>
                <input
                  checked={selectedSessionIds.includes(session.id)}
                  disabled={busy}
                  onChange={() => setSelectedSessionIds((current) =>
                    current.includes(session.id)
                      ? current.filter((id) => id !== session.id)
                      : [...current, session.id]
                  )}
                  type="checkbox"
                />
                <span>{label}</span>
              </label>
            );
          }) : <p>No eligible sessions are available for this practice.</p>}
          <p aria-live="polite" className="invoice-wizard__summary">
            {selectedSessionIds.length} {selectedSessionIds.length === 1 ? "session" : "sessions"} selected · {formatGBP(sumPence(sessionItems.map((item) => item.lineTotalPence)))}
          </p>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <div className="invoice-wizard__items">
          <p className="invoice-wizard__intro">
            Check the work you selected and add anything else before you continue.
          </p>
          <ul>
            {items.map((item, index) => (
              <li key={`${item.sessionId ?? "extra"}-${index}`}>
                <span><strong>{item.description}</strong><small>{item.quantity} × {formatGBP(item.unitRatePence)}</small></span>
                <strong>{formatGBP(item.lineTotalPence)}</strong>
              </li>
            ))}
          </ul>
          {extraDraft ? (
            <div className="invoice-wizard__extra">
              <label>Description<input value={extraDraft.description} onChange={(event) => setExtraDraft({ ...extraDraft, description: event.target.value })} /></label>
              <label>Quantity<input inputMode="decimal" value={extraDraft.quantity} onChange={(event) => setExtraDraft({ ...extraDraft, quantity: event.target.value })} /></label>
              <label>Unit rate<input inputMode="decimal" value={extraDraft.unitRatePounds} onChange={(event) => setExtraDraft({ ...extraDraft, unitRatePounds: event.target.value })} /></label>
              {extraError ? <p role="alert">{extraError}</p> : null}
              <Button onClick={addExtra} type="button" variant="secondary">Add item</Button>
            </div>
          ) : (
            <Button onClick={() => setExtraDraft({ description: "", quantity: "1", unitRatePounds: "" })} type="button" variant="secondary">Add extra item</Button>
          )}
          <p className="invoice-wizard__total">Total <strong>{formatGBP(totalPence)}</strong></p>
        </div>
      ) : null}

      {step === 3 && practice ? (
        <div className="invoice-wizard__review">
          <p className="invoice-wizard__intro">
            Preview the invoice details before you lock the number and totals.
          </p>
          <label>Issue date<input disabled={busy} onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} /></label>
          <dl>
            <div><dt>Bill to</dt><dd>{practice.name}<br />{practice.billingAddress}</dd></div>
            <div><dt>Due date</dt><dd>{formatDate(dueDate)}</dd></div>
            <div><dt>Payment account</dt><dd>{paymentDetails.accountName}<br />Sort code {paymentDetails.sortCode}<br />Account ending {paymentDetails.accountNumber.slice(-4)}</dd></div>
            <div><dt>Total</dt><dd>{formatGBP(totalPence)}</dd></div>
          </dl>
        </div>
      ) : null}

      {step === 4 ? (
        issuedInvoice ? (
          <div className="invoice-wizard__issued">
            <p className="invoice-wizard__issued-label">Issued securely</p>
            <p className="invoice-wizard__number">{issuedInvoice.invoiceNumber}</p>
            <p>{formatGBP(issuedInvoice.totalPence)} · Due {formatDate(issuedInvoice.dueDate)}</p>
            {markedSent ? <p role="status">Marked as sent.</p> : null}
            <div className="invoice-wizard__actions">
              <Button disabled={!onCreatePdf || busy} onClick={download} type="button">Download PDF</Button>
              <Button disabled={!onCreatePdf || !onSharePdf || busy} onClick={share} type="button" variant="secondary">Share invoice</Button>
            </div>
            {shareConfirmation ? (
              <div className="invoice-wizard__confirmation" role="alertdialog" aria-labelledby="share-confirm-title">
                <h3 id="share-confirm-title">Did you complete the share?</h3>
                <p>Mark as sent only if you completed the share in the other app.</p>
                <Button disabled={!onMarkSent || busy} onClick={markSent} type="button">Yes, mark as sent</Button>
                <Button onClick={() => setShareConfirmation(false)} type="button" variant="secondary">Not yet</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="invoice-wizard__issue">
            <p className="invoice-wizard__intro">
              Send this invoice only when you are ready to allocate the next invoice number.
            </p>
            <p>Final issuance allocates the next invoice number and locks the financial content.</p>
            <p className="invoice-wizard__total">Total <strong>{formatGBP(totalPence)}</strong></p>
            {!isOnline ? <p className="record-form__notice">Connect to the internet to issue this invoice.</p> : null}
            <Button disabled={!isOnline || busy} loading={busy} onClick={issue} type="button">Issue invoice</Button>
          </div>
        )
      ) : null}

      {message ? (
        <p
          className={message.includes("could not") ? "record-form__error" : "record-form__success"}
          role={message.includes("could not") ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {!issuedInvoice ? (
        <div className="invoice-wizard__navigation">
          {step > 0 ? <Button disabled={busy} onClick={() => setStep((current) => current - 1)} type="button" variant="secondary">Back</Button> : null}
          {step < 4 ? <Button disabled={!canContinue || busy} onClick={() => { setMessage(""); setStep((current) => current + 1); }} type="button">Next</Button> : null}
          <Button disabled={busy} onClick={saveDraft} type="button" variant="secondary">Save draft</Button>
        </div>
      ) : null}
    </section>
  );
}
