import { describe, expect, it } from "vitest";

import { safeReturnPath } from "../returnPath";

describe("safeReturnPath", () => {
  it("preserves a safe application path with query and fragment", () => {
    expect(safeReturnPath("/sessions?view=week#today")).toBe(
      "/sessions?view=week#today",
    );
  });

  it.each([
    "//attacker.example/private",
    "/\\attacker.example/private",
    "\\attacker.example/private",
    "\\\\attacker.example/private",
    "/%5Cattacker.example/private",
    "/%5cattacker.example/private",
    "/%5C%5Cattacker.example/private",
  ])("falls back for malformed return path %s", (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard");
  });

  it("falls back for a decoded callback next parameter containing backslashes", () => {
    const callback = new URL("https://locum-manager.invalid/auth/confirm");
    callback.searchParams.set("next", "/\\attacker.example/private");

    expect(safeReturnPath(callback.searchParams.get("next"))).toBe(
      "/dashboard",
    );
  });
});
