import { expect, test } from "@playwright/test";

test("runs receipt OCR in a same-origin worker with local WASM assets", async ({
  page,
}) => {
  test.slow();
  const requestedPaths = new Set<string>();
  const remoteRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        remoteRequests.push(url.origin);
      }
      requestedPaths.add(url.pathname);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const response = await page.goto("/e2e/ocr-smoke");
  const contentSecurityPolicy =
    response?.headers()["content-security-policy"] ?? "";
  expect(contentSecurityPolicy).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
  expect(contentSecurityPolicy).toContain("worker-src 'self'");
  expect(contentSecurityPolicy).not.toContain("worker-src 'self' blob:");
  if (process.env.LOCUM_E2E_OCR_PRODUCTION === "1") {
    expect(contentSecurityPolicy).not.toMatch(
      /script-src[^;]*(?:^| )'unsafe-eval'(?: |;|$)/,
    );
  }
  await expect(
    page.getByRole("heading", { name: "Local OCR browser smoke" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run fictional receipt OCR" }).click();
  await expect(page.getByRole("status")).toHaveText("Local OCR complete", {
    timeout: 90_000,
  });

  expect(remoteRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
  expect(requestedPaths).toContain("/ocr/worker.min.js");
  expect(requestedPaths).toContain("/ocr/eng.traineddata.gz");
  expect(
    [...requestedPaths].some((path) =>
      /\/ocr\/tesseract-core(?:-(?:relaxedsimd|simd))?-lstm\.wasm\.js$/.test(
        path,
      ),
    ),
  ).toBe(true);
});
