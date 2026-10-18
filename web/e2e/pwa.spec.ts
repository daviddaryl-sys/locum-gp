import { expect, test } from "@playwright/test";

test("publishes an installable manifest and reopens the shell offline", async ({
  context,
  page,
}) => {
  await page.route("**/api/google-calendar/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ state: "not_connected" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Locum Manager" }),
  ).toBeVisible();

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");

  const manifestResponse = await page.request.get(manifestHref!);
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "Locum Manager",
    display: "standalone",
    start_url: "/",
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;

    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    });
  });

  // Give the active worker one controlled online load so it can cache hashed,
  // immutable Next.js assets without caching the navigation response itself.
  await page.reload({ waitUntil: "networkidle" });

  await page.evaluate(async () => {
    const privateResponses = [
      "/api/google-calendar/status",
      "/api/google-calendar/sync",
      "/api/google-calendar/callback?state=fictional&code=fictional",
      "/api/google-calendar/token",
      "/api/profile-and-payments",
      "/auth/confirm",
      "/login",
      "/fictional-invoice.pdf",
    ];
    await Promise.allSettled(
      privateResponses.map((url) => fetch(url, { cache: "no-store" })),
    );
    await fetch("/ocr/worker.min.js");
  });

  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(
      names.map(async (name) => (await caches.open(name)).keys()),
    );
    return requests.flat().map((request) => new URL(request.url).pathname);
  });

  expect(cachedUrls).toContain("/");
  expect(cachedUrls).toContain("/ocr/worker.min.js");
  expect(
    cachedUrls.some(
      (url) =>
        url.startsWith("/api/") ||
        url.startsWith("/auth/") ||
        url === "/login" ||
        url.includes("/api/google-calendar/") ||
        url.includes("oauth") ||
        url.includes("token") ||
        url.includes("status") ||
        url.includes("sync") ||
        url.endsWith(".pdf"),
    ),
  ).toBe(false);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Locum Manager" }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("upgrades the controlled four-tab shell and keeps it available offline", async ({
  context,
  page,
}) => {
  test.slow();

  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
  await page.goto("/dashboard");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
    await Promise.all([
      caches.delete("locum-manager-shell-v18"),
      caches.delete("locum-manager-private-pages-v17"),
    ]);
    const legacyShell = await caches.open("locum-manager-shell-v4");
    const legacyPrivate = await caches.open("locum-manager-private-pages-v3");
    const priorShell = await caches.open("locum-manager-shell-v15");
    const priorPrivate = await caches.open("locum-manager-private-pages-v14");
    const paymentShell = await caches.open("locum-manager-shell-v17");
    const paymentPrivate = await caches.open("locum-manager-private-pages-v16");
    const unrelatedCache = await caches.open("unrelated-feature-cache-v1");
    await Promise.all([
      legacyShell.put("/legacy-shell", new Response("legacy shell")),
      legacyPrivate.put("/dashboard", new Response("legacy private page")),
      priorShell.put("/prior-shell", new Response("prior shell")),
      priorPrivate.put("/more", new Response("prior private page")),
      paymentShell.put("/prior-payment-shell", new Response("prior payment shell")),
      paymentPrivate.put("/invoices/new", new Response("prior payment page")),
      unrelatedCache.put("/unrelated-feature", new Response("unrelated feature")),
      unrelatedCache.put(
        "/",
        new Response("<h1>Unrelated shell</h1>", {
          headers: { "content-type": "text/html" },
        }),
      ),
      unrelatedCache.put(
        "/settings/connected-services",
        new Response("<h1>Unrelated private page</h1>", {
          headers: { "content-type": "text/html" },
        }),
      ),
      unrelatedCache.put(
        "/manifest.webmanifest",
        new Response(JSON.stringify({ name: "Unrelated feature" }), {
          headers: { "content-type": "application/manifest+json" },
        }),
      ),
    ]);
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toContain("locum-manager-private-pages-v17");
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).toContain("locum-manager-shell-v18");
  expect(cacheNames).toContain("locum-manager-private-pages-v17");
  expect(cacheNames).not.toContain("locum-manager-shell-v17");
  expect(cacheNames).not.toContain("locum-manager-private-pages-v16");
  expect(cacheNames).not.toContain("locum-manager-shell-v4");
  expect(cacheNames).not.toContain("locum-manager-private-pages-v3");
  expect(cacheNames).not.toContain("locum-manager-shell-v15");
  expect(cacheNames).not.toContain("locum-manager-private-pages-v14");
  expect(cacheNames).toContain("unrelated-feature-cache-v1");

  const manifest = await page.evaluate(async () =>
    (await fetch("/manifest.webmanifest")).json(),
  );
  expect(manifest).toMatchObject({ name: "Locum Manager" });

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.locator(".app-navigation__items a")).toHaveCount(4);
  for (const label of ["Home", "Sessions", "Invoices", "More"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  const expectMoreActions = async () => {
    await expect(
      page.getByRole("region", { name: "Financial overview" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Practices", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Demo data", exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Profile and payments", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connected services", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Encrypted backup", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Privacy", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  };

  await page.goto("/more", { waitUntil: "domcontentloaded" });
  await expectMoreActions();
  await page.goto("/settings/connected-services", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Connected services" })).toBeVisible();
  await page.goto("/expenses/new/scan", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("locum-manager-private-pages-v17");
    return Boolean(await cache.match("/expenses/new/scan"));
  })).toBe(true);
  await page.goto("/settings/connected-services", { waitUntil: "domcontentloaded" });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Connected services" })).toBeVisible();
    await page.goto("/offline-shell-probe", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Locum Manager" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
