"use client";

import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { safeReturnPath } from "@/lib/navigation/returnPath";

export type AuthResult = { ok: boolean };

export type AuthActions = {
  signInWithGoogle(input: { returnTo: string }): Promise<AuthResult>;
  updatePassword(input: { password: string }): Promise<AuthResult>;
};

function currentOrigin() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

const defaultActions: AuthActions = {
  async signInWithGoogle({ returnTo }) {
    try {
      const callback = new URL("/auth/confirm", currentOrigin());
      callback.searchParams.set("provider", "google");
      callback.searchParams.set("next", safeReturnPath(returnTo));
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      return { ok: !error };
    } catch {
      return { ok: false };
    }
  },
  async updatePassword({ password }) {
    try {
      const { error } = await createClient().auth.updateUser({ password });
      return { ok: !error };
    } catch {
      return { ok: false };
    }
  },
};

type LoginFormProps = {
  actions?: AuthActions;
  googleAuthEnabled?: boolean;
  initialNotice?: string;
  returnTo?: string | null;
};

export function LoginForm({
  actions = defaultActions,
  googleAuthEnabled = false,
  initialNotice,
  returnTo,
}: LoginFormProps) {
  const [message, setMessage] = useState(initialNotice ?? "");
  const [messageKind, setMessageKind] = useState<"error" | "status">(
    initialNotice ? "error" : "status",
  );
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setMessage("");
    setBusy(true);
    const result = await actions.signInWithGoogle({
      returnTo: safeReturnPath(returnTo),
    });
    setBusy(false);

    if (!result.ok) {
      setMessageKind("error");
      setMessage(
        "Google sign-in could not be completed. Please try again.",
      );
    }
  }

  return (
    <div className="auth-form">
      {message ? (
        <p role={messageKind === "error" ? "alert" : "status"}>{message}</p>
      ) : null}

      <div className="auth-form__actions">
        {googleAuthEnabled ? (
          <button
            className="auth-form__google"
            type="button"
            disabled={busy}
            onClick={signInWithGoogle}
          >
            <span className="auth-form__google-mark" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
        ) : (
          <p role="status">Google sign-in is not available right now.</p>
        )}
      </div>
    </div>
  );
}

type PasswordResetFormProps = {
  actions?: AuthActions;
  onComplete?: (returnTo: string) => void;
};

export function PasswordResetForm({
  actions = defaultActions,
  onComplete = (destination) => window.location.assign(destination),
}: PasswordResetFormProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Passwords must match.");
      return;
    }

    setBusy(true);
    const result = await actions.updatePassword({ password });
    setBusy(false);

    if (!result.ok) {
      setMessage("We could not update your password. Request a new reset link.");
      return;
    }

    onComplete("/dashboard");
  }

  return (
    <form onSubmit={submit} noValidate>
      <div>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      {message ? <p role="alert">{message}</p> : null}
      <button type="submit" disabled={busy}>
        Save new password
      </button>
    </form>
  );
}
