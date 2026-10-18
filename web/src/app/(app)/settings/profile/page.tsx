import Link from "next/link";

import { ProfileForm } from "@/features/settings/ProfileForm";
import { ProfessionPreference } from "@/features/settings/ProfessionPreference";

export default function ProfileSettingsPage() {
  return (
    <section className="record-page record-page--form" aria-labelledby="profile-title">
      <Link className="record-page__back" href="/more">← My account</Link>
      <p className="eyebrow">Secure settings</p>
      <h1 id="profile-title">Profile and payments</h1>
      <ProfessionPreference />
      <p className="record-form__notice">Your bank details are encrypted and available after your normal account sign-in.</p>
      <ProfileForm />
    </section>
  );
}
