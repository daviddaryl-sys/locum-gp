import { expect, test } from "@playwright/test";

test("denies the non-admin acceptance shell without returning private fields", async ({ request }) => {
  const response = await request.get("/api/admin/accounts");
  expect(response.status()).toBe(403);
  const body = await response.text();
  expect(body).not.toMatch(/total_pence|payment_snapshot|practice_name|account_number/i);
});

test("returns only approved operational fields for the gated admin fixture", async ({ request }) => {
  const response = await request.get("/api/admin/accounts", {
    headers: { "x-locum-e2e-admin": "account-health" },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.accounts).toEqual([
    {
      accountId: "00000000-0000-4000-8000-0000000000aa",
      status: "active",
      createdAt: "2026-08-01T09:00:00.000Z",
      lastSignInAt: null,
      lastSyncAt: null,
      failedSyncCount: 0,
      applicationErrorCount: 0,
    },
  ]);
  expect(JSON.stringify(body)).not.toMatch(/invoice|practice|total|bank|payment/i);
});
