import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

test("removes routine labels from signed-in index pages", async ({ page }) => {
  const pages = [
    { pathname: "/sessions", heading: "Sessions" },
    { pathname: "/invoices", heading: "Invoices" },
    { pathname: "/practices", heading: "Practices" },
    { pathname: "/more", heading: "My account" },
  ];
  const routineLabels = [
    "Saving changes",
    "Syncing securely",
    "All changes saved",
    "Preparing offline records",
    "Offline records ready",
    "Offline — changes stay on this device",
    "Action required",
  ];

  for (const { pathname, heading } of pages) {
    await page.goto(pathname);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Locum Manager", { exact: true }),
    ).toHaveCount(0);
    for (const label of routineLabels) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
  }
});

test("uses an accessible four-tab bottom navigation at iPhone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
  await expect(page.locator(".dashboard-page > .eyebrow")).toHaveCount(0);
  await expect(page.getByText("Private account", { exact: true })).toHaveCount(0);
  await expect(page.getByText("All changes saved", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Offline — changes stay on this device", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Action required", { exact: true })).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  const labels = ["Home", "Sessions", "Invoices", "More"];
  const icons = ["house", "calendar", "document", "ellipsis-circle"];
  const tabs = navigation.locator(".app-navigation__items a");
  await expect(tabs).toHaveCount(4);
  for (const [index, label] of labels.entries()) {
    const tab = navigation.getByRole("link", { name: label, exact: true });
    await expect(tab).toBeVisible();
    await expect(tab.locator(`svg[data-icon="${icons[index]}"]`)).toHaveCount(1);
    await expect(tab.locator("img")).toHaveCount(0);
  }
  const home = page.getByRole("link", { name: "Home", exact: true });
  await expect(home).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(home).toHaveAttribute("data-state", "active");
  const activeHomeIcon = home.locator(
    '.app-navigation__icon-tile[data-state="active"]',
  );
  await expect(activeHomeIcon).toBeVisible();
  expect(
    await activeHomeIcon.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)");
  expect(
    await activeHomeIcon.evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe("none");
  const sessions = page.getByRole("link", { name: "Sessions", exact: true });
  await expect(sessions).toHaveAttribute("data-state", "inactive");
  await expect(home).not.toHaveCSS("color", await sessions.evaluate((element) => getComputedStyle(element).color));

  const navBox = await navigation.boundingBox();
  expect(navBox).not.toBeNull();
  expect(Math.abs(navBox!.y + navBox!.height - 844)).toBeLessThanOrEqual(2);
  expect(navBox!.width).toBe(390);

  for (const link of await navigation.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
});

test("keeps work tools reachable from Dashboard and retained controls reachable from More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const workTools = page.getByRole("region", { name: "Manage your work" });
  const orderedTools = workTools.locator("a.dashboard-tool");
  await expect(orderedTools).toHaveCount(4);
  await expect(orderedTools.nth(0)).toHaveAccessibleName("Add session");
  await expect(orderedTools.nth(1)).toHaveAccessibleName("Expenses");
  await expect(orderedTools.nth(2)).toHaveAccessibleName("Tax & MTD");
  await expect(orderedTools.nth(3)).toHaveAccessibleName("Create invoice");
  await expect(
    workTools.getByRole("link", { name: "Expenses", exact: true }),
  ).toHaveAttribute("href", "/expenses");
  await expect(
    workTools.getByRole("link", { name: "Tax & MTD", exact: true }),
  ).toHaveAttribute("href", "/tax-mtd");
  await expect(
    workTools.getByRole("link", { name: "Add session", exact: true }),
  ).toHaveAttribute("href", "/sessions/new");
  await expect(
    workTools.getByRole("link", { name: "Create invoice", exact: true }),
  ).toHaveAttribute("href", "/invoices/new");
  const iconBackgrounds = await workTools
    .locator(".dashboard-tool__icon")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(iconBackgrounds).size).toBe(4);
  expect((await page.locator(".dashboard-next").boundingBox())!.y).toBeLessThan(
    (await workTools.boundingBox())!.y,
  );

  await page.goto("/more");
  const overview = page.getByRole("region", { name: "Financial overview" });
  await expect(overview).toBeVisible();
  for (const label of [
    /Paid this year/,
    /Outstanding/,
    /Overdue/,
    /Draft invoices/,
    /Ready to invoice/,
    /Expenses this tax year/,
  ]) {
    await expect(overview.getByRole("link", { name: label })).toBeVisible();
  }
  const practices = page.getByRole("link", { name: "Practices", exact: true });
  await expect(practices).toHaveAttribute("href", "/practices");
  expect((await overview.boundingBox())!.y).toBeLessThan(
    (await practices.boundingBox())!.y,
  );
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("href", "/settings/profile");
  await expect(page.getByRole("link", { name: "Google Calendar", exact: true })).toHaveAttribute("href", "/settings/connected-services");
  await expect(page.getByRole("button", { name: "Demo data", exact: true })).toBeVisible();
  await expect(page.locator(".more-action__copy strong")).toHaveText([
    "Practices",
    "Tax & MTD",
    "Demo data",
    "Google Calendar",
    "Profile",
    "Encrypted backup",
    "Privacy",
    "Sign out",
  ]);
});

test("keeps More active for retained More destinations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const pathname of [
    "/more",
    "/practices",
    "/settings/profile",
    "/settings/connected-services",
  ]) {
    await page.goto(pathname);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const more = navigation.getByRole("link", { name: "More", exact: true });
    await expect(more).toHaveAttribute("aria-current", "page");
    await expect(more).toHaveAttribute("data-state", "active");

    for (const label of ["Home", "Sessions", "Invoices"]) {
      const tab = navigation.getByRole("link", { name: label, exact: true });
      await expect(tab).not.toHaveAttribute("aria-current");
      await expect(tab).toHaveAttribute("data-state", "inactive");
    }
  }
});

test("keeps Home active for Dashboard work tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const pathname of [
    "/expenses",
    "/expenses/categories",
    "/tax-mtd",
  ]) {
    await page.goto(pathname);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const home = navigation.getByRole("link", { name: "Home", exact: true });
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(home).toHaveAttribute("data-state", "active");

    for (const label of ["Sessions", "Invoices", "More"]) {
      const tab = navigation.getByRole("link", { name: label, exact: true });
      await expect(tab).not.toHaveAttribute("aria-current");
      await expect(tab).toHaveAttribute("data-state", "inactive");
    }
  }
});

test("expands navigation into a desktop sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const navBox = await navigation.boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.x).toBe(0);
  expect(navBox!.y).toBe(0);
  expect(navBox!.width).toBeGreaterThanOrEqual(240);
  expect(navBox!.height).toBe(800);
  await expect(navigation.getByText("Locum Manager")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(navigation.locator(".app-navigation__items a")).toHaveCount(7);
  await expect(navigation.getByRole("link", { name: "Expenses", exact: true })).toHaveAttribute("href", "/expenses");
  await expect(navigation.getByRole("link", { name: "Practices", exact: true })).toHaveAttribute("href", "/practices");
  await expect(navigation.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("href", "/more");
});
