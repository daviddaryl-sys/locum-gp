import { expect, test } from "@playwright/test";

const OWNER_A = "00000000-0000-4000-8000-00000000000a";
const OWNER_B = "00000000-0000-4000-8000-00000000000b";

async function waitForInitializedRuntime(page: import("@playwright/test").Page) {
  await expect(page.getByRole("main")).toHaveAttribute("data-runtime-ready", "true");
}

test("clears the local business cache before switching authenticated owners", async ({ context, page }) => {
  await page.addInitScript(() => localStorage.setItem("locum-manager:install-guide-dismissed", "true"));
  await page.setExtraHTTPHeaders({
    "x-locum-e2e-auth": "responsive-shell",
    "x-locum-e2e-owner": OWNER_A,
  });
  await page.goto("/practices/new");
  await waitForInitializedRuntime(page);
  await context.setOffline(true);
  await page.getByLabel("Practice name").fill("Owner A Private Practice");
  await page.getByLabel("Billing address").fill("1 Fiction Road");
  await page.getByLabel("Default hourly rate").fill("60.00");
  await page.getByLabel("Payment terms").fill("30");
  await page.getByRole("button", { name: "Save practice" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();
  await context.setOffline(false);

  await page.setExtraHTTPHeaders({
    "x-locum-e2e-auth": "responsive-shell",
    "x-locum-e2e-owner": OWNER_B,
  });
  await page.goto("/practices");
  await expect(page.getByText(/No practices yet/)).toBeVisible();
  await expect(page.getByText("Owner A Private Practice")).toHaveCount(0);
});

test("does not expose owner A's receipt, mileage fields, or signed receipt action to owner B", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("locum-manager:install-guide-dismissed", "true"));
  await page.setExtraHTTPHeaders({
    "x-locum-e2e-auth": "responsive-shell",
    "x-locum-e2e-owner": OWNER_A,
  });
  await page.goto("/expenses");
  await waitForInitializedRuntime(page);
  await page.evaluate(({ ownerId }) => {
    const open = indexedDB.open("locum-manager");
    return new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction("expenses", "readwrite");
        transaction.objectStore("expenses").put({
          data: {
            expenseKind: "mileage", journeyOrigin: "Owner A private origin",
            journeyDestination: "Owner A private destination", distanceMiles: 20,
            mileageRatePence: 55, linkedSessionId: null,
            amountPence: 1100, categoryKey: "mileage_business_travel", customCategoryId: null,
            expenseDate: "2026-08-02", isDemo: false, needsAccountantReview: false,
            mtdCategory: "travel_costs", allowablePercentage: 100,
            notes: null, practiceId: null, receiptMimeType: "application/pdf",
            receiptObjectKey: `${ownerId}/owner-a-receipt/receipt.pdf`,
            receiptOriginalName: "receipt.pdf", receiptSizeBytes: 10,
            receiptSyncStatus: "uploaded", reimbursedByPractice: false,
            supplierDescription: "Owner A private mileage receipt",
          },
          deletedAt: null, id: "owner-a-receipt", localRevision: 1, ownerId,
          recordType: "expenses", serverRevision: 1, syncState: "synced",
          updatedAt: "2026-08-02T12:00:00.000Z",
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, { ownerId: OWNER_A });
  await page.reload();
  await expect(page.getByText("Owner A private mileage receipt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open receipt for Owner A private mileage receipt", exact: true })).toBeVisible();

  await page.setExtraHTTPHeaders({
    "x-locum-e2e-auth": "responsive-shell",
    "x-locum-e2e-owner": OWNER_B,
  });
  await page.goto("/expenses");
  await waitForInitializedRuntime(page);
  await expect(page.getByText("Owner A private mileage receipt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open receipt for Owner A private mileage receipt", exact: true })).toHaveCount(0);
  const ownerBCache = await page.evaluate(async () => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const request = database.transaction("expenses", "readonly").objectStore("expenses").getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return JSON.stringify(rows);
  });
  expect(ownerBCache).not.toContain("Owner A private origin");
  expect(ownerBCache).not.toContain("Owner A private destination");
  expect(ownerBCache).not.toContain("Owner A private mileage receipt");
});
