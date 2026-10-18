"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import {
  mergeProfession,
  PROFESSIONS,
  readProfession,
  type Profession,
} from "@/domain/profession";
import { useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

function ProfessionPreferenceEditor({
  settingRecords,
}: {
  settingRecords: LocalRecord[];
}) {
  const { markSaving, ready, repository, syncNow } = useSync();
  const persistedProfession = readProfession(settingRecords[0]?.data);
  const [profession, setProfession] = useState<Profession | null>(() =>
    persistedProfession,
  );
  const locallyEdited = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!locallyEdited.current) setProfession(persistedProfession);
  }, [persistedProfession]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!profession) return;
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
        (current) => mergeProfession(current?.data ?? {}, profession),
      );
      locallyEdited.current = false;
      markSaving();
      void syncNow();
      setMessage("Profession saved.");
    } catch {
      setFailed(true);
      setMessage("Profession could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Profession</legend>
        <p>Choose once so expense categories match your locum work.</p>
        {PROFESSIONS.map((option) => (
          <label key={option.value}>
            <input
              checked={profession === option.value}
              name="profession"
              onChange={() => {
                locallyEdited.current = true;
                setProfession(option.value);
                setMessage("");
                setFailed(false);
              }}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {message ? (
        <p
          className={failed ? "record-form__error" : "record-form__success"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
      <Button disabled={!profession} loading={busy} type="submit">
        Save profession
      </Button>
    </form>
  );
}

export function ProfessionPreference() {
  const settingRecords = useOfflineRecords("settings");
  if (settingRecords === undefined) {
    return <p role="status">Preparing profession settings</p>;
  }
  return <ProfessionPreferenceEditor settingRecords={settingRecords} />;
}
