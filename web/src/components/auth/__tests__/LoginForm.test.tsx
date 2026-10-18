import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/client";

import {
  LoginForm,
  PasswordResetForm,
  type AuthActions,
} from "../LoginForm";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

afterEach(cleanup);

function createActions(overrides: Partial<AuthActions> = {}): AuthActions {
  return {
    signInWithGoogle: vi.fn().mockResolvedValue({ ok: true }),
    updatePassword: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe("LoginForm", () => {
  it("offers only Google sign-in and no password controls", () => {
    render(<LoginForm actions={createActions()} googleAuthEnabled />);

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign in with password/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /forgot password/i }),
    ).not.toBeInTheDocument();
  });

  it("starts Google authentication and rejects backslash return paths", async () => {
    const user = userEvent.setup();
    const actions = createActions();

    render(
      <LoginForm
        actions={actions}
        googleAuthEnabled
        returnTo="/\\attacker.example/private"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(actions.signInWithGoogle).toHaveBeenCalledWith({
      returnTo: "/dashboard",
    });
  });

  it("shows a generic Google failure and restores the authentication controls", async () => {
    const user = userEvent.setup();
    const actions = createActions({
      signInWithGoogle: vi.fn().mockResolvedValue({ ok: false }),
    });

    render(<LoginForm actions={actions} googleAuthEnabled />);
    await user.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /google sign-in could not be completed/i,
    );
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeEnabled();
  });

  it("starts Supabase Google PKCE with the exact safe application callback", async () => {
    const user = userEvent.setup();
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockReturnValue({
      auth: { signInWithOAuth },
    } as never);

    render(<LoginForm googleAuthEnabled returnTo="/sessions?view=week" />);
    await user.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          `${window.location.origin}/auth/confirm` +
          "?provider=google&next=%2Fsessions%3Fview%3Dweek",
      },
    });
  });

  it("displays an expired-link notice supplied by the callback", () => {
    render(
      <LoginForm
        actions={createActions()}
        googleAuthEnabled
        initialNotice="That sign-in link has expired. Please request a new one."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/link has expired/i);
  });
});

describe("PasswordResetForm", () => {
  it("validates matching passwords and updates the authenticated account", async () => {
    const user = userEvent.setup();
    const actions = createActions();
    const onComplete = vi.fn();

    render(<PasswordResetForm actions={actions} onComplete={onComplete} />);

    await user.type(screen.getByLabelText(/^new password$/i), "new-secure-password");
    await user.type(screen.getByLabelText(/confirm new password/i), "different-password");
    await user.click(screen.getByRole("button", { name: /save new password/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/passwords must match/i);
    expect(actions.updatePassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/confirm new password/i));
    await user.type(
      screen.getByLabelText(/confirm new password/i),
      "new-secure-password",
    );
    await user.click(screen.getByRole("button", { name: /save new password/i }));

    expect(actions.updatePassword).toHaveBeenCalledWith({
      password: "new-secure-password",
    });
    expect(onComplete).toHaveBeenCalledWith("/dashboard");
  });
});
