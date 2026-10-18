import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../page";

vi.mock("@/components/auth/LoginForm", () => ({
  LoginForm: ({
    googleAuthEnabled,
    initialNotice,
    returnTo,
  }: {
    googleAuthEnabled?: boolean;
    initialNotice?: string;
    returnTo?: string;
  }) => (
    <>
      {googleAuthEnabled ? <button>Continue with Google</button> : null}
      {initialNotice ? <p role="alert">{initialNotice}</p> : null}
      <output data-testid="return-to">{returnTo}</output>
    </>
  ),
}));

const originalGoogleFlag = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
});

afterEach(() => {
  cleanup();
  if (originalGoogleFlag === undefined) {
    delete process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = originalGoogleFlag;
  }
});

async function renderLogin(
  searchParams: { error?: string; returnTo?: string } = {},
) {
  render(await LoginPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("LoginPage", () => {
  it("fails closed when Google authentication is not explicitly enabled", async () => {
    await renderLogin();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Google authentication only for the exact enabled value", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = "true";
    await renderLogin();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });

  it("does not link back to the public landing page", async () => {
    await renderLogin();

    expect(
      screen.queryByRole("link", { name: /back to locum manager/i }),
    ).not.toBeInTheDocument();
  });

  it("does not describe the removed one-time-link option", async () => {
    await renderLogin();

    expect(screen.queryByText(/one-time link/i)).not.toBeInTheDocument();
  });

  it("keeps the public legal documents available before sign-in", async () => {
    await renderLogin();

    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("link", { name: "Terms of Service" }),
    ).toHaveAttribute("href", "/terms");
  });

  it("shows a generic notice for Google callback failures", async () => {
    await renderLogin({ error: "google-sign-in" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google sign-in could not be completed. Please try again.",
    );
  });

  it("passes malformed backslash return paths to the form as the dashboard fallback", async () => {
    await renderLogin({ returnTo: "/\\attacker.example/private" });

    expect(screen.getByTestId("return-to")).toHaveTextContent("/dashboard");
  });
});
