import { expect, test } from "@playwright/test";

test("offers Google alongside password and password-recovery sign-in methods", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with password" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Email me a magic link" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Forgot password" }),
  ).toBeVisible();
});

test("validates sign-in safely and returns a generic authentication failure", async ({ page }) => {
  await page.goto("/login?returnTo=https://attacker.example");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();

  await page.getByLabel("Email address").fill("fictional@example.test");
  await page.getByLabel("Password").fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByText(
    "We could not sign you in. Check your details and try again.",
  )).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue("fictional@example.test");
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("signs in and signs out against an authorized target", async ({ page }) => {
  test.skip(
    process.env.LOCUM_E2E_LIVE !== "1" ||
      !process.env.LOCUM_E2E_USER_EMAIL ||
      !process.env.LOCUM_E2E_USER_PASSWORD,
    "Requires an authorized disposable acceptance account and target Supabase project.",
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.LOCUM_E2E_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.LOCUM_E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(
    page.getByRole("heading", { name: "Next session" }),
  ).toBeVisible();
  await page.goto("/more");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
