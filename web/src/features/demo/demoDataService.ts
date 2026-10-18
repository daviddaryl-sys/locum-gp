import {
  type OfflineRepository,
  type SaveRecordInput,
} from "@/offline/repository";
import type { LocalRecord, RecordPayload, RecordStoreName } from "@/offline/types";

import { buildDemoFixtures, demoRecordIds } from "./demoFixtures";

const DEMO_RECORD_TYPES = [
  "practices",
  "sessions",
  "invoices",
  "invoiceItems",
  "expenses",
] as const satisfies ReadonlyArray<RecordStoreName>;

function samePayload(left: RecordPayload, right: RecordPayload) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function activeRecords(
  repository: OfflineRepository,
  recordType: (typeof DEMO_RECORD_TYPES)[number],
) {
  return (await repository
    .tableFor(recordType)
    .where("ownerId")
    .equals(repository.ownerId)
    .toArray()).filter((record) => !record.deletedAt);
}

function stringField(record: LocalRecord, key: string) {
  const value = record.data[key];
  return typeof value === "string" ? value : null;
}

export async function loadDemoData(
  repository: OfflineRepository,
  referenceDate: string,
) {
  const { fixtures } = await buildDemoFixtures(repository.ownerId, referenceDate);
  const inputs: SaveRecordInput[] = [];
  for (const fixture of fixtures) {
    const existing = await repository.getRecord(fixture.recordType, fixture.id);
    if (
      existing &&
      !existing.deletedAt &&
      samePayload(existing.data, fixture.data)
    ) {
      continue;
    }
    inputs.push(fixture);
  }
  await repository.saveRecordsAtomically(inputs);
  return { recordCount: fixtures.length };
}

export async function removeDemoData(repository: OfflineRepository) {
  const ids = await demoRecordIds(repository.ownerId);
  const idSets = {
    practices: new Set(ids.practices),
    sessions: new Set(ids.sessions),
    invoices: new Set(ids.invoices),
    invoiceItems: new Set(ids.invoiceItems),
    expenses: new Set(ids.expenses),
  };
  const [practices, sessions, invoices, invoiceItems, expenses] = await Promise.all(
    DEMO_RECORD_TYPES.map((recordType) => activeRecords(repository, recordType)),
  );

  const linkedSession = sessions.some(
    (record) =>
      !idSets.sessions.has(record.id) &&
      idSets.practices.has(stringField(record, "practiceId") ?? ""),
  );
  const linkedInvoice = invoices.some((record) => {
    if (idSets.invoices.has(record.id)) return false;
    const practiceId = stringField(record, "practiceId");
    const snapshot = record.data.practiceSnapshot;
    const snapshotPracticeId =
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>).id
        : null;
    return (
      idSets.practices.has(practiceId ?? "") ||
      (typeof snapshotPracticeId === "string" &&
        idSets.practices.has(snapshotPracticeId))
    );
  });
  const linkedInvoiceItem = invoiceItems.some(
    (record) =>
      !idSets.invoiceItems.has(record.id) &&
      (idSets.invoices.has(stringField(record, "invoiceId") ?? "") ||
        idSets.sessions.has(stringField(record, "sessionId") ?? "")),
  );
  const linkedExpense = expenses.some(
    (record) =>
      !idSets.expenses.has(record.id) &&
      idSets.practices.has(stringField(record, "practiceId") ?? ""),
  );
  if (linkedSession || linkedInvoice || linkedInvoiceItem || linkedExpense) {
    throw new Error("Demo data is linked to a non-demo record.");
  }

  const byType = { practices, sessions, invoices, invoiceItems, expenses };
  const removalOrder = [
    ["expenses", ids.expenses],
    ["invoiceItems", ids.invoiceItems],
    ["invoices", ids.invoices],
    ["sessions", ids.sessions],
    ["practices", ids.practices],
  ] as const;
  const inputs: SaveRecordInput[] = [];
  for (const [recordType, recordIds] of removalOrder) {
    const records = new Map(byType[recordType].map((record) => [record.id, record]));
    for (const id of recordIds) {
      const record = records.get(id);
      if (!record) continue;
      inputs.push({
        recordType,
        id,
        data: record.data,
        operation: "delete",
      });
    }
  }
  await repository.saveRecordsAtomically(inputs);
  return { recordCount: inputs.length };
}
