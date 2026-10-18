import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredConflict } from "@/offline/types";
import type { SyncStatus } from "@/sync/client";
import { AppShell } from "../AppShell";

const syncState = vi.hoisted(() => ({
  conflicts: [] as StoredConflict[],
  ready: true,
  resolveConflict: vi.fn(),
  status: "saving" as SyncStatus,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/components/navigation/AppNavigation", () => ({
  AppNavigation: () => <nav aria-label="Primary navigation" />,
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => syncState,
}));

describe("AppShell", () => {
  beforeEach(() => {
    syncState.conflicts = [];
    syncState.ready = true;
    syncState.resolveConflict.mockReset();
    syncState.status = "saving";
  });

  it("keeps the mobile brand without account or routine sync labels", () => {
    render(<AppShell><div>Content</div></AppShell>);

    expect(screen.getByRole("link", { name: "Locum Manager" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByText("Private account")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving changes")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-runtime-ready", "true");
  });

  it("never renders a global sync status, including offline and action states", () => {
    syncState.status = "offline";
    const { rerender } = render(<AppShell><div>Content</div></AppShell>);

    expect(
      screen.queryByText("Offline — changes stay on this device"),
    ).not.toBeInTheDocument();

    syncState.status = "action-required";
    rerender(<AppShell><div>Content</div></AppShell>);
    expect(screen.queryByText("Action required")).not.toBeInTheDocument();
  });

  it("keeps the conflict safety dialog available", () => {
    syncState.conflicts = [{
      ownerId: "fictional-owner",
      id: "fictional-conflict",
      mutationId: "fictional-mutation",
      recordType: "practices",
      recordId: "fictional-practice",
      localData: { name: "Local fictional practice" },
      serverData: { name: "Cloud fictional practice" },
      serverRevision: 2,
      localUpdatedAt: "2026-08-01T09:00:00.000Z",
      serverUpdatedAt: "2026-08-01T09:05:00.000Z",
      createdAt: "2026-08-01T09:06:00.000Z",
    }];

    render(<AppShell><div>Content</div></AppShell>);

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Review sync conflict");
  });
});
