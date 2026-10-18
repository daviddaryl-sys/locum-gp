import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const OWNER = "00000000-0000-4000-8000-000000000001";

async function waitForDatabase(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open("locum-manager");
            open.onsuccess = () => {
              const ready = open.result.objectStoreNames.contains("expenses");
              open.result.close();
              resolve(ready);
            };
            open.onerror = () => resolve(false);
          }),
      ),
    )
    .toBe(true);
}

const activeExpenseForm = (page: Page) => page.locator("form.expense-form:visible");

async function expectAttachedReceipt(page: Page, filename: string) {
  const form = activeExpenseForm(page);
  const receiptRow = form.locator(".expense-form__receipt-row");

  await expect(form).toHaveCount(1);
  await expect(receiptRow).toHaveCount(1);
  await expect(receiptRow.getByText("Receipt attached", { exact: true })).toBeVisible();
  await expect(receiptRow.locator(".expense-form__receipt-name")).toHaveText(filename);
}

async function focusWithKeyboard(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard focus did not reach the expected expense-card action");
}

async function visualState(target: Locator) {
  return target.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      backgroundColor: styles.backgroundColor,
      outlineOffset: styles.outlineOffset,
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
    };
  });
}

async function pressedVisualState(page: Page, target: Locator, observed: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Expense-card action has no browser geometry");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const state = await visualState(observed);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  return state;
}

async function ensureGpProfession(page: Page) {
  await page.goto("/expenses/new");
  await waitForDatabase(page);
  if (await page.getByRole("heading", { name: "Choose your profession" }).isVisible()) {
    await page.getByLabel("GP", { exact: true }).check();
    await page.getByRole("button", { name: "Save and continue" }).click();
  }
  await page.getByRole("link", { name: "Add it myself" }).click();
  await expect(page.getByLabel("When did you buy it?", { exact: true })).toBeVisible();
}

