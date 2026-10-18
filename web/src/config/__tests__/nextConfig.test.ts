// @vitest-environment node

import { describe, expect, it } from "vitest";

import nextConfig, { buildContentSecurityPolicy } from "../../../next.config";

describe("production security headers", () => {
  it("allows the Google Accounts OAuth redirect without allowing arbitrary form targets", async () => {
    const headerGroups = await nextConfig.headers?.();
    const globalHeaders = headerGroups?.find((group) => group.source === "/:path*");
    const policy = globalHeaders?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(policy).toContain(
      "form-action 'self' https://accounts.google.com",
    );
    expect(policy).not.toContain("form-action *");
    expect(policy).not.toContain("https://*.google.com");
  });

  it("allows local WebAssembly without allowing blob-backed workers", async () => {
    const policy = buildContentSecurityPolicy(false);

    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*(?:^| )'unsafe-eval'(?: |;|$)/);
    expect(policy).toContain("worker-src 'self'");
    expect(policy).not.toContain("worker-src 'self' blob:");
  });
});
