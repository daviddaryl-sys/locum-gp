"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Profession } from "@/domain/profession";

import {
  ExpenseForm,
  type ExpenseFormFocusField,
  type ExpenseFormSubmission,
} from "./ExpenseForm";
import { analyzeReceiptLocally } from "./receiptOcr";
import type {
  ReceiptFieldSuggestion,
  ReceiptSuggestionConfidence,
  ReceiptSuggestions,
} from "./receiptSuggestions";

type Option = { id: string; name: string };
type AnalyzeReceipt = typeof analyzeReceiptLocally;

type ScanState =
  | { status: "choose" }
  | { status: "scanning"; progress: number }
  | { status: "review"; file: File; suggestions: ReceiptSuggestions }
  | { status: "failed"; file: File; message: string };

type ReceiptScanFlowProps = {
  analyzeReceipt?: AnalyzeReceipt;
  customCategories: Option[];
  onSaved?: () => void;
  onSubmit: (submission: ExpenseFormSubmission) => Promise<void>;
  practices: Option[];
  profession: Profession;
};

const RECEIPT_ACCEPT =
  ".jpg,.jpeg,.png,.heic,.pdf,image/jpeg,image/png,image/heic,application/pdf";
const HISTORY_GUARD_KEY = "__locumReceiptReviewGuard";

function confidenceText(
  label: string,
  suggestion: ReceiptFieldSuggestion<unknown> | null,
): string {
  const confidence: Record<ReceiptSuggestionConfidence, string> = {
    high: "High confidence",
    medium: "Check this suggestion",
    low: "Low confidence — check carefully",
  };
  return `${label}: ${suggestion ? confidence[suggestion.confidence] : "No suggestion — enter manually"}`;
}

function firstUncertainField(
  suggestions: ReceiptSuggestions,
): ExpenseFormFocusField | undefined {
  const fields: Array<[
    ExpenseFormFocusField,
    ReceiptFieldSuggestion<unknown> | null,
  ]> = [
    ["supplier", suggestions.supplier],
    ["amount", suggestions.amountPence],
    ["date", suggestions.expenseDate],
    ["category", suggestions.category],
  ];
  return fields.find(([, suggestion]) => suggestion?.confidence !== "high")?.[0];
}

function ReceiptPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  const [expanded, setExpanded] = useState(false);
  const supported = file.type === "image/jpeg" || file.type === "image/png";

  useEffect(() => {
    if (!supported) return;
    const objectUrl = URL.createObjectURL(file);
    if (image.current) image.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, supported]);

  return supported ? (
    <figure className="receipt-scan__preview-card">
      {/* The source is a short-lived object URL created from the user's local file. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Receipt preview"
        className={`receipt-scan__preview receipt-scan__preview--${expanded ? "expanded" : "compact"}`}
        ref={image}
      />
      <figcaption>
        <span>{file.name}</span>
        <button
          aria-label={expanded ? "Collapse receipt preview" : "Expand receipt preview"}
          className="button button--secondary"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Hide receipt" : "View receipt"}
        </button>
      </figcaption>
    </figure>
  ) : (
    <p className="receipt-scan__file">Selected receipt: {file.name}</p>
  );
}

export function ReceiptScanFlow({
  analyzeReceipt = analyzeReceiptLocally,
  customCategories,
  onSaved,
  onSubmit,
  practices,
  profession,
}: ReceiptScanFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({ status: "choose" });
  const [pendingDiscard, setPendingDiscard] = useState<
    { kind: "back" } | { kind: "reset" } | { kind: "href"; href: string } | null
  >(null);
  const [guardReleased, setGuardReleased] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const historyGuardPreviousState = useRef<unknown>(null);
  const historyGuardToken = useRef<string | null>(null);
  const sentinelActive = useRef(false);
  const navigationAllowed = useRef(false);
  const scanVersion = useRef(0);
  const dirty = state.status !== "choose" && !guardReleased;

  useEffect(
    () => () => {
      scanVersion.current += 1;
      controller.current?.abort();
      const token = historyGuardToken.current;
      if (sentinelActive.current && token && window.history.state?.[HISTORY_GUARD_KEY] === token) {
        window.history.replaceState(historyGuardPreviousState.current, "", window.location.href);
      }
      sentinelActive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (navigationAllowed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        navigationAllowed.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingDiscard({
        kind: "href",
        href: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handlePopState = () => {
      if (navigationAllowed.current) return;
      if (!sentinelActive.current) return;
      sentinelActive.current = false;
      setPendingDiscard({ kind: "back" });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [dirty]);

  function armHistoryGuard() {
    if (sentinelActive.current) return;
    const token = historyGuardToken.current ?? crypto.randomUUID();
    historyGuardToken.current = token;
    historyGuardPreviousState.current = window.history.state;
    const currentState = window.history.state;
    const state = currentState && typeof currentState === "object"
      ? { ...currentState, [HISTORY_GUARD_KEY]: token }
      : { [HISTORY_GUARD_KEY]: token };
    window.history.pushState(state, "", window.location.href);
    sentinelActive.current = true;
  }

  function removeSentinelWithoutLeaving() {
    const token = historyGuardToken.current;
    if (!sentinelActive.current || !token || window.history.state?.[HISTORY_GUARD_KEY] !== token) return;
    sentinelActive.current = false;
    navigationAllowed.current = true;
    window.history.back();
  }

  function releaseHistoryGuard(): Promise<void> {
    const token = historyGuardToken.current;
    if (!sentinelActive.current || !token || window.history.state?.[HISTORY_GUARD_KEY] !== token) {
      return Promise.resolve();
    }
    sentinelActive.current = false;
    navigationAllowed.current = true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener("popstate", finish);
        resolve();
      };
      window.addEventListener("popstate", finish);
      window.history.back();
      window.setTimeout(finish, 250);
    });
  }

  async function beginAnalysis(file: File) {
    navigationAllowed.current = false;
    setGuardReleased(false);
    armHistoryGuard();
    const version = ++scanVersion.current;
    const nextController = new AbortController();
    controller.current?.abort();
    controller.current = nextController;
    setState({ status: "scanning", progress: 0 });

    try {
      const result = await analyzeReceipt(file, profession, {
        signal: nextController.signal,
        onProgress: ({ progress }) => {
          if (scanVersion.current !== version) return;
          const percentage = Math.round(Math.min(1, Math.max(0, progress)) * 100);
          setState({ status: "scanning", progress: percentage });
        },
      });
      if (scanVersion.current !== version) return;
      if (result.status === "manual-fallback") {
        setState({ status: "failed", file, message: result.message });
      } else {
        setState({ status: "review", file, suggestions: result.suggestions });
      }
    } catch {
      if (scanVersion.current !== version || nextController.signal.aborted) return;
      setState({
        status: "failed",
        file,
        message: "This receipt could not be analysed on this device.",
      });
    } finally {
      if (controller.current === nextController) controller.current = null;
    }
  }

  function cancelAnalysis() {
    scanVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    removeSentinelWithoutLeaving();
    setGuardReleased(false);
    setPendingDiscard(null);
    setState({ status: "choose" });
  }

  function discardReview() {
    setPendingDiscard({ kind: "reset" });
  }

  async function confirmDiscard() {
    const pending = pendingDiscard;
    if (!pending) return;
    setPendingDiscard(null);
    if (pending.kind === "reset") {
      cancelAnalysis();
      return;
    }
    navigationAllowed.current = true;
    setGuardReleased(true);
    if (pending.kind === "back") window.history.back();
    else {
      await releaseHistoryGuard();
      router.push(pending.href);
    }
  }

  async function submitAndReleaseGuard(submission: ExpenseFormSubmission) {
    await onSubmit(submission);
    navigationAllowed.current = true;
    setGuardReleased(true);
    setPendingDiscard(null);
    await releaseHistoryGuard();
    onSaved?.();
  }

  function keepEditing() {
    if (pendingDiscard?.kind === "back") {
      navigationAllowed.current = false;
      armHistoryGuard();
    }
    setPendingDiscard(null);
  }

  const pageHeader = <>
    <Link className="record-page__back" href="/expenses/new">← Add expense</Link>
    <h1>Scan receipt</h1>
  </>;

  const discardDialog = pendingDiscard ? <div
    aria-labelledby="receipt-discard-title"
    aria-modal="true"
    className="receipt-scan__dialog-backdrop"
    role="dialog"
  >
    <div className="receipt-scan__dialog">
      <h2 id="receipt-discard-title">Discard receipt changes?</h2>
      <p>Your receipt and any edits on this page will be lost.</p>
      <div className="record-form__actions">
        <button autoFocus onClick={keepEditing} type="button">Keep editing</button>
        <button className="button button--secondary" onClick={() => void confirmDiscard()} type="button">Discard and leave</button>
      </div>
    </div>
  </div> : null;

  if (state.status === "choose") {
    return (
      <>{pageHeader}<div className="receipt-scan__choose">
        <p>Your receipt stays on this device while suggestions are prepared.</p>
        <div className="receipt-scan__choices">
          <label className="button receipt-scan__choice">
            Take photo
            <input
              accept="image/jpeg,image/png"
              capture="environment"
              className="receipt-scan__file-input"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void beginAnalysis(file);
              }}
              type="file"
            />
          </label>
          <label className="button button--secondary receipt-scan__choice">
            Choose receipt
            <input
              accept={RECEIPT_ACCEPT}
              className="receipt-scan__file-input"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void beginAnalysis(file);
              }}
              type="file"
            />
          </label>
        </div>
        <p className="record-form__hint">JPG and PNG can be analysed locally. HEIC and PDF remain available for manual entry.</p>
        <Link href="/expenses/new/manual">Enter manually</Link>
      </div>{discardDialog}</>
    );
  }

  if (state.status === "scanning") {
    return (
      <>{pageHeader}<div className="receipt-scan__progress">
        <p aria-live="polite" role="status">
          Recognising receipt on this device — {state.progress}%
        </p>
        <progress
          aria-label="Receipt recognition progress"
          aria-valuenow={state.progress}
          max="100"
          value={state.progress}
        />
        <button onClick={cancelAnalysis} type="button">Cancel</button>
      </div>{discardDialog}</>
    );
  }

  if (state.status === "failed") {
    return (
      <>{pageHeader}<div className="receipt-scan__failed">
        <ReceiptPreview file={state.file} />
        <p role="alert">{state.message}</p>
        <ExpenseForm
          customCategories={customCategories}
          lockPrefilledReceipt
          onSubmit={submitAndReleaseGuard}
          practices={practices}
          prefill={{ focusField: "supplier", receipt: state.file }}
          profession={profession}
          shellIntro="Enter the details, then save the expense."
          shellTitleAs="h2"
          variant="receipt-review"
        />
        <div className="receipt-scan__review-actions">
          <button className="button button--quiet" onClick={discardReview} type="button">Try again</button>
          <Link className="button button--quiet" href="/expenses/new/manual">Enter manually</Link>
        </div>
      </div>{discardDialog}</>
    );
  }

  const { file, suggestions } = state;
  return (
    <>{pageHeader}<div className="receipt-scan__review">
      <h2>Review receipt</h2>
      <p>Check every suggestion before saving this expense.</p>
      <ReceiptPreview file={file} />
      <ul className="receipt-scan__confidence" aria-label="Suggestion confidence">
        <li>{confidenceText("Supplier", suggestions.supplier)}</li>
        <li>{confidenceText("Amount", suggestions.amountPence)}</li>
        <li>{confidenceText("Date", suggestions.expenseDate)}</li>
        <li>{confidenceText("Category", suggestions.category)}</li>
      </ul>
      <ExpenseForm
        customCategories={customCategories}
        lockPrefilledReceipt
        onSubmit={submitAndReleaseGuard}
        practices={practices}
        prefill={{
          amountPence: suggestions.amountPence?.value,
          categoryKey: suggestions.category?.value,
          expenseDate: suggestions.expenseDate?.value,
          focusField: firstUncertainField(suggestions),
          receipt: file,
          supplierDescription: suggestions.supplier?.value,
        }}
        profession={profession}
        shellTitleAs="h2"
        variant="receipt-review"
      />
      <div className="receipt-scan__review-actions">
        <button className="button button--quiet" onClick={discardReview} type="button">Try again</button>
        <Link className="button button--quiet" href="/expenses/new/manual">Enter manually</Link>
      </div>
    </div>{discardDialog}</>
  );
}
