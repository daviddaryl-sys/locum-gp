import { expect, test, type Page } from "@playwright/test";

const localProfileAndPayments = {
  state: "ready",
  profile: {
    doctorName: "Dr Browser Example",
    tradingName: "Browser Example Locums",
    address: "1 Example Road, London",
    email: "browser@example.test",
  },
  invoicePrefix: "INV",
  paymentDetails: {
    accountName: "Browser Example Payments",
    sortCode: "12-34-56",
    accountNumber: "12345678",
  },
  paymentSummary: {
    accountName: "Browser Example Payments",
    accountNumberLast4: "5678",
  },
  encryptedSnapshot: {
    version: 2,
    ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
    salt: "AAECAwQFBgcICQoLDA0ODw==",
    initializationVector: "EBESExQVFhcYGRob",
    kdfParameters: {
      name: "HKDF",
      hash: "SHA-256",
      info: "locum-manager-payment:v2",
    },
  },
  settingsRecord: {
    id: "00000000-0000-4000-8000-000000000001",
    data: {
      encryptionVersion: 2,
      ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      initializationVector: "EBESExQVFhcYGRob",
      kdfParameters: {
        name: "HKDF",
        hash: "SHA-256",
        info: "locum-manager-payment:v2",
      },
      profile: {
        doctorName: "Dr Browser Example",
        tradingName: "Browser Example Locums",
        address: "1 Example Road, London",
        email: "browser@example.test",
        profession: "gp",
      },
      invoicePrefix: "INV",
    },
    revision: 2,
    updatedAt: "2026-08-09T09:00:00.000Z",
  },
} as const;

async function offlinePersistence(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("locum-manager");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tables = ["settings", "invoices", "invoiceItems", "outbox"];
    const transaction = database.transaction(tables, "readonly");
    const values = await Promise.all(
      tables.map(
        (table) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore(table).getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          }),
      ),
    );
    database.close();
    return JSON.stringify(values);
  });
}

test("creates and recovers a local invoice draft without a payment passcode", async ({ context, page }) => {
  test.setTimeout(60_000);

  let profileAndPaymentsRequests = 0;
  await page.route("**/api/profile-and-payments", async (route) => {
    expect(route.request().method()).toBe("GET");
    profileAndPaymentsRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify(localProfileAndPayments),
    });
  });
  await page.addInitScript(() => localStorage.setItem("locum-manager:install-guide-dismissed", "true"));
  await page.goto("/dashboard");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    }
  });
  for (const route of ["/practices/new", "/sessions/new", "/invoices/new", "/invoices"]) {
    await page.goto(route);
  }
  await page.goto("/settings/profile");
  await expect(page.getByText("Payment details saved")).toBeVisible();
  await expect(page.getByText("•••• 5678")).toBeVisible();
  await expect(page.getByLabel(/passcode/i)).toHaveCount(0);
  await expect(page.getByText(/unlock payment details/i)).toHaveCount(0);

  await page.goto("/practices/new");
  await page.getByLabel("Practice name").fill("Fictional Medical Centre");
  await page.getByLabel("Billing address").fill("2 Fiction Street, London");
  await page.getByLabel("Default hourly rate").fill("65.00");
  await page.getByLabel("Payment terms").fill("30");
  await page.getByRole("button", { name: "Save practice" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await page.goto("/sessions/new");
  await expect(page.getByLabel("Practice")).toContainText("Fictional Medical Centre");
  await page.getByLabel("Practice").selectOption({ label: "Fictional Medical Centre" });
  await page.getByLabel("Session date").fill("2026-08-12");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("13:00");
  await page.getByLabel("Completed").check();
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "Choose practice" })).toBeVisible();
  await expect(page.getByLabel(/passcode/i)).toHaveCount(0);
  await page.getByRole("radio", { name: "Fictional Medical Centre" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: /12 August 2026/ }).check();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Issue invoice" })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved on this device.")).toBeVisible();
  expect(profileAndPaymentsRequests).toBeGreaterThan(0);

  const persisted = await offlinePersistence(page);
  for (const value of Object.values(localProfileAndPayments.paymentDetails)) {
    expect(persisted).not.toContain(value);
  }
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cachedUrls).not.toContain("/api/profile-and-payments");

  await context.setOffline(true);
  await page.reload();
  await page.goto("/invoices");
  await expect(page.getByRole("link", { name: /Draft invoice.*Fictional Medical Centre/ })).toBeVisible();
  await context.setOffline(false);
});

test("issues and downloads a PDF against an authorized acceptance project", async ({ page }) => {
  test.skip(
    process.env.LOCUM_E2E_LIVE !== "1" ||
      !process.env.LOCUM_E2E_BASE_URL ||
      !process.env.LOCUM_E2E_USER_EMAIL ||
      !process.env.LOCUM_E2E_USER_PASSWORD,
    "Requires authorized disposable Supabase accounts, storage, and target environment.",
  );
  test.setTimeout(120_000);

  const uniquePractice = `Acceptance Practice ${Date.now()}`;
  const sessionDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London",
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  });

  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.LOCUM_E2E_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.LOCUM_E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByRole("heading", { name: "Next session" })).toBeVisible();

  await page.goto("/settings/profile");
  await expect(page.getByRole("button", { name: "Save profile and payments" })).toBeVisible();
  const changePaymentDetails = page.getByRole("button", { name: "Change payment details" });
  if (await changePaymentDetails.isVisible()) await changePaymentDetails.click();
  await page.getByLabel("Name", { exact: true }).fill("Dr Acceptance Test");
  await page.getByLabel("Trading name (optional)").fill("Acceptance Locums");
  await page.getByLabel("Address", { exact: true }).fill("1 Acceptance Road, London");
  await page.getByLabel("Email address").fill("acceptance@example.test");
  await page.getByLabel("Invoice prefix").fill("ACC");
  await page.getByLabel("Account name").fill("Dr Acceptance Test");
  await page.getByLabel("Sort code").fill("12-34-56");
  await page.getByLabel("Account number").fill("12345678");
  await expect(page.getByLabel(/passcode/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Save profile and payments" }).click();
  await expect(page.getByText("Profile and payment details saved.")).toBeVisible();

  await page.goto("/practices/new");
  await page.getByLabel("Practice name").fill(uniquePractice);
  await page.getByLabel("Billing address").fill("2 Acceptance Street, London");
  await page.getByLabel("Default hourly rate").fill("65.00");
  await page.getByLabel("Payment terms").fill("30");
  await page.getByRole("button", { name: "Save practice" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await page.goto("/sessions/new");
  await page.getByLabel("Practice").selectOption({ label: uniquePractice });
  await page.getByLabel("Session date").fill(sessionDate);
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("13:00");
  await page.getByLabel("Completed").check();
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "Choose practice" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(/passcode/i)).toHaveCount(0);
  await page.getByRole("radio", { name: uniquePractice }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("Issued securely")).toBeVisible({ timeout: 30_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
});
