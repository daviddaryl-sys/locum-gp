import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { updateSession } from "../proxy";

describe.each(["/privacy", "/terms"])("public legal route %s", (pathname) => {
  beforeEach(() => {
    createServerClient.mockReset();
    createServerClient.mockImplementation(
      (_url, _key, options: { cookies: { getAll: () => unknown } }) => {
        options.cookies.getAll();
        return { auth: { getClaims: vi.fn() } };
      },
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fictional-public-key");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not initialise authentication or inspect cookies", async () => {
    const url = `https://locum-manager.example${pathname}`;
    const request = {
      headers: new Headers(),
      nextUrl: new URL(url),
      url,
      get cookies() {
        throw new Error("public legal routes must not inspect cookies");
      },
    } as unknown as NextRequest;

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
