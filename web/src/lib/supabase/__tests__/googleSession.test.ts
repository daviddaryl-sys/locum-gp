import { describe, expect, it, vi } from "vitest";

import { exchangeGoogleCodeForProviderFreeSession } from "../googleSession";

describe("exchangeGoogleCodeForProviderFreeSession", () => {
  it("re-persists only the Supabase access and refresh tokens", async () => {
    const signOut = vi.fn();
    const setSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "supabase-access-fixture",
          refresh_token: "supabase-refresh-fixture",
        },
      },
      error: null,
    });
    const auth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: "supabase-access-fixture",
            refresh_token: "supabase-refresh-fixture",
            provider_token: "provider-access-must-not-persist",
            provider_refresh_token: "provider-refresh-must-not-persist",
          },
        },
        error: null,
      }),
      setSession,
      signOut,
    };

    const result = await exchangeGoogleCodeForProviderFreeSession(
      auth,
      "google-code-fixture",
    );

    expect(setSession).toHaveBeenCalledWith({
      access_token: "supabase-access-fixture",
      refresh_token: "supabase-refresh-fixture",
    });
    expect(result).toEqual({ error: null });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("fails closed when the exchange has no session", async () => {
    const setSession = vi.fn();

    const result = await exchangeGoogleCodeForProviderFreeSession(
      {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        setSession,
        signOut: vi.fn(),
      },
      "google-code-fixture",
    );

    expect(result.error).toBeInstanceOf(Error);
    expect(setSession).not.toHaveBeenCalled();
  });

  it("fails closed when provider-free persistence returns an error", async () => {
    const persistenceError = new Error("fixture persistence failure");
    const signOut = vi.fn().mockResolvedValue({ error: null });

    const result = await exchangeGoogleCodeForProviderFreeSession(
      {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "supabase-access-fixture",
              refresh_token: "supabase-refresh-fixture",
            },
          },
          error: null,
        }),
        setSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: persistenceError,
        }),
        signOut,
      },
      "google-code-fixture",
    );

    expect(result).toEqual({ error: persistenceError });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails closed when provider-free persistence returns no session", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const result = await exchangeGoogleCodeForProviderFreeSession(
      {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "supabase-access-fixture",
              refresh_token: "supabase-refresh-fixture",
            },
          },
          error: null,
        }),
        setSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        signOut,
      },
      "google-code-fixture",
    );

    expect(result.error).toBeInstanceOf(Error);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears the exchanged session when provider-free persistence throws", async () => {
    const persistenceError = new Error("fixture persistence exception");
    const signOut = vi.fn().mockResolvedValue({ error: null });

    const result = await exchangeGoogleCodeForProviderFreeSession(
      {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "supabase-access-fixture",
              refresh_token: "supabase-refresh-fixture",
            },
          },
          error: null,
        }),
        setSession: vi.fn().mockRejectedValue(persistenceError),
        signOut,
      },
      "google-code-fixture",
    );

    expect(result).toEqual({ error: persistenceError });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("waits for unsafe-session cleanup before returning the error", async () => {
    let finishCleanup!: () => void;
    const signOut = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          finishCleanup = () => resolve({ error: null });
        }),
    );
    const resultPromise = exchangeGoogleCodeForProviderFreeSession(
      {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "supabase-access-fixture",
              refresh_token: "supabase-refresh-fixture",
            },
          },
          error: null,
        }),
        setSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: new Error("fixture persistence failure"),
        }),
        signOut,
      },
      "google-code-fixture",
    );
    let helperReturned = false;
    void resultPromise.then(() => {
      helperReturned = true;
    });

    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(helperReturned).toBe(false);
    finishCleanup();
    await resultPromise;
    expect(helperReturned).toBe(true);
  });
});
