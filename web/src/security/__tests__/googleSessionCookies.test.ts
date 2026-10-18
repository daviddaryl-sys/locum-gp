// @vitest-environment node

import {
  combineChunks,
  createServerClient,
  stringFromBase64URL,
} from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";

import { exchangeGoogleCodeForProviderFreeSession } from "@/lib/supabase/googleSession";

const AUTH_COOKIE_NAME = "sb-google-session-fixture";
const SUPABASE_REFRESH_TOKEN = "supabase-refresh-fixture";
const PROVIDER_TOKEN = "provider-access-must-not-persist";
const PROVIDER_REFRESH_TOKEN = "provider-refresh-must-not-persist";

function dummyJwt() {
  const segment = (value: object | string) =>
    Buffer.from(
      typeof value === "string" ? value : JSON.stringify(value),
    ).toString("base64url");

  return [
    segment({ alg: "none", typ: "JWT" }),
    segment({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3_600,
      sub: "fixture-user",
    }),
    segment("fixture-signature"),
  ].join(".");
}

function createFixtureHarness({ failValidation = false } = {}) {
  const accessToken = dummyJwt();
  const user = {
    id: "fixture-user",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { fixture_padding: "x".repeat(3_600) },
  };
  const cookieJar = new Map<string, string>();
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith("/token?grant_type=pkce") && init?.method === "POST") {
        return Response.json({
          access_token: accessToken,
          expires_in: 3_600,
          provider_refresh_token: PROVIDER_REFRESH_TOKEN,
          provider_token: PROVIDER_TOKEN,
          refresh_token: SUPABASE_REFRESH_TOKEN,
          token_type: "bearer",
          user,
        });
      }

      if (url.endsWith("/user")) {
        if (failValidation) {
          return Response.json(
            { message: "fixture validation failure" },
            { status: 503 },
          );
        }
        return Response.json(user);
      }

      if (url.endsWith("/logout?scope=local")) {
        if (failValidation) {
          return Response.json(
            { message: "fixture logout failure" },
            { status: 503 },
          );
        }
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fixture request: ${url}`);
    },
  );
  const createClient = () =>
    createServerClient(
      "https://fixture-project.supabase.invalid",
      "publishable-fixture-key",
      {
        cookieOptions: { name: AUTH_COOKIE_NAME },
        cookies: {
          getAll: () =>
            Array.from(cookieJar, ([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, options, value } of cookiesToSet) {
              if (options.maxAge === 0) {
                cookieJar.delete(name);
              } else {
                cookieJar.set(name, value);
              }
            }
          },
        },
        global: { fetch: fetchMock },
      },
    );

  return { accessToken, cookieJar, createClient };
}

async function initiateGoogleFlow(
  supabase: ReturnType<ReturnType<typeof createFixtureHarness>["createClient"]>,
) {
  const initiation = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://fixture-app.invalid/auth/confirm",
      skipBrowserRedirect: true,
    },
  });
  expect(initiation.error).toBeNull();
}

describe("Google session cookies", () => {
  it("removes provider tokens from the final serialized SSR auth cookie", async () => {
    const { accessToken, cookieJar, createClient } = createFixtureHarness();
    const supabase = createClient();
    await initiateGoogleFlow(supabase);

    const exchange = await exchangeGoogleCodeForProviderFreeSession(
      supabase.auth,
      "google-code-fixture",
    );
    expect(exchange.error).toBeNull();

    const combinedCookie = await combineChunks(AUTH_COOKIE_NAME, (name) =>
      cookieJar.get(name),
    );
    expect(combinedCookie).toBeTruthy();
    expect(
      Array.from(cookieJar.keys()).filter((name) =>
        name.startsWith(`${AUTH_COOKIE_NAME}.`),
      ).length,
    ).toBeGreaterThan(1);

    const encodedCookie = combinedCookie as string;
    expect(encodedCookie.startsWith("base64-")).toBe(true);
    const session = JSON.parse(
      stringFromBase64URL(encodedCookie.slice("base64-".length)),
    ) as Record<string, unknown>;

    expect(session).not.toHaveProperty("provider_token");
    expect(session).not.toHaveProperty("provider_refresh_token");
    expect(session.access_token).toBe(accessToken);
    expect(session.refresh_token).toBe(SUPABASE_REFRESH_TOKEN);

    const reopened = createClient();
    const reopenedSession = await reopened.auth.getSession();
    expect(reopenedSession.error).toBeNull();
    expect(reopenedSession.data.session?.access_token).toBe(accessToken);
    expect(reopenedSession.data.session?.refresh_token).toBe(
      SUPABASE_REFRESH_TOKEN,
    );
    expect(reopenedSession.data.session).not.toHaveProperty("provider_token");
    expect(reopenedSession.data.session).not.toHaveProperty(
      "provider_refresh_token",
    );
  });

  it("clears the provider-bearing cookie when validation fails", async () => {
    const { cookieJar, createClient } = createFixtureHarness({
      failValidation: true,
    });
    const supabase = createClient();
    await initiateGoogleFlow(supabase);

    const exchange = await exchangeGoogleCodeForProviderFreeSession(
      supabase.auth,
      "google-code-fixture",
    );
    expect(exchange.error).toBeTruthy();

    const combinedCookie = await combineChunks(AUTH_COOKIE_NAME, (name) =>
      cookieJar.get(name),
    );
    expect(combinedCookie).toBeNull();

    const reopened = createClient();
    const reopenedSession = await reopened.auth.getSession();
    expect(reopenedSession.error).toBeNull();
    expect(reopenedSession.data.session).toBeNull();
  });
});
