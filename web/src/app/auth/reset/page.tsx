import { PasswordResetForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default function PasswordResetPage() {
  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="reset-heading">
        <p className="eyebrow">Account recovery</p>
        <h1 id="reset-heading">Choose a new password</h1>
        <p className="landing-copy">
          Enter a new password for your Locum Manager account.
        </p>
        <PasswordResetForm />
      </section>
    </main>
  );
}
