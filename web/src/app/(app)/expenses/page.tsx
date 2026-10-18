"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { parseExpenseCategoryData, parseExpenseData } from "@/domain/expense";
import { ExpenseList } from "@/features/expenses/ExpenseList";
import { useOfflineRecords } from "@/offline/useRecords";
import { useSync } from "@/sync/SyncProvider";

export default function ExpensesPage() {
  const expenseRecords = useOfflineRecords("expenses") ?? [];
  const categoryRecords = useOfflineRecords("expenseCategories") ?? [];
  const practiceRecords = useOfflineRecords("practices") ?? [];
  const { repository } = useSync();
  const receiptQueue = useLiveQuery(async () => repository ? repository.pendingReceiptOperations() : [], [repository]) ?? [];
  return <ExpenseList
    categories={categoryRecords.flatMap((record) => { const data = parseExpenseCategoryData(record.data); return data ? [{ id: record.id, name: data.name }] : []; })}
    expenses={expenseRecords.flatMap((record) => { const data = parseExpenseData(record.data); return data ? [{ id: record.id, data }] : []; })}
    practices={practiceRecords.flatMap((record) => typeof record.data.name === "string" ? [{ id: record.id, name: record.data.name }] : [])}
    receiptQueue={receiptQueue.map((entry) => ({ expenseId: entry.expenseId, state: entry.state }))}
  />;
}
