import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

async function waitForInitializedRuntime(page: import("@playwright/test").Page) {
  await expect(page.getByRole("main")).toHaveAttribute("data-runtime-ready", "true");
}

test("creates one practice and one session offline, then recovers them after reload", async ({
  context,
  page,
}) => {
  await page.goto("/practices/new");
  await expect(page.getByRole("heading", { name: "New practice" })).toBeVisible();
  await waitForInitializedRuntime(page);

  await context.setOffline(true);
  await page.getByLabel("Practice name").fill("Riverside Medical Centre");
  await page.getByLabel("Billing address").fill("1 Riverside Road, London");
  await page.getByLabel("Default hourly rate").fill("65.00");
  await page.getByLabel("Payment terms").fill("30");
  await page.getByRole("button", { name: "Save practice" }).dblclick();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await context.setOffline(false);
  await page.goto("/practices");
  await expect(page.getByRole("link", { name: /Riverside Medical Centre/ })).toHaveCount(1);

  await page.goto("/sessions/new");
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await page.getByLabel("Practice").selectOption({ label: "Riverside Medical Centre" });
  await page.getByLabel("Session date").fill("2026-08-12");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("13:00");
  await page.getByLabel("Completed").check();

  await page.goto("/sessions");
  await page.goto("/sessions/new");
  await page.getByLabel("Practice").selectOption({ label: "Riverside Medical Centre" });
  await page.getByLabel("Session date").fill("2026-08-12");
  await page.getByLabel("Start time").fill("09:00");
  await page.getByLabel("End time").fill("13:00");
  await page.getByLabel("Completed").check();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Save session" }).dblclick();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  await page.getByRole("link", { name: "Sessions" }).first().click();
  await page.getByRole("button", { name: "Calendar" }).click();
  await page.getByRole("button", { name: /Wednesday 12 August 2026, 1 session/ }).click();
  await expect(page.getByRole("link", { name: /Riverside Medical Centre/ })).toHaveCount(1);

  await context.setOffline(false);
  await page.reload();
  await page.goto("/sessions");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("link", { name: /Riverside Medical Centre/ })).toHaveCount(1);
  await expect(page.getByText("4 hours · £260.00")).toHaveCount(1);

  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByRole("region", { name: "Session calendar" })).toBeVisible();
  await page.getByRole("button", { name: /Wednesday 12 August 2026, 1 session/ }).click();
  await expect(page.getByRole("link", { name: /Riverside Medical Centre/ })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Calendar" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Wednesday 12 August 2026, 1 session/ }).click();
  await expect(page.getByRole("link", { name: /Riverside Medical Centre/ })).toHaveCount(1);

  const counts = await page.evaluate(async () => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction(
      ["practices", "sessions", "outbox"],
      "readonly",
    );
    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(store).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const result = {
      practices: await count("practices"),
      sessions: await count("sessions"),
      queuedChanges: await count("outbox"),
    };
    database.close();
    return result;
  });

  expect(counts).toEqual({ practices: 1, sessions: 1, queuedChanges: 2 });
});
