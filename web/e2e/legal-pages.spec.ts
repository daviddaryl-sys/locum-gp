import { expect, test } from "@playwright/test";

test.use({ viewport: { height: 812, width: 375 } });

test("keeps both legal documents public, readable and discoverable before sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();

  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText(/calendar\.app\.created/)).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow-x", "hidden");

  await page.getByRole("link", { name: "Terms of Service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await expect(
    page.getByText(/does not file or submit information to HMRC/i),
  ).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
});
