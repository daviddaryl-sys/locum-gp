import { describe, expect, it } from "vitest";

import { relativeRedirect } from "../relativeRedirect";

describe("relativeRedirect", () => {
  it("keeps authenticated redirects on the browser's current public origin", () => {
    const response = relativeRedirect("/dashboard");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/dashboard");
  });
});
