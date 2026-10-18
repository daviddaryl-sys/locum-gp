import { expect, test, type Page } from "@playwright/test";

type CalendarState =
  | "connected"
  | "not_connected"
  | "pending"
  | "reconnect_required";

const summary = (state: CalendarState) => ({
  lastSyncAt: state === "connected" ? "2026-08-05T10:00:00.000Z" : null,
  nextRetryAt: null,
  pendingCount: state === "pending" ? 2 : 0,
  state,
});

async function interceptSummary(page: Page, state: CalendarState) {
  await page.route("**/api/google-calendar/sync", async (route) => {
    await route.fulfill({
      body: JSON.stringify(summary(state)),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

test("warms the local Calendar boundary without provider credentials @calendar-server-warmup", async ({
  request,
}) => {
  const response = await request.post("/api/google-calendar/sync");
  expect(response.status()).toBe(401);
});

for (const state of ["not_connected", "pending", "reconnect_required", "connected"] as const) {
  test(`shows the private ${state.replaceAll("_", "-")} Calendar state`, async ({ page }) => {
    await interceptSummary(page, state);
    await page.goto("/more");
    await page.getByRole("link", { name: "Connected services" }).click();
    await expect(page).toHaveURL(/\/settings\/connected-services$/);
    const service = page.getByRole("region", { name: "Google Calendar" });

    if (state === "not_connected") {
      await expect(service.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
    } else if (state === "pending") {
      await expect(service.getByText("Sync pending for 2 sessions.")).toHaveAttribute("role", "status");
    } else if (state === "reconnect_required") {
      await expect(service.getByRole("button", { name: "Reconnect Google Calendar" })).toBeVisible();
    } else {
      await expect(service.getByText("Locum Manager → Google")).toBeVisible();
    }

    await expect(service.getByText(/practice name, session start and end time, practice address/i)).toBeVisible();
    for (const forbidden of ["Hourly rate", "Invoice", "Payment", "Notes", "Tax", "Receipt"]) {
      await expect(service.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
  });
}

test("confirms disconnect and recovers a temporarily unavailable status", async ({ page }) => {
  let attempts = 0;
  let disconnected = false;
  let disconnectMethod: string | null = null;
  let disconnectRequests = 0;
  await page.route("**/api/google-calendar/sync", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, body: "unavailable" });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(summary(disconnected ? "not_connected" : "connected")),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/google-calendar/disconnect", async (route) => {
    disconnectRequests += 1;
    disconnectMethod = route.request().method();
    disconnected = true;
    await route.fulfill({ status: 204 });
  });
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toBe(
      "Disconnect Google Calendar? Existing Google events will remain.",
    );
    await dialog.accept();
  });

  await page.goto("/settings/connected-services");
  await expect(
    page.getByText("Google Calendar status is temporarily unavailable."),
  ).toHaveAttribute("role", "alert");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Locum Manager → Google")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => disconnectRequests).toBe(1);
  expect(disconnectMethod).toBe("POST");
  await expect(page.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
});
