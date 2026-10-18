import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalRecord } from "@/offline/types";
import { ExpenseCategoryManager } from "../ExpenseCategoryManager";

afterEach(cleanup);

function category(id: string, name: string, archivedAt: string | null = null) {
  return {
    ownerId: "owner-a",
    id,
    recordType: "expenseCategories",
    data: { name, archivedAt, isDemo: false },
    localRevision: 1,
    serverRevision: 1,
    syncState: "synced",
    updatedAt: "2026-08-02T12:00:00.000Z",
    deletedAt: null,
  } satisfies LocalRecord;
}

describe("ExpenseCategoryManager", () => {
  it("adds a trimmed custom category and rejects case-folded duplicates", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseCategoryManager
        records={[category("category-1", "Existing category")]}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText("New category name"), "  Locum bag  ");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    expect(onSave).toHaveBeenCalledWith(expect.any(String), {
      name: "Locum bag",
      archivedAt: null,
      isDemo: false,
    });

    await user.clear(screen.getByLabelText("New category name"));
    await user.type(screen.getByLabelText("New category name"), " existing CATEGORY ");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renames with the same ID and archives without hiding history", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseCategoryManager
        records={[
          category("category-1", "Locum bag"),
          category("category-2", "Archived travel", "2026-07-01T00:00:00.000Z"),
        ]}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("Archived travel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename Locum bag" }));
    await user.clear(screen.getByLabelText("Category name"));
    await user.type(screen.getByLabelText("Category name"), "Locum equipment");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(onSave).toHaveBeenCalledWith("category-1", {
      name: "Locum equipment",
      archivedAt: null,
      isDemo: false,
    });

    await user.click(screen.getByRole("button", { name: "Archive Locum bag" }));
    await user.click(screen.getByRole("button", { name: "Archive category" }));
    expect(onSave).toHaveBeenCalledWith("category-1", {
      name: "Locum bag",
      archivedAt: expect.any(String),
      isDemo: false,
    });
  });
});
