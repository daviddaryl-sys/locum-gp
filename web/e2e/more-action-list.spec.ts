import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

test("shows the high-contrast More action list at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/more");

  await expect(page.getByRole("link", { name: "Expenses", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tax & MTD", exact: true })).toHaveCount(0);

  const controls = [
    page.getByRole("link", { name: "Practices", exact: true }),
    page.getByRole("button", { name: "Demo data", exact: true }),
    page.getByRole("link", { name: "Profile and payments", exact: true }),
    page.getByRole("button", { name: "Encrypted backup", exact: true }),
    page.getByRole("button", { name: "Privacy", exact: true }),
    page.getByRole("button", { name: "Sign out", exact: true }),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }

  const practices = page.getByRole("link", { name: "Practices", exact: true });
  await expect(practices).toHaveCSS("background-color", "rgb(18, 97, 215)");
  await expect(practices.locator('svg[data-icon="practices"]')).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .locator(".app-navigation__items a"),
  ).toHaveCount(4);

  await practices.focus();
  await expect(practices).toBeFocused();
  await expect(practices).toHaveCSS("outline-color", "rgb(219, 234, 254)");
  await expect(practices).toHaveCSS("box-shadow", "none");

  const demo = page.getByRole("button", { name: "Demo data", exact: true });
  await demo.focus();
  await expect(demo).toBeFocused();
  await expect(demo).toHaveCSS("outline-color", "rgb(11, 79, 184)");
  await expect(demo).toHaveCSS("box-shadow", "none");
  await demo.press("Enter");
  await expect(demo).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Load demo data" })).toBeVisible();
});

test("keeps the action list readable instead of creating a desktop card grid", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/more");
  const list = page.locator(".more-actions");
  const box = await list.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(760);
  await expect(page.getByRole("link", { name: "Practices", exact: true })).toHaveAttribute(
    "href",
    "/practices",
  );
});
