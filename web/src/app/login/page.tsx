import { LoginForm } from "@/components/auth/LoginForm";
import { PublicLegalLinks } from "@/components/legal/PublicLegalLinks";
import { safeReturnPath } from "@/lib/navigation/returnPath";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    returnTo?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const googleAuthEnabled =
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const parameters = await searchParams;
  const rawReturnTo = Array.isArray(parameters.returnTo)
    ? parameters.returnTo[0]
    : parameters.returnTo;
  const error = Array.isArray(parameters.error)
    ? parameters.error[0]
    : parameters.error;
  const initialNotice =
    error === "expired-link"
      ? "That sign-in link has expired. Please request a new one."
      : error === "google-sign-in"
        ? "Google sign-in could not be completed. Please try again."
        : undefined;

  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="login-heading">
        <p className="eyebrow">Secure GP access</p>
        <h1 id="login-heading">Sign in</h1>
        <p className="landing-copy">
          {googleAuthEnabled
            ? "Continue with your Google account."
            : "Google sign-in is not available right now."}
        </p>
        <LoginForm
          googleAuthEnabled={googleAuthEnabled}
          returnTo={safeReturnPath(rawReturnTo)}
          initialNotice={initialNotice}
        />
        <PublicLegalLinks />
      </section>
    </main>
  );
}
