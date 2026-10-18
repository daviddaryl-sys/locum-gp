import { expect, test, type Page } from "@playwright/test";

const OWNER = "00000000-0000-4000-8000-000000000001";

async function waitForDatabase(page: Page) {
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open("locum-manager");
    open.onsuccess = () => {
      const ready = open.result.objectStoreNames.contains("expenses") && open.result.objectStoreNames.contains("invoices");
      open.result.close();
      resolve(ready);
    };
    open.onerror = () => resolve(false);
  }))).toBe(true);
}

async function seedBookkeeping(page: Page) {
  await page.evaluate(({ ownerId }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("locum-manager");
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(["expenses", "invoices"], "readwrite");
      const record = (id: string, recordType: "expenses" | "invoices", data: Record<string, unknown>) => ({
        data, deletedAt: null, id, localRevision: 1, ownerId, recordType,
        serverRevision: 1, syncState: "synced", updatedAt: "2026-08-04T09:00:00.000Z",
      });
      transaction.objectStore("invoices").put(record("mtd-invoice", "invoices", {
        artifactPath: null, dueDate: "2026-07-30", invoiceNumber: "INV-MTD-001",
        issueDate: "2026-07-01", issuedAt: "2026-07-01T09:00:00.000Z",
        paidAt: "2026-07-20", paymentSnapshot: null, practiceId: "practice-1",
        practiceSnapshot: { name: "Example Practice" }, status: "paid", totalPence: 48000,
      }));
      transaction.objectStore("expenses").put(record("mtd-expense", "expenses", {
        allowablePercentage: 75, amountPence: 10000, categoryKey: "mileage_business_travel",
        customCategoryId: null, expenseDate: "2026-07-21", isDemo: false,
        mtdCategory: "travel_costs", needsAccountantReview: false, notes: null,
        practiceId: null, receiptMimeType: null, receiptObjectKey: null,
        receiptOriginalName: null, receiptSizeBytes: null, receiptSyncStatus: "none",
        reimbursedByPractice: false, supplierDescription: "Business travel",
      }));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    open.onerror = () => reject(open.error);
  }), { ownerId: OWNER });
}

test("reviews MTD-ready records without claiming an HMRC submission", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await waitForDatabase(page);
  await seedBookkeeping(page);
  await page.reload();

  const workTools = page.getByRole("region", { name: "Manage your work" });
  await expect(workTools.getByRole("link")).toHaveCount(4);
  const taxLink = workTools.getByRole("link", { name: "Tax & MTD", exact: true });
  await expect(taxLink).toHaveAttribute("href", "/tax-mtd");
  await taxLink.click();
  await expect(page.getByRole("heading", { name: "Tax & MTD" })).toBeVisible();
  await page.getByLabel("Cumulative update period").selectOption("quarter-2");
  await expect(page.getByText("£480.00")).toBeVisible();
  await expect(page.getByText("£75.00").first()).toBeVisible();
  await expect(page.getByText("£405.00")).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(page.getByText("Not submitted to HMRC.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Use this export/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download accountant JSON" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download accountant CSV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /submit.*hmrc/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
});
