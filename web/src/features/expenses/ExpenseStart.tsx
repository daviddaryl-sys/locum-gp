"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  mergeProfession,
  PROFESSIONS,
  readProfession,
  type Profession,
} from "@/domain/profession";
import { useOfflineRecords } from "@/offline/useRecords";
import { useSync } from "@/sync/SyncProvider";

const ENTRY_METHODS = [
  {
    description: "Use a photo and check the suggested details.",
    href: "/expenses/new/scan",
    label: "Scan a receipt",
    recommended: true,
  },
  {
    description: "Type the details in yourself.",
    href: "/expenses/new/manual",
    label: "Add it myself",
    recommended: false,
  },
  {
    description: "Record a work journey and the mileage amount.",
    href: "/expenses/new/mileage",
    label: "Add mileage",
    recommended: false,
  },
] as const;

export function ExpenseStart() {
  const settingRecords = useOfflineRecords("settings");
  const persistedProfession = readProfession(settingRecords?.[0]?.data);
  const [draftProfession, setDraftProfession] = useState<Profession | null>(null);
  const [locallyEdited, setLocallyEdited] = useState(false);
  const [optimisticSave, setOptimisticSave] = useState<{
    base: Profession | null;
    value: Profession;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const { markSaving, ready, repository, syncNow } = useSync();
  const optimisticProfession =
    optimisticSave?.base === persistedProfession ? optimisticSave.value : null;
  const canonicalProfession = optimisticProfession ?? persistedProfession;
  const selectedProfession = locallyEdited
    ? draftProfession
    : canonicalProfession;
  const activeProfession = locallyEdited ? null : canonicalProfession;

  if (settingRecords === undefined) {
    return <p role="status">Preparing expense preferences</p>;
  }

  const saveProfession = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProfession || busy) return;
    if (!ready || !repository) {
      setFailed(true);
      setMessage("Offline storage is not ready.");
      return;
    }

    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const id = settingRecords[0]?.id ?? repository.ownerId;
      await repository.transformRecordAtomically(
        "settings",
        id,
        (current) => mergeProfession(current?.data ?? {}, selectedProfession),
      );
      setOptimisticSave({
        base: persistedProfession,
        value: selectedProfession,
      });
      setLocallyEdited(false);
      setDraftProfession(null);
      markSaving();
      void syncNow();
      setMessage("Profession saved. Choose how to add your expense.");
    } catch {
      setFailed(true);
      setMessage("Profession could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="record-page expense-start" aria-labelledby="expense-start-title">
      <Link className="record-page__back" href="/expenses">
        ← Expenses
      </Link>
      <h1 id="expense-start-title">Add expense</h1>

      {!activeProfession ? (
        <form className="expense-start__profession" onSubmit={saveProfession}>
          <h2>Choose your profession</h2>
          <fieldset disabled={busy}>
            <legend>Select GP or Pharmacist</legend>
            <p>
              Confirm this once so categories use the right professional labels.
              We will not assume GP for an existing account.
            </p>
            <div className="expense-start__profession-options">
              {PROFESSIONS.map((option) => (
                <label key={option.value}>
                  <input
                    checked={selectedProfession === option.value}
                    name="profession"
                    onChange={() => {
                      setDraftProfession(option.value);
                      setLocallyEdited(true);
                      setMessage("");
                      setFailed(false);
                    }}
                    type="radio"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          {message ? (
            <p
              className={failed ? "record-form__error" : "record-form__success"}
              role={failed ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}
          <button disabled={!selectedProfession || busy} type="submit">
            {busy ? "Saving profession" : "Save and continue"}
          </button>
        </form>
      ) : (
        <>
          {message ? <p className="record-form__success" role="status">{message}</p> : null}
          <section className="expense-start__methods" aria-labelledby="expense-method-title">
            <h2 id="expense-method-title">How would you like to add this expense?</h2>
            <p className="expense-start__profession-context">
              Using {activeProfession === "gp" ? "GP" : "Pharmacist"} expense categories.
            </p>
            <p>Choose the easiest way to add this work cost.</p>
            <div className="expense-start__grid" data-testid="expense-entry-methods">
              {ENTRY_METHODS.map((method) => (
                <Link
                  className={`expense-start__card${method.recommended ? " expense-start__card--primary" : ""}`}
                  href={method.href}
                  key={method.href}
                >
                  <span className="expense-start__card-copy">
                    <strong>{method.label}</strong>
                    <span>{method.description}</span>
                  </span>
                  {method.recommended ? (
                    <span className="expense-start__recommended">Recommended</span>
                  ) : null}
                  <span aria-hidden="true" className="expense-start__trailing">›</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
