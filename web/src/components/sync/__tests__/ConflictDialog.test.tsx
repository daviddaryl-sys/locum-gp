import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConflictDialog } from "../ConflictDialog";

afterEach(cleanup);

const conflict = {
  ownerId: "owner-a",
  id: "conflict-1",
  mutationId: "mutation-1",
  recordType: "practices" as const,
  recordId: "practice-1",
  localData: { name: "Local practice name" },
  serverData: { name: "Cloud practice name" },
  serverRevision: 3,
  localUpdatedAt: "2026-08-01T09:00:00.000Z",
  serverUpdatedAt: "2026-08-01T09:05:00.000Z",
  createdAt: "2026-08-01T09:06:00.000Z",
};

describe("ConflictDialog", () => {
  it("shows both versions with dates and lets the GP retain either one", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { rerender } = render(
      <ConflictDialog conflict={conflict} onResolve={onResolve} />,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName(/review sync conflict/i);
    expect(screen.getByText(/local practice name/i)).toBeInTheDocument();
    expect(screen.getByText(/cloud practice name/i)).toBeInTheDocument();
    expect(screen.getByText(/1 aug 2026, 10:00/i)).toBeInTheDocument();
    expect(screen.getByText(/1 aug 2026, 10:05/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /keep my version/i }));
    expect(onResolve).toHaveBeenCalledWith("local");

    onResolve.mockClear();
    rerender(<ConflictDialog conflict={conflict} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: /use cloud version/i }));
    expect(onResolve).toHaveBeenCalledWith("server");
  });
});
