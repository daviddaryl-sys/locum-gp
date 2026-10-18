// @vitest-environment node

import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const serviceWorker = readFileSync(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);

it("publishes the next installed PWA cache generations", () => {
  expect(serviceWorker).toContain(
    'const CACHE_NAME = "locum-manager-shell-v23";',
  );
  expect(serviceWorker).toContain(
    'const PRIVATE_PAGE_CACHE = "locum-manager-private-pages-v20";',
  );
});

it("never caches the authenticated profile and payments API", () => {
  expect(serviceWorker).toContain('if (request.method !== "GET") return;');
  expect(serviceWorker).toContain('if (!isCacheableStaticAsset(url)) return;');
  expect(serviceWorker).not.toContain('url.pathname.startsWith("/api/")');
  expect(serviceWorker).not.toMatch(/cache\.put\([^\n]*profile-and-payments/);
});

it("uses same-origin OCR assets without treating private receipt responses as static assets", () => {
  expect(serviceWorker).toContain('url.pathname.startsWith("/ocr/")');
  expect(serviceWorker).toContain('pathname.startsWith("/expenses/")');
  expect(serviceWorker).not.toMatch(/cache\.put\([^\n]*api\/expenses/);
});
