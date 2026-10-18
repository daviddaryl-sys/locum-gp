import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { GET } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("GET /auth/confirm", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("keeps provider-error redirects on the browser origin behind a reverse proxy", async () => {
    const response = await GET(
      new Request(
        "https://0.0.0.0:3210/auth/confirm" +
          "?provider=google&error=access_denied&next=%2Fdashboard",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "/login?error=google-sign-in",
    );
  });

  it("returns Google denial to a generic Google failure without opening a session", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await GET(
      new Request(
        "https://locum-manager.linktheworlds.co.uk/auth/confirm" +
          "?provider=google&error=access_denied&next=%2Fdashboard",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "/login?error=google-sign-in",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createClient).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "Google authentication callback failed.",
      { stage: "provider" },
    );
  });

  it("classifies a failed Google PKCE exchange without exposing the provider error", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      error: new Error("provider detail must stay private"),
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as never);

    const response = await GET(
      new Request(
        "https://locum-manager.linktheworlds.co.uk/auth/confirm" +
          "?provider=google&code=fictional-code&next=%2Fsessions",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("fictional-code");
    expect(response.headers.get("location")).toBe(
      "/login?error=google-sign-in",
    );
    expect(response.headers.get("location")).not.toContain("provider detail");
    expect(warning).toHaveBeenCalledWith(
      "Google authentication callback failed.",
      { stage: "session" },
    );
  });

  it("fails Google sign-in generically when provider-free persistence fails", async () => {
    const persistenceError = new Error("persistence detail must stay private");
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "supabase-access-fixture",
          refresh_token: "supabase-refresh-fixture",
        },
      },
      error: null,
    });
    const setSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: persistenceError,
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession, setSession, signOut },
    } as never);

    const response = await GET(
      new Request(
        "https://locum-manager.linktheworlds.co.uk/auth/confirm" +
          "?provider=google&code=fictional-code&next=%2Fsessions",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "/login?error=google-sign-in",
    );
    expect(response.headers.get("location")).not.toContain(
      "persistence detail",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("keeps missing email-link callbacks on the expired-link path", async () => {
    vi.mocked(createClient).mockResolvedValue({ auth: {} } as never);

    const response = await GET(
      new Request("https://locum-manager.linktheworlds.co.uk/auth/confirm"),
    );

    expect(response.headers.get("location")).toBe(
      "/login?error=expired-link",
    );
  });

  it("falls back from encoded backslash return paths without redirecting off-origin", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "supabase-access-fixture",
          refresh_token: "supabase-refresh-fixture",
        },
      },
      error: null,
    });
    let finishPersistence!: () => void;
    const setSession = vi.fn(
      () =>
        new Promise((resolve) => {
          finishPersistence = () =>
            resolve({
              data: {
                session: {
                  access_token: "supabase-access-fixture",
                  refresh_token: "supabase-refresh-fixture",
                },
              },
              error: null,
            });
        }),
    );
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession, setSession },
    } as never);

    let redirectCompleted = false;
    const responsePromise = GET(
      new Request(
        "https://locum-manager.linktheworlds.co.uk/auth/confirm" +
          "?provider=google&code=fictional-code" +
          "&next=%2F%5Cattacker.example%2Fprivate",
      ),
    );
    void responsePromise.then(() => {
      redirectCompleted = true;
    });

    await vi.waitFor(() => expect(setSession).toHaveBeenCalledOnce());
    expect(redirectCompleted).toBe(false);
    finishPersistence();
    const response = await responsePromise;

    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("location")).not.toContain("attacker.example");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "supabase-access-fixture",
      refresh_token: "supabase-refresh-fixture",
    });
  });

  it("keeps non-Google code callbacks on the direct exchange path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const setSession = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession, setSession },
    } as never);

    const response = await GET(
      new Request(
        "https://locum-manager.linktheworlds.co.uk/auth/confirm" +
          "?code=email-code-fixture&next=%2Fsessions",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("email-code-fixture");
    expect(setSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/sessions");
  });
});
