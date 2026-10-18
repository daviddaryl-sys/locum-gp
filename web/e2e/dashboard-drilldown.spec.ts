import { expect, test, type Page } from "@playwright/test";

const ownerId = "00000000-0000-4000-8000-000000000001";

async function seedDrilldownRecords(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Next session/ })).toBeVisible();
  await page.evaluate(async ({ ownerId }) => {
    const request = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const today = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit", month: "2-digit", timeZone: "Europe/London", year: "numeric",
    }).format(new Date());
    const year = today.slice(0, 4);
    const record = (id: string, recordType: string, data: Record<string, unknown>) => ({
      data, deletedAt: null, id, localRevision: 1, ownerId, recordType,
      serverRevision: 1, syncState: "synced", updatedAt: "2026-08-02T12:00:00.000Z",
    });
    const practice = {
      archived: false, billingAddress: { formatted: "Demo address" }, defaultHourlyRatePence: 6500,
      isDemo: true, name: "Demo Drilldown Practice", paymentTermsDays: 30,
    };
    const invoice = (status: string, number: string, dueDate: string, totalPence: number) => ({
      artifactPath: null, dueDate, invoiceNumber: number, issueDate: status === "paid" ? `${Number(year) - 1}-12-20` : `${year}-07-01`,
      issuedAt: "2026-08-02T12:00:00.000Z", paymentSnapshot: null,
      practiceId: "practice-drilldown", practiceSnapshot: { name: "Demo Drilldown Practice" },
      status, totalPence, paidAt: status === "paid" ? today : null,
    });
    const values: Array<[string, ReturnType<typeof record>[]]> = [
      ["practices", [record("practice-drilldown", "practices", practice)]],
      ["invoices", [
        record("invoice-paid", "invoices", invoice("paid", "DEMO-PAID", `${year}-12-31`, 10000)),
        record("invoice-overdue", "invoices", invoice("sent", "DEMO-OVERDUE", "2020-01-01", 20000)),
        record("invoice-draft", "invoices", invoice("draft", "DEMO-DRAFT", `${year}-12-31`, 30000)),
      ]],
      ["sessions", [
        record("session-ready", "sessions", { practiceId: "practice-drilldown", startsAt: "2020-01-01T09:00:00.000Z", endsAt: "2020-01-01T13:00:00.000Z", hourlyRatePence: 6500, notes: "Demo ready", status: "completed" }),
        record("session-next", "sessions", { practiceId: "practice-drilldown", startsAt: "2099-01-01T09:00:00.000Z", endsAt: "2099-01-01T13:00:00.000Z", hourlyRatePence: 6500, notes: "Demo upcoming", status: "planned" }),
      ]],
      ["expenses", [record("expense-tax-year", "expenses", {
        amountPence: 4500, categoryKey: "professional_training", customCategoryId: null,
        expenseDate: today, isDemo: true, needsAccountantReview: false, notes: "Demo expense",
        practiceId: null, receiptMimeType: null, receiptObjectKey: null,
        receiptOriginalName: null, receiptSizeBytes: null, receiptSyncStatus: "none",
        reimbursedByPractice: false, supplierDescription: "Demo dashboard expense",
      })]],
    ];
    for (const [storeName, records] of values) {
      const transaction = database.transaction(storeName, "readwrite");
      for (const value of records) transaction.objectStore(storeName).put(value);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
    database.close();
  }, { ownerId });
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

async function openFinancialCard(page: Page, label: RegExp, href: string) {
  await page.goto("/dashboard");
  const link = page.getByRole("link", { name: label });
  await expect(link).toHaveAttribute("href", href);
  await link.click();
}

test("shows the mobile work tools and opens each destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Manage your work" })).toBeVisible();

  const expenses = page.getByRole("link", { name: "Expenses", exact: true });
  const taxMtd = page.getByRole("link", { name: "Tax & MTD", exact: true });
  const addSession = page.getByRole("link", { name: "Add session", exact: true });
  for (const [link, icon] of [
    [expenses, "expenses"],
    [taxMtd, "tax-mtd"],
    [addSession, "session"],
  ] as const) {
    await expect(link).toBeVisible();
    await expect(link.locator(`svg[data-icon="${icon}"]`)).toBeVisible();
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(72);

    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "4px");
  }

  await expenses.click();
  await expect(page).toHaveURL(/\/expenses$/);

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Tax & MTD", exact: true }).click();
  await expect(page).toHaveURL(/\/tax-mtd$/);

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Add session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/new$/);
});

test("Home financial cards open their matching URL-filtered records", async ({ page }) => {
  test.slow();
  await seedDrilldownRecords(page);

  for (const label of [
    /Paid this year/,
    /Outstanding/,
    /Overdue/,
    /Draft invoices/,
    /Ready to invoice/,
    /Expenses this tax year/,
  ]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Next session/ })).toBeVisible();

  await openFinancialCard(
    page,
    /Paid this year/,
    "/invoices?status=paid&period=payment-year",
  );
  await expect(page.getByText("DEMO-PAID")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("paid");
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("payment-year");

  await openFinancialCard(page, /Outstanding/, "/invoices?status=sent");
  await expect(page.getByText("DEMO-OVERDUE")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("sent");

  await openFinancialCard(page, /Overdue/, "/invoices?status=overdue");
  await expect(page.getByText("DEMO-OVERDUE")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("overdue");

  await openFinancialCard(page, /Draft invoices/, "/invoices?status=draft");
  await expect(page.getByText("DEMO-DRAFT")).toBeVisible();

  await openFinancialCard(
    page,
    /Ready to invoice/,
    "/sessions?status=ready-to-invoice",
  );
  await expect(page.getByText("Demo Drilldown Practice")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("ready-to-invoice");

  await openFinancialCard(
    page,
    /Expenses this tax year/,
    "/expenses?period=tax-year",
  );
  await expect(page.getByRole("link", { name: "Open expense: Sample expense" })).toHaveAttribute("href", "/expenses/expense-tax-year");
  await expect(page.getByLabel("Tax period")).toHaveValue("tax-year");

  await page.goto("/dashboard");
  const nextSession = page.getByRole("link", { name: /Next session/ });
  await expect(nextSession).toHaveAttribute("href", "/sessions/session-next");
  await page.goto("/sessions/session-next");
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();
});

test("adds an explicitly chosen received date to an older paid invoice and updates Home", async ({ page }) => {
  await seedDrilldownRecords(page);
  await page.evaluate(async ({ ownerId }) => {
    const request = indexedDB.open("locum-manager");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction("invoices", "readwrite");
    const table = transaction.objectStore("invoices");
    const lookup = table.get([ownerId, "invoice-paid"]);
    lookup.onsuccess = () => table.put({ ...lookup.result, data: { ...lookup.result.data, paidAt: null } });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { ownerId });
  await page.reload();
  await expect(page.getByRole("link", { name: "Paid this year: £0.00", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Check payment dates/ }).click();
  await page.getByRole("link", { name: /DEMO-PAID/ }).click();
  const receivedDate = page.getByLabel("Payment received date", { exact: true });
  await expect(receivedDate).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save payment date", exact: true })).toBeDisabled();
  await receivedDate.fill((await receivedDate.getAttribute("max"))!);
  await page.getByRole("button", { name: "Save payment date", exact: true }).click();
  await expect(page.getByText("Payment date saved on this device.", { exact: true })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Paid this year: £100.00", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Check payment dates/ })).toHaveCount(0);
});
