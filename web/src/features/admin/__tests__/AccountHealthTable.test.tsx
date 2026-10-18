import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AccountHealthTable,
  isAdminClaims,
  sanitizeAccountHealth,
} from "@/features/admin/AccountHealthTable";

afterEach(cleanup);

describe("restricted account health", () => {
  it("requires the server-issued admin application claim", () => {
    expect(isAdminClaims({ app_metadata: { app_role: "admin" } })).toBe(true);
    expect(isAdminClaims({ app_metadata: { app_role: "user" } })).toBe(false);
    expect(isAdminClaims({ role: "admin" })).toBe(false);
  });

  it("allows only approved operational fields and strips financial data", () => {
    const result = sanitizeAccountHealth({
      account_id: "account-1",
      status: "active",
      created_at: "2026-08-01T10:00:00Z",
      last_sign_in_at: null,
      last_sync_at: "2026-08-02T09:00:00Z",
      failed_sync_count: 1,
      application_error_count: 2,
      total_pence: 99999,
      practice_name: "Private Practice",
      account_number: "12345678",
    });

    expect(Object.keys(result)).toEqual([
      "accountId",
      "status",
      "createdAt",
      "lastSignInAt",
      "lastSyncAt",
      "failedSyncCount",
      "applicationErrorCount",
    ]);
    expect(JSON.stringify(result)).not.toContain("99999");
    expect(JSON.stringify(result)).not.toContain("Private Practice");
    expect(JSON.stringify(result)).not.toContain("12345678");
  });

  it("renders only operational account health", () => {
    render(
      <AccountHealthTable
        accounts={[{
          accountId: "account-1",
          status: "active",
          createdAt: "2026-08-01T10:00:00Z",
          lastSignInAt: null,
          lastSyncAt: "2026-08-02T09:00:00Z",
          failedSyncCount: 1,
          applicationErrorCount: 2,
        }]}
      />,
    );
    expect(screen.getByText("account-1")).toBeVisible();
    expect(screen.getByText("Sync failures")).toBeVisible();
    expect(screen.queryByText(/invoice|practice|total|bank/i)).not.toBeInTheDocument();
  });
});