async function seedExpenseRows(page: Page) {
  await page.evaluate(({ ownerId }) => {
    const open = indexedDB.open("locum-manager");
    return new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction("expenses", "readwrite");
        const record = (id: string, data: Record<string, unknown>) => ({
          data,
          deletedAt: null,
          id,
          localRevision: 1,
          ownerId,
          recordType: "expenses",
          serverRevision: 1,
          syncState: "synced",
          updatedAt: "2026-08-02T12:00:00.000Z",
        });
        transaction.objectStore("expenses").put(record("opening-april", {
          amountPence: 1000, categoryKey: "home_office", customCategoryId: null,
          expenseDate: "2026-04-06", isDemo: false, needsAccountantReview: false,
          notes: null, practiceId: null, receiptMimeType: null, receiptObjectKey: null,
          receiptOriginalName: null, receiptSizeBytes: null, receiptSyncStatus: "none",
          reimbursedByPractice: false, supplierDescription: "6 April expense",
        }));
        transaction.objectStore("expenses").put(record("closing-april", {
          amountPence: 2000, categoryKey: "professional_training", customCategoryId: null,
          expenseDate: "2027-04-05", isDemo: false, needsAccountantReview: false,
          notes: null, practiceId: null, receiptMimeType: null, receiptObjectKey: null,
          receiptOriginalName: null, receiptSizeBytes: null, receiptSyncStatus: "none",
          reimbursedByPractice: true, supplierDescription: "5 April expense",
        }));
        transaction.objectStore("expenses").put(record("compact-card", {
          allowablePercentage: 100,
          amountPence: 123456,
          categoryKey: "accountancy_legal_bank_fees",
          customCategoryId: null,
          distanceMiles: null,
          expenseDate: "2027-04-04",
          expenseKind: "standard",
          isDemo: false,
          journeyDestination: null,
          journeyOrigin: null,
          linkedSessionId: null,
          mileageRatePence: null,
          mtdCategory: "professional_fees",
          needsAccountantReview: true,
          notes: "Fictional annual bookkeeping software and professional support subscription with intentionally long explanatory text",
          practiceId: null,
          receiptMimeType: "application/pdf",
          receiptObjectKey: "fictional-owner/fictional-expense/fictional-receipt.pdf",
          receiptOriginalName: "fictional-receipt.pdf",
          receiptSizeBytes: 128,
          receiptSyncStatus: "uploaded",
          reimbursedByPractice: false,
          supplierDescription: "Fictional bookkeeping and professional support subscription with an intentionally long supplier title",
        }));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, { ownerId: OWNER });
}

type LocalExpenseApiCalls = {
  calendar: number;
  demo: number;
  sync: number;
};

async function installLocalExpenseApi(page: Page, expectedCalls: LocalExpenseApiCalls) {
  const calls: LocalExpenseApiCalls = { calendar: 0, demo: 0, sync: 0 };
  const failures: string[] = [];

  const reject = async (route: Route, message: string) => {
    failures.push(message);
    await route.abort("failed");
  };

  await page.route("**/api/demo-data", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.demo += 1;
    if (
      request.method() !== "POST" ||
      url.pathname !== "/api/demo-data" ||
      url.search !== "" ||
      request.postData() !== null ||
      calls.demo > expectedCalls.demo
    ) {
      await reject(route, `Unexpected demo-data request ${request.method()} ${url.pathname}${url.search}`);
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ demoRecordCount: 0, seeded: false }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/sync", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    calls.sync += 1;
    const keys = body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body).sort()
      : [];
    const syncBody = body as { cursor?: unknown; mutations?: unknown } | null;
    if (
      request.method() !== "POST" ||
      url.pathname !== "/api/sync" ||
      url.search !== "" ||
      JSON.stringify(keys) !== JSON.stringify(["cursor", "mutations"]) ||
      syncBody?.cursor !== null ||
      !Array.isArray(syncBody?.mutations) ||
      syncBody.mutations.length !== 0 ||
      calls.sync > expectedCalls.sync
    ) {
      await reject(route, `Unexpected sync request ${request.method()} ${url.pathname}${url.search}`);
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ applied: [], conflicts: [], nextCursor: null, pulled: [] }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/google-calendar/sync", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.calendar += 1;
    if (
      request.method() !== "POST" ||
      url.pathname !== "/api/google-calendar/sync" ||
      url.search !== "" ||
      request.postData() !== null ||
      calls.calendar > expectedCalls.calendar
    ) {
      await reject(route, `Unexpected calendar request ${request.method()} ${url.pathname}${url.search}`);
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ state: "disabled", pendingCount: 0, lastSyncAt: null, nextRetryAt: null }),
      contentType: "application/json",
    });
  });

  return {
    assertExpectedCalls() {
      expect(failures).toEqual([]);
      expect(calls).toEqual(expectedCalls);
    },
  };
}

