import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/types/database";
import { relativeRedirect } from "@/lib/navigation/relativeRedirect";
import { safeReturnPath } from "@/lib/navigation/returnPath";

const AUTHENTICATED_PATH_PREFIXES = [
  "/api/sync",
  "/archive",
  "/dashboard",
  "/invoices",
  "/more",
  "/practices",
  "/sessions",
  "/settings",
];

const PUBLIC_LEGAL_PATHS = new Set(["/privacy", "/terms"]);

function isAuthenticatedPath(pathname: string) {
  return AUTHENTICATED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasDevelopmentE2EBypass(request: NextRequest) {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.LOCUM_E2E_AUTH_BYPASS === "responsive-shell" &&
    request.headers.get("x-locum-e2e-auth") === "responsive-shell"
  );
}

function copySessionResponse(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));

  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }

  return target;
}

export async function updateSession(request: NextRequest) {
  if (PUBLIC_LEGAL_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (hasDevelopmentE2EBypass(request)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (isAuthenticatedPath(request.nextUrl.pathname)) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "returnTo",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return relativeRedirect(`${loginUrl.pathname}${loginUrl.search}`);
    }

    return NextResponse.next();
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, options, value }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const pathname = request.nextUrl.pathname;

  if (!isAuthenticated && isAuthenticatedPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
    return copySessionResponse(
      response,
      relativeRedirect(`${loginUrl.pathname}${loginUrl.search}`),
    );
  }

  if (isAuthenticated && pathname === "/login") {
    const requestedPath = request.nextUrl.searchParams.get("returnTo");
    const destination = safeReturnPath(requestedPath);
    return copySessionResponse(
      response,
      relativeRedirect(destination),
    );
  }

  return response;
}
