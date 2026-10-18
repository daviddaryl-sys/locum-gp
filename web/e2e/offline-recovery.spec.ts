import { expect, test } from "@playwright/test";

const OWNER = "00000000-0000-4000-8000-000000000001";

test("surfaces a persisted conflict and applies the explicit cloud choice", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("locum-manager:install-guide-dismissed", "true"),
  );
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Next session" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open("locum-manager");
            open.onsuccess = () => {
              const ready = open.result.objectStoreNames.contains("conflicts");
              open.result.close();
              resolve(ready);
            };
            open.onerror = () => resolve(false);
          }),
      ),
    )
    .toBe(true);
  await page.evaluate(async ({ ownerId }) => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction(["practices", "conflicts", "outbox"], "readwrite");
    const request = (store: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const operation = transaction.objectStore(store).put(value);
        operation.onsuccess = () => resolve();
        operation.onerror = () => reject(operation.error);
      });
    const recordId = "00000000-0000-4000-8000-000000000111";
    const mutationId = "00000000-0000-4000-8000-000000000222";
    const localData = { name: "My local name", billingAddress: { formatted: "1 Local Road" }, defaultHourlyRatePence: 6000, paymentTermsDays: 30, archived: false };
    const serverData = { ...localData, name: "Cloud-approved name" };
    await request("practices", { ownerId, id: recordId, recordType: "practices", data: localData, localRevision: 2, serverRevision: 1, syncState: "conflict", updatedAt: "2026-08-02T08:00:00Z", deletedAt: null });
    await request("outbox", { ownerId, id: mutationId, recordType: "practices", recordId, operation: "upsert", payload: localData, baseRevision: 1, localRevision: 2, state: "conflict", attempts: 0, createdAt: "2026-08-02T08:00:00Z", nextAttemptAt: null });
    await request("conflicts", { ownerId, id: mutationId, recordType: "practices", recordId, mutationId, localData, serverData, serverRevision: 2, localUpdatedAt: "2026-08-02T08:00:00Z", serverUpdatedAt: "2026-08-02T08:01:00Z", createdAt: "2026-08-02T08:02:00Z" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { ownerId: OWNER });
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Review sync conflict" })).toBeVisible();
  await page.getByRole("button", { name: "Use cloud version" }).click();
  await expect(page.getByRole("dialog", { name: "Review sync conflict" })).toHaveCount(0);
  await page.goto("/practices");
  await expect(page.getByText("Cloud-approved name")).toBeVisible();
  await expect(page.getByText("My local name")).toHaveCount(0);
});
