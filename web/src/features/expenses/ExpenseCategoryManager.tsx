"use client";

import { useMemo, useRef, useState } from "react";

import { PREDEFINED_EXPENSE_CATEGORIES, parseExpenseCategoryData } from "@/domain/expense";
import { useOfflineRecords } from "@/offline/useRecords";
import type { LocalRecord } from "@/offline/types";
import { useSync } from "@/sync/SyncProvider";

export type CategorySave = (
  id: string,
  data: { name: string; archivedAt: string | null; isDemo: boolean },
) => Promise<void>;

export function ExpenseCategoryManager({ records, onSave }: {
  records: LocalRecord[];
  onSave: CategorySave;
}) {
  const categories = useMemo(() => records.flatMap((record) => {
    const data = parseExpenseCategoryData(record.data);
    return data && !record.deletedAt ? [{ id: record.id, data }] : [];
  }), [records]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | { mode: "rename" | "archive"; id: string; name: string; isDemo: boolean }>(null);
  const [renameName, setRenameName] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);

  const duplicate = (name: string, exceptId?: string) => categories.some(({ id, data }) =>
    id !== exceptId && !data.archivedAt && data.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  const close = () => {
    setDialog(null);
    queueMicrotask(() => opener.current?.focus());
  };

  return (
    <section className="expense-categories" aria-labelledby="expense-categories-title">
      <h1 id="expense-categories-title">Expense categories</h1>
      <p>Categories organise records only and do not confirm tax deductibility.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const name = newName.trim();
        if (!name) return setError("Enter a category name.");
        if (duplicate(name)) return setError("That category already exists.");
        setError("");
        await onSave(crypto.randomUUID(), { name, archivedAt: null, isDemo: false });
        setNewName("");
      }}>
        <label>New category name<input maxLength={80} onChange={(event) => setNewName(event.target.value)} value={newName} /></label>
        <button type="submit">Add category</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}

      <h2>Custom categories</h2>
      <ul className="expense-categories__list">
        {categories.map(({ id, data }) => (
          <li data-archived={data.archivedAt ? "true" : undefined} key={id}>
            <span>{data.name}</span>{data.archivedAt ? <span>Archived</span> : (
              <span className="expense-categories__actions">
                <button aria-label={`Rename ${data.name}`} onClick={(event) => {
                  opener.current = event.currentTarget;
                  setRenameName(data.name);
                  setDialog({ mode: "rename", id, name: data.name, isDemo: data.isDemo });
                }} type="button">Rename</button>
                <button aria-label={`Archive ${data.name}`} onClick={(event) => {
                  opener.current = event.currentTarget;
                  setDialog({ mode: "archive", id, name: data.name, isDemo: data.isDemo });
                }} type="button">Archive</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <h2>Built-in suggestions</h2>
      {(["practice", "general"] as const).map((group) => (
        <div key={group}><h3>{group === "practice" ? "Practice-linked" : "General"}</h3><ul>
          {PREDEFINED_EXPENSE_CATEGORIES.filter((item) => item.group === group).map((item) => <li key={item.key}>{item.label}</li>)}
        </ul></div>
      ))}

      {dialog ? <dialog aria-labelledby="category-dialog-title" open>
        <h2 id="category-dialog-title">{dialog.mode === "rename" ? `Rename ${dialog.name}` : `Archive ${dialog.name}?`}</h2>
        {dialog.mode === "rename" ? <label>Category name<input autoFocus maxLength={80} onChange={(event) => setRenameName(event.target.value)} value={renameName} /></label> : <p>Existing expenses will keep this category name.</p>}
        <button onClick={close} type="button">Cancel</button>
        <button onClick={async () => {
          if (dialog.mode === "rename") {
            const name = renameName.trim();
            if (!name || duplicate(name, dialog.id)) return setError("That category already exists.");
            await onSave(dialog.id, { name, archivedAt: null, isDemo: dialog.isDemo });
          } else {
            await onSave(dialog.id, { name: dialog.name, archivedAt: new Date().toISOString(), isDemo: dialog.isDemo });
          }
          close();
        }} type="button">{dialog.mode === "rename" ? "Save name" : "Archive category"}</button>
      </dialog> : null}
    </section>
  );
}

export function ExpenseCategoryWorkspace() {
  const records = useOfflineRecords("expenseCategories");
  const { markSaving, repository, syncNow } = useSync();
  if (!records || !repository) return <p role="status">Preparing expense categories</p>;
  return <ExpenseCategoryManager records={records} onSave={async (id, data) => {
    await repository.saveRecord("expenseCategories", id, data);
    markSaving();
    void syncNow();
  }} />;
}
