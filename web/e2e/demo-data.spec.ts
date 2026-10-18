import { expect, test, type Page } from "@playwright/test";

import { buildDemoFixtures, type DemoFixture, type DemoFixtures } from "../src/features/demo/demoFixtures";

const OWNER = "00000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-08-02T12:15:00.000Z";

type RemoteRecord = {
  data: Record<string, unknown>;
  deletedAt: string | null;
  id: string;
  recordType: string;
  revision: number;
  updatedAt: string;
};

function toRemoteRecord(fixture: DemoFixture): RemoteRecord {
  return {
    data: fixture.data,
    deletedAt: null,
    id: fixture.id,
    recordType: fixture.recordType,
    revision: 1,
    updatedAt: UPDATED_AT,
  };
}

async function installDemoServer(page: Page, fixtures: DemoFixtures) {
  const remote = new Map<string, RemoteRecord>();
  let deleteRequests = 0;
  let demoDeleted = false;
  let demoSeedWrites = 0;
  let postRequests = 0;
  let syncRequests = 0;
  const key = (recordType: string, id: string) => `${recordType}:${id}`;

  await page.route("**/api/demo-data", async (route) => {
    if (route.request().method() === "POST") {
      postRequests += 1;
      if (!demoDeleted && demoSeedWrites === 0) {
        for (const fixture of fixtures.fixtures) {
          const record = toRemoteRecord(fixture);
          remote.set(key(record.recordType, record.id), record);
        }
        demoSeedWrites += 1;
      }
      const demoRecordCount = [...remote.values()].filter(
        (record) => record.data.isDemo === true && record.deletedAt === null,
      ).length;
      await route.fulfill({
        body: JSON.stringify({ demoRecordCount, seeded: demoSeedWrites === 1 && postRequests === 1, seedVersion: 1 }),
        contentType: "application/json",
      });
      return;
    }

    deleteRequests += 1;
    demoDeleted = true;
    for (const [recordKey, record] of remote) {
      if (record.data.isDemo !== true || record.deletedAt !== null) continue;
      remote.set(recordKey, {
        ...record,
        deletedAt: UPDATED_AT,
        revision: record.revision + 1,
        updatedAt: UPDATED_AT,
      });
    }
    await route.fulfill({ status: 204 });
  });

  await page.route("**/api/sync", async (route) => {
    syncRequests += 1;
    const request = route.request().postDataJSON() as {
      mutations: Array<{
        idempotencyKey: string;
        operation: "delete" | "upsert";
        payload: Record<string, unknown>;
        recordId: string;
        recordType: string;
      }>;
    };
    const applied = request.mutations.map((mutation) => {
      const previous = remote.get(key(mutation.recordType, mutation.recordId));
      const next: RemoteRecord = {
        data: mutation.payload,
        deletedAt: mutation.operation === "delete" ? UPDATED_AT : null,
        id: mutation.recordId,
        recordType: mutation.recordType,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: UPDATED_AT,
      };
      remote.set(key(mutation.recordType, mutation.recordId), next);
      return {
        data: next.data,
        mutationId: mutation.idempotencyKey,
        recordId: next.id,
        recordType: next.recordType,
        serverRevision: next.revision,
        updatedAt: next.updatedAt,
      };
    });
    await route.fulfill({
      body: JSON.stringify({
        applied,
        conflicts: [],
        nextCursor: null,
        pulled: [...remote.values()].map((record) => ({
          data: record.data,
          deletedAt: record.deletedAt,
          recordId: record.id,
          recordType: record.recordType,
          serverRevision: record.revision,
          updatedAt: record.updatedAt,
        })),
      }),
      contentType: "application/json",
    });
  });

  return {
    activeDemoRecords: () => [...remote.values()].filter((record) => record.data.isDemo === true && record.deletedAt === null).length,
    deleteRequests: () => deleteRequests,
    demoSeedWrites: () => demoSeedWrites,
    postRequests: () => postRequests,
    realExpenseExists: (supplierDescription: string) => [...remote.values()].some((record) => record.recordType === "expenses" && record.data.isDemo === false && record.data.supplierDescription === supplierDescription && record.deletedAt === null),
    syncRequests: () => syncRequests,
  };
}

test("seeds once, preserves a UI-created real expense on cleanup, and never reseeds", async ({ page }) => {
  test.slow();
  const fixtures = await buildDemoFixtures(OWNER, "2026-08-02");
  const demoExpense = fixtures.fixtures.find((fixture) => fixture.recordType === "expenses")!;
  const server = await installDemoServer(page, fixtures);
  const realSupplier = "My new real expense";
  const demoExpenseCard = page.getByRole("article").filter({
    has: page.locator(`a[href="/expenses/${demoExpense.id}"]`),
  });

  await page.addInitScript(() => {
    localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
  await page.goto("/expenses");

  await expect(page.getByText("Demo Mode")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete all demo data" }),
  ).toHaveCount(0);
  await expect(demoExpenseCard).toHaveCount(1);
  await expect(demoExpenseCard.getByRole("link", { name: "Open expense: Sample expense", exact: true })).toBeVisible();
  await expect.poll(server.demoSeedWrites).toBe(1);
  await expect.poll(server.syncRequests).toBeGreaterThanOrEqual(2);

  await page.reload();
  await expect(demoExpenseCard).toHaveCount(1);
  await expect(demoExpenseCard.getByRole("link", { name: "Open expense: Sample expense", exact: true })).toBeVisible();
  await expect.poll(server.postRequests).toBeGreaterThanOrEqual(2);
  expect(server.demoSeedWrites()).toBe(1);

  await page.goto("/expenses/new");
  await page.getByLabel("GP", { exact: true }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("link", { name: "Enter manually" }).click();
  await page.getByLabel("When did you buy it?", { exact: true }).fill("2026-08-02");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("18.00");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption("professional_indemnity");
  await page.getByLabel("What did you buy?").fill(realSupplier);
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByText(realSupplier, { exact: true })).toBeVisible();
  await expect.poll(() => server.realExpenseExists(realSupplier)).toBe(true);

  await page.goto("/more");
  await expect(page.getByText("Demo Mode")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete all demo data" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Demo data" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove demo data" }).click();
  await expect(
    page.getByText("Demo data removed. Your own records were not changed.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.deleteRequests()).toBe(0);
  await expect.poll(server.activeDemoRecords).toBe(0);

  await page.goto("/expenses");
  await expect(demoExpenseCard).toHaveCount(0);
  await expect(page.getByText(realSupplier, { exact: true })).toBeVisible();
  expect(server.activeDemoRecords()).toBe(0);

  await page.reload();
  await expect(page.getByText("Demo Mode")).toHaveCount(0);
  await expect(page.getByText(realSupplier, { exact: true })).toBeVisible();
  await expect.poll(server.postRequests).toBeGreaterThanOrEqual(3);
  expect(server.demoSeedWrites()).toBe(1);
  expect(server.activeDemoRecords()).toBe(0);
});
