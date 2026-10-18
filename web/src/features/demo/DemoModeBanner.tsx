"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

export function DemoModeBanner({ onDelete, visible }: { onDelete: () => Promise<void>; visible: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirming) dialogRef.current?.focus();
    else if (visible) openerRef.current?.focus();
  }, [busy, confirming, visible]);

  const closeDialog = () => setConfirming(false);
  if (!visible) return null;

  return <>
    <aside className="demo-mode-banner" aria-label="Demo Mode" id="demo-controls">
      <div><strong>Demo Mode</strong><span>Fictional example records are visible.</span></div>
      <Button onClick={(event) => { openerRef.current = event.currentTarget; setError(""); setConfirming(true); }} type="button" variant="secondary">Delete all demo data</Button>
    </aside>
    {confirming ? <div className="demo-mode-overlay">
      <section aria-labelledby="delete-demo-title" aria-modal="true" className="demo-mode-dialog" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          closeDialog();
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        if (event.shiftKey && (document.activeElement === dialogRef.current || document.activeElement === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }} ref={dialogRef} role="dialog" tabIndex={-1}>
        <h2 id="delete-demo-title">Delete all demo data?</h2>
        <p>Your real practices, sessions, invoices, expenses, categories, and receipts will be kept.</p>
        {error ? <p className="record-form__error" role="alert">{error}</p> : null}
        <div className="demo-mode-dialog__actions">
          <Button disabled={busy} onClick={closeDialog} type="button" variant="secondary">Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onDelete();
              closeDialog();
            } catch {
              setError("Demo data could not be deleted. Please try again.");
            } finally {
              setBusy(false);
            }
          }} type="button">Delete all demo data</Button>
        </div>
      </section>
    </div> : null}
  </>;
}

function hasActiveDemo(records: LocalRecord[] | undefined) {
  return records?.some((record) => record.data.isDemo === true) ?? false;
}

export function DemoModeSurface() {
  const practices = useOfflineRecords("practices");
  const sessions = useOfflineRecords("sessions");
  const invoices = useOfflineRecords("invoices");
  const invoiceItems = useOfflineRecords("invoiceItems");
  const expenseCategories = useOfflineRecords("expenseCategories");
  const expenses = useOfflineRecords("expenses");
  const { syncNow } = useSync();
  const visible = [practices, sessions, invoices, invoiceItems, expenseCategories, expenses].some(hasActiveDemo);

  return <DemoModeBanner visible={visible} onDelete={async () => {
    const response = await fetch("/api/demo-data", {
      cache: "no-store",
      credentials: "include",
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Demo cleanup failed.");
    await syncNow();
  }} />;
}