async function installReceiptServer(page: Page) {
  const expenses = new Map<string, { data: Record<string, unknown>; revision: number }>();
  let uploadCalls = 0;
  let networkAvailable = true;
  let releaseRetry = () => {};
  let retryStarted = false;
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });

  const rejectWhenOffline = async (route: Route) => {
    if (networkAvailable) return false;
    await route.abort("internetdisconnected");
    return true;
  };
  await page.route("**/api/demo-data", async (route) => {
    if (await rejectWhenOffline(route)) return;
    await route.fulfill({
      body: JSON.stringify({ demoRecordCount: 0, seeded: false }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/sync", async (route) => {
    if (await rejectWhenOffline(route)) return;
    const request = route.request().postDataJSON() as {
      mutations: Array<{
        idempotencyKey: string;
        localRevision: number;
        payload: Record<string, unknown>;
        recordId: string;
        recordType: string;
      }>;
    };
    const applied = request.mutations.map((mutation) => {
      const next = {
        data: mutation.payload,
        revision: (expenses.get(mutation.recordId)?.revision ?? 0) + 1,
      };
      expenses.set(mutation.recordId, next);
      return {
        data: next.data,
        mutationId: mutation.idempotencyKey,
        recordId: mutation.recordId,
        recordType: mutation.recordType,
        serverRevision: next.revision,
        updatedAt: "2026-08-02T12:15:00.000Z",
      };
    });
    await route.fulfill({
      body: JSON.stringify({ applied, conflicts: [], nextCursor: null, pulled: [] }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/expenses/*/receipt", async (route) => {
    if (await rejectWhenOffline(route)) return;
    uploadCalls += 1;
    if (uploadCalls === 1) {
      await route.fulfill({ status: 503 });
      return;
    }
    retryStarted = true;
    await retryGate;
    const expenseId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const current = expenses.get(expenseId)!;
    const data = { ...current.data, receiptSyncStatus: "uploaded" };
    expenses.set(expenseId, { data, revision: current.revision + 1 });
    await route.fulfill({
      body: JSON.stringify({
        data,
        revision: current.revision + 1,
        updatedAt: "2026-08-02T12:20:00.000Z",
      }),
      contentType: "application/json",
    });
  });

  return {
    releaseRetry: () => releaseRetry(),
    setNetworkAvailable: (available: boolean) => { networkAvailable = available; },
    retryStarted: () => retryStarted,
    uploadCalls: () => uploadCalls,
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

test("keeps a scanned receipt review intact when browser Back is cancelled", async ({ page }) => {
  await page.goto("/expenses/new");
  await waitForDatabase(page);
  if (await page.getByRole("heading", { name: "Choose your profession" }).isVisible()) {
    await page.getByLabel("GP").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
  }
  await page.getByRole("link", { name: "Scan a receipt" }).click();
  await page.getByLabel("Choose receipt").setInputFiles({
    buffer: Buffer.from("fictional browser history receipt"),
    mimeType: "application/pdf",
    name: "browser-history-receipt.pdf",
  });
  await expectAttachedReceipt(page, "browser-history-receipt.pdf");
  const moreOptions = page.getByText("More details", { exact: true }).locator("..");
  await expect(moreOptions).not.toHaveAttribute("open", "");
  await page.getByLabel("What did you buy?").fill("Edited fictional supplier");
  const autosaved = await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open("locum-manager");
    open.onsuccess = () => {
      const database = open.result;
      const request = database.transaction("expenses", "readonly").objectStore("expenses").getAll();
      request.onsuccess = () => {
        resolve(request.result.some((row) => row.data?.supplierDescription === "Edited fictional supplier"));
        database.close();
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(autosaved).toBe(false);

  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("dialog", { name: "Discard receipt changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/expenses\/new\/scan$/);
  await expect(page.getByLabel("What did you buy?")).toHaveValue("Edited fictional supplier");
  await expectAttachedReceipt(page, "browser-history-receipt.pdf");

  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("dialog", { name: "Discard receipt changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard and leave" }).click();
  await expect(page).toHaveURL(/\/expenses\/new$/);
  await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible();
});

test("guards persistent mobile navigation while reviewing a receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses/new");
  await waitForDatabase(page);
  if (await page.getByRole("heading", { name: "Choose your profession" }).isVisible()) {
    await page.getByLabel("GP").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
  }
  await page.getByRole("link", { name: "Scan a receipt" }).click();
  await page.getByLabel("Choose receipt").setInputFiles({
    buffer: Buffer.from("fictional mobile navigation receipt"),
    mimeType: "application/pdf",
    name: "mobile-navigation-receipt.pdf",
  });
  await expectAttachedReceipt(page, "mobile-navigation-receipt.pdf");
  const moreOptions = page.getByText("More details", { exact: true }).locator("..");
  await expect(moreOptions).not.toHaveAttribute("open", "");
  await page.getByLabel("What did you buy?").fill("Mobile edited supplier");

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Work sessions" })
    .click();
  await expect(page.getByRole("dialog", { name: "Discard receipt changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("What did you buy?")).toHaveValue("Mobile edited supplier");
  await expectAttachedReceipt(page, "mobile-navigation-receipt.pdf");

  await page.getByRole("link", { name: "Locum Manager" }).click();
  await expect(page.getByRole("dialog", { name: "Discard receipt changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard and leave" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Choose what you want to do" })).toBeVisible();
});

test("creates, edits, and deletes a custom-category expense at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses/categories");
  await waitForDatabase(page);
  await page.getByLabel("New category name").fill("Professional equipment");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Professional equipment", { exact: true })).toBeVisible();

  await ensureGpProfession(page);
  const moreOptions = page.getByText("More details", { exact: true }).locator("..");
  await expect(moreOptions).not.toHaveAttribute("open", "");
  await page.getByLabel("When did you buy it?", { exact: true }).fill("2026-08-02");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("12.50");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption({ label: "Custom: Professional equipment" });
  await page.getByLabel("What did you buy?").fill("Mobile stethoscope case");
  await page.getByText("More details", { exact: true }).click();
  await page.getByLabel("Reimbursed by practice").check();
  await activeExpenseForm(page).getByLabel("Add receipt", { exact: true }).setInputFiles({
    buffer: Buffer.from("fictional receipt"),
    mimeType: "application/pdf",
    name: "receipt.pdf",
  });

  await activeExpenseForm(page).getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByText("Mobile stethoscope case", { exact: true })).toBeVisible();
  await expect(page.getByText("Uploading")).toBeVisible();

  await page.getByRole("link", { name: "Open expense: Mobile stethoscope case" }).click();
  const editMoreOptions = page.getByText("More details", { exact: true }).locator("..");
  await expect(editMoreOptions).not.toHaveAttribute("open", "");
  await expect(page.getByText("Extra details saved", { exact: true })).toBeVisible();
  await page.getByText("More details", { exact: true }).click();
  await expect(page.getByLabel("Reimbursed by practice")).toBeChecked();
  await page.getByLabel("How much did it cost?", { exact: true }).fill("15.00");
  await activeExpenseForm(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "Mobile stethoscope case" }).getByText("£15.00"),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Open expense: Mobile stethoscope case" }).click();
  await page.getByRole("button", { name: "Delete expense" }).click();
  await expect(page.getByText("Mobile stethoscope case", { exact: true })).toHaveCount(0);
});

test("creates, edits, and deletes an expense at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ensureGpProfession(page);
  await page.getByLabel("When did you buy it?", { exact: true }).fill("2026-08-02");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("42.00");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption("professional_indemnity");
  await page.getByLabel("What did you buy?").fill("Desktop indemnity renewal");
  await activeExpenseForm(page).getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("Desktop indemnity renewal", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Open expense: Desktop indemnity renewal" }).click();
  await page.getByLabel("How much did it cost?", { exact: true }).fill("45.00");
  await activeExpenseForm(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "Desktop indemnity renewal" }).getByText("£45.00"),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Open expense: Desktop indemnity renewal" }).click();
  await page.getByRole("button", { name: "Delete expense" }).click();
  await expect(page.getByText("Desktop indemnity renewal", { exact: true })).toHaveCount(0);
});

test("uploads an offline receipt after reconnect and retries one failed upload", async ({ context, page }) => {
  const server = await installReceiptServer(page);
  await page.goto("/expenses");
  await waitForDatabase(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await ensureGpProfession(page);
  await page.getByLabel("When did you buy it?", { exact: true }).fill("2026-08-02");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("12.50");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption("professional_indemnity");
  await page.getByLabel("What did you buy?").fill("Offline receipt recovery");
  await activeExpenseForm(page).getByLabel("Add receipt", { exact: true }).setInputFiles({
    buffer: Buffer.from("fictional receipt"),
    mimeType: "application/pdf",
    name: "receipt.pdf",
  });

  server.setNetworkAvailable(false);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByText("Uploading")).toBeVisible();
  expect(server.uploadCalls()).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByText("Offline receipt recovery", { exact: true })).toBeVisible();
  await expect(page.getByText("Uploading")).toBeVisible();
  expect(server.uploadCalls()).toBe(0);

  server.setNetworkAvailable(true);
  await context.setOffline(false);
  await expect.poll(server.uploadCalls).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Offline receipt recovery", { exact: true })).toBeVisible();
  await expect(page.getByText("Upload failed")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(server.retryStarted).toBe(true);
  server.releaseRetry();
  await expect(page.getByRole("button", { name: "Open receipt for Offline receipt recovery" })).toBeVisible();
});

test("shows all tax periods and keeps reimbursed amounts out of the net subtotal", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/expenses");
  await waitForDatabase(page);
  await seedExpenseRows(page);
  await page.reload();

  const period = page.getByLabel("Tax period");
  await expect(period.getByRole("option")).toHaveCount(14);
  await expect(page.getByText("6 April expense", { exact: true })).toBeVisible();
  await expect(page.getByText("5 April expense", { exact: true })).toBeVisible();
  await expect(page.getByTestId("net-expenses")).toHaveText("£1,244.56");
  await expect(page.getByTestId("reimbursed-expenses")).toHaveText("£20.00");

  await period.selectOption("opening-april");
  await expect(page.getByText("6 April expense", { exact: true })).toBeVisible();
  await expect(page.getByText("5 April expense", { exact: true })).toHaveCount(0);
  await period.selectOption("closing-april");
  await expect(page.getByText("5 April expense", { exact: true })).toBeVisible();
  await expect(page.getByText("6 April expense", { exact: true })).toHaveCount(0);
});

test("shows compact private expense cards at mobile widths", async ({ page }) => {
  const title = "Fictional bookkeeping and professional support subscription with an intentionally long supplier title";
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const localApi = await installLocalExpenseApi(page, { calendar: 4, demo: 2, sync: 4 });

  await page.goto("/expenses");
  await waitForDatabase(page);
  await seedExpenseRows(page);
  await page.reload();

  const card = page.getByRole("article").filter({
    has: page.getByText(title, { exact: true }),
  });
  const receipt = card.getByRole("button", { name: `Open receipt for ${title}`, exact: true });
  await expect(page.getByRole("link", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  const missingReceipt = page.getByRole("img", { name: "No receipt attached for 6 April expense", exact: true });

  await expect(missingReceipt).toBeVisible();
  await expect(missingReceipt).toHaveAttribute("role", "img");
  await expect(missingReceipt).toHaveAttribute("aria-label", "No receipt attached for 6 April expense");

  await focusWithKeyboard(page, card.getByRole("link", { name: `Open expense: ${title}`, exact: true }));
  const cardOpen = card.getByRole("link", { name: `Open expense: ${title}`, exact: true });
  await expect(cardOpen).toBeFocused();
  const cardFocus = await visualState(cardOpen);
  expect(cardFocus.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(cardFocus.outlineWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(cardFocus.outlineOffset)).toBeLessThan(0);

  await page.keyboard.press("Tab");
  await expect(receipt).toBeFocused();
  const receiptFocus = await visualState(receipt);
  expect(receiptFocus.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(receiptFocus.outlineWidth)).toBeGreaterThan(0);

  await page.keyboard.press("Tab");
  const nextExpense = page.getByRole("link", { name: "Open expense: 6 April expense", exact: true });
  await expect(nextExpense).toBeFocused();
  await nextExpense.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.move(1, 1);

  const cardResting = await visualState(card);
  await cardOpen.hover();
  const cardHover = await visualState(card);
  expect(cardHover.backgroundColor).not.toBe(cardResting.backgroundColor);
  const cardPressed = await pressedVisualState(page, cardOpen, card);
  expect(cardPressed.backgroundColor).not.toBe(cardHover.backgroundColor);

  const receiptResting = await visualState(receipt);
  await receipt.hover();
  const receiptHover = await visualState(receipt);
  expect(receiptHover.backgroundColor).not.toBe(receiptResting.backgroundColor);
  const receiptPressed = await pressedVisualState(page, receipt, receipt);
  expect(receiptPressed.backgroundColor).not.toBe(receiptHover.backgroundColor);

  for (const width of [320, 375, 390, 440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    await expect(receipt).toHaveCount(1);
    await expect(receipt).toBeVisible();
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByText("Edit", { exact: true })).toHaveCount(0);
    await expect(card.getByText("No receipt", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Demo", { exact: true })).toHaveCount(0);
    await expect(card.locator("img")).toHaveCount(0);

    const [cardRect, receiptRect, overflow] = await Promise.all([
      card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      }),
      receipt.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      }),
      card.evaluate((element) => {
      const title = element.querySelector<HTMLElement>(".expense-card__title")!;
      const description = element.querySelector<HTMLElement>(".expense-card__description")!;
      return {
        descriptionOverflow: getComputedStyle(description).textOverflow,
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        titleOverflow: getComputedStyle(title).textOverflow,
        viewportHeight: window.innerHeight,
        viewportWidth: document.documentElement.clientWidth,
      };
      }),
    ]);

    expect(cardRect.left).toBeGreaterThanOrEqual(0);
    expect(cardRect.right).toBeLessThanOrEqual(overflow.viewportWidth);
    for (const targetRect of [receiptRect]) {
      expect(targetRect.width).toBeGreaterThanOrEqual(44);
      expect(targetRect.height).toBeGreaterThanOrEqual(44);
      expect(targetRect.left).toBeGreaterThanOrEqual(cardRect.left);
      expect(targetRect.right).toBeLessThanOrEqual(cardRect.right);
      expect(targetRect.top).toBeGreaterThanOrEqual(cardRect.top);
      expect(targetRect.bottom).toBeLessThanOrEqual(cardRect.bottom);
      expect(targetRect.left).toBeGreaterThanOrEqual(0);
      expect(targetRect.right).toBeLessThanOrEqual(overflow.viewportWidth);
      expect(targetRect.top).toBeGreaterThanOrEqual(0);
      expect(targetRect.bottom).toBeLessThanOrEqual(overflow.viewportHeight);
    }
    expect(overflow.titleOverflow).toBe("ellipsis");
    expect(overflow.descriptionOverflow).toBe("ellipsis");
    expect(overflow.documentOverflow).toBe(false);
  }

  await page.screenshot({ path: "test-results/expenses-no-edit-mobile.png", fullPage: true });
  await cardOpen.click();
  await expect(page).toHaveURL(/\/expenses\/compact-card$/);
  expect(consoleErrors).toEqual([]);
  localApi.assertExpectedCalls();
});

test("opens an uploaded receipt without navigating the compact expense card", async ({ page }) => {
  const title = "Fictional bookkeeping and professional support subscription with an intentionally long supplier title";
  let receiptReads = 0;
  const receiptFailures: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  const localApi = await installLocalExpenseApi(page, { calendar: 4, demo: 2, sync: 4 });
  await page.route("**/api/expenses/*/receipt", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    receiptReads += 1;
    if (
      request.method() !== "GET" ||
      url.pathname !== "/api/expenses/compact-card/receipt" ||
      url.search !== "" ||
      request.postData() !== null ||
      receiptReads > 1
    ) {
      receiptFailures.push(`Unexpected receipt request ${request.method()} ${url.pathname}${url.search}`);
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ url: "about:blank#fictional-receipt" }),
      contentType: "application/json",
    });
  });

  await page.goto("/expenses");
  await waitForDatabase(page);
  await seedExpenseRows(page);
  await page.reload();

  const card = page.getByRole("article").filter({
    has: page.getByText(title, { exact: true }),
  });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  expect(receiptReads).toBe(0);

  await card.getByRole("button", { name: /Open receipt/ }).click();
  await expect.poll(() => receiptReads).toBe(1);
  await expect(page).toHaveURL(/\/expenses$/);

  await card.getByRole("link", { name: /Open expense:/ }).click();
  await expect(page).toHaveURL(/\/expenses\/compact-card$/);
  expect(receiptFailures).toEqual([]);
  expect(consoleErrors).toEqual([]);
  localApi.assertExpectedCalls();
});
