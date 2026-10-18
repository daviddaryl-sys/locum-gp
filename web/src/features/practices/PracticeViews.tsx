"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef } from "react";

import { OfflineStorageAlert } from "@/components/runtime/OfflineStorageAlert";
import {
  emptyPracticeFormValues,
  formatPenceForInput,
  PracticeForm,
  type PracticeFormValues,
  type PracticeInput,
} from "@/features/practices/PracticeForm";
import { isDemoPracticePayload } from "@/features/demo/demoFixtures";
import { useOfflineRecord, useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord, RecordPayload } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

type PracticeData = PracticeInput;

export function parsePracticeData(payload: RecordPayload): PracticeData | null {
  const address = payload.billingAddress;
  if (
    typeof payload.name !== "string" ||
    !address ||
    typeof address !== "object" ||
    Array.isArray(address) ||
    typeof payload.defaultHourlyRatePence !== "number" ||
    typeof payload.paymentTermsDays !== "number" ||
    typeof payload.archived !== "boolean"
  ) {
    return null;
  }
  const formatted = (address as Record<string, unknown>).formatted;
  if (formatted !== undefined && typeof formatted !== "string") return null;
  return {
    name: payload.name,
    billingAddress: { formatted: formatted ?? "" },
    defaultHourlyRatePence: payload.defaultHourlyRatePence,
    paymentTermsDays: payload.paymentTermsDays,
    archived: payload.archived,
  };
}

function practiceValues(data: PracticeData): PracticeFormValues {
  return {
    name: data.name,
    billingAddress: data.billingAddress.formatted,
    hourlyRatePounds: formatPenceForInput(data.defaultHourlyRatePence),
    paymentTermsDays: String(data.paymentTermsDays),
  };
}

async function savePractice(
  repository: NonNullable<ReturnType<typeof useSync>["repository"]>,
  id: string,
  input: PracticeInput,
) {
  await repository.saveRecord("practices", id, input);
}

export function PracticeList() {
  const { initializationError } = useSync();
  const records = useOfflineRecords("practices");
  const practices = records
    ?.map((record) => ({ record, data: parsePracticeData(record.data) }))
    .filter((item): item is { record: LocalRecord; data: PracticeData } => Boolean(item.data))
    .sort((left, right) =>
      Number(left.data.archived) - Number(right.data.archived) ||
      left.data.name.localeCompare(right.data.name),
    );

  return (
    <section className="record-page" aria-labelledby="practices-title">
      <div className="record-page__header">
        <div><h1 id="practices-title">Practices</h1></div>
        <Link className="primary-action" href="/practices/new">Add practice</Link>
      </div>
      <OfflineStorageAlert initializationError={initializationError} />
      {practices?.length ? (
        <ul className="record-list">
          {practices.map(({ record, data }) => (
            <li key={record.id}>
              <Link className="record-card" href={`/practices/${record.id}`}>
                <span className="record-card__title">{data.name}</span>
                {isDemoPracticePayload(record.data) ? <span className="demo-badge">Demo</span> : null}
                <span>{formatPenceForInput(data.defaultHourlyRatePence)} per hour · {data.paymentTermsDays} day terms</span>
                {data.archived ? <span className="record-card__status">Archived</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : records ? (
        <p className="record-page__empty">No practices yet. Add your first practice to start recording sessions.</p>
      ) : null}
    </section>
  );
}

export function NewPractice() {
  const { initializationError, markSaving, ready, repository, syncNow } = useSync();
  const id = useRef<string | null>(null);

  return (
    <section className="record-page record-page--form" aria-labelledby="new-practice-title">
      <Link className="record-page__back" href="/practices">← Practices</Link>
      <p className="eyebrow">Practice details</p>
      <h1 id="new-practice-title">New practice</h1>
      <OfflineStorageAlert initializationError={initializationError} />
      <PracticeForm
        initialValues={emptyPracticeFormValues}
        onSubmit={async (input) => {
          if (!ready || !repository) throw new Error("Offline storage is not ready.");
          id.current ??= crypto.randomUUID();
          await savePractice(repository, id.current, input);
          markSaving();
          void syncNow();
        }}
      />
    </section>
  );
}

export function EditPractice() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const record = useOfflineRecord("practices", id);
  const { initializationError, markSaving, ready, repository, syncNow } = useSync();
  const data = record ? parsePracticeData(record.data) : null;

  if (record === undefined) {
    return <section className="record-page"><OfflineStorageAlert initializationError={initializationError} /></section>;
  }
  if (!record || !data) {
    return <section className="record-page"><h1>Practice not found</h1><Link href="/practices">Back to practices</Link></section>;
  }

  return (
    <section className="record-page record-page--form" aria-labelledby="edit-practice-title">
      <Link className="record-page__back" href="/practices">← Practices</Link>
      <p className="eyebrow">Practice details</p>
      <h1 id="edit-practice-title">{data.name}</h1>
      <OfflineStorageAlert initializationError={initializationError} />
      <PracticeForm
        archived={data.archived}
        initialValues={practiceValues(data)}
        onArchive={data.archived ? undefined : async () => {
          if (!ready || !repository) throw new Error("Offline storage is not ready.");
          await savePractice(repository, id, { ...data, archived: true });
          markSaving();
          void syncNow();
        }}
        onSubmit={async (input) => {
          if (!ready || !repository) throw new Error("Offline storage is not ready.");
          await savePractice(repository, id, { ...input, archived: data.archived });
          markSaving();
          void syncNow();
        }}
        submitLabel="Save changes"
      />
    </section>
  );
}
