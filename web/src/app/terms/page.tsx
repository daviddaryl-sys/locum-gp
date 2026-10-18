import type { Metadata } from "next";

import { PublicLegalPage } from "@/components/legal/PublicLegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | Locum Manager",
  description: "Terms governing professional use of Locum Manager.",
};

export default function TermsPage() {
  return (
    <PublicLegalPage eyebrow="Using the service" title="Terms of Service">
      <p className="legal-notice">
        These terms govern your use of Locum Manager. They are an owner-reviewed
        operational draft and are not a substitute for independent legal advice.
      </p>

      <section>
        <h2>1. Operator and acceptance</h2>
        <p>
          Locum Manager is operated by David Despres. By using the service, you
          agree to these terms. Questions may be sent to{" "}
          <a href="mailto:ai@daviddespres.co.uk">ai@daviddespres.co.uk</a>.
        </p>
      </section>

      <section>
        <h2>2. Eligibility and account security</h2>
        <p>
          You must be at least 18 years old and use Locum Manager only for lawful
          professional or business administration. Keep registration details
          accurate, protect your credentials and report suspected misuse promptly.
        </p>
      </section>

      <section>
        <h2>3. Permitted use</h2>
        <p>
          You may use Locum Manager to administer practices, locum sessions,
          invoices, expenses, receipts, encrypted backups and optional Google
          Calendar synchronisation. You must not enter patient-identifiable or
          clinical information, interfere with security, access another account,
          use the service unlawfully or upload malicious material.
        </p>
      </section>

      <section>
        <h2>4. Your professional responsibilities</h2>
        <p>
          You remain responsible for the accuracy and lawfulness of your records,
          invoices, tax treatment, retention decisions, professional obligations
          and business decisions. Locum Manager is an administrative tool and
          does not provide medical, legal, tax or accounting advice.
        </p>
        <p>
          Tax &amp; MTD prepares figures for your review. It does not file or submit
          information to HMRC. Obtain professional advice where needed.
        </p>
      </section>

      <section>
        <h2>5. Google Calendar</h2>
        <p>
          Google Calendar connection is optional and one-way from Locum Manager
          to one dedicated application-created calendar. Locum Manager remains
          authoritative. Changes made directly in Google are not imported.
        </p>
        <p>
          Synchronisation may be delayed, fail temporarily or require you to
          reconnect. Disconnecting does not remove existing Google Calendar
          events; you remain responsible for removing them if desired.
        </p>
      </section>

      <section>
        <h2>6. Availability, offline use and backups</h2>
        <p>
          Supported records may work offline and synchronise later, but we do not
          guarantee uninterrupted availability, loss-free synchronisation or
          compatibility with every device. Maintain a current encrypted backup
          and protect its passphrase.
        </p>
      </section>

      <section>
        <h2>7. Third-party services</h2>
        <p>
          Locum Manager depends on providers including Supabase, Google and
          necessary hosting infrastructure. Their availability, terms and acts
          are outside our direct control. Optional Google features also require
          compliance with the applicable Google terms.
        </p>
      </section>

      <section>
        <h2>8. Ownership</h2>
        <p>
          The service, software and branding remain owned by the operator or
          licensors. You retain your rights in the data you enter and grant only
          the permissions needed to operate the service for you.
        </p>
      </section>

      <section>
        <h2>9. Suspension, stopping use and deletion</h2>
        <p>
          We may limit access where reasonably necessary for security, unlawful
          use or a material breach. You may stop using the service and request
          account deletion by email, subject to information that must lawfully be
          retained and routine protected-backup expiry.
        </p>
      </section>

      <section>
        <h2>10. Responsibility when things go wrong</h2>
        <p>
          Nothing in these terms excludes liability that cannot lawfully be
          excluded, including liability for fraud or for death or personal injury
          caused by negligence. Subject to that, we are not responsible for loss
          caused by inaccurate user data, prohibited use, failure to maintain a
          backup, unsupported devices or third-party outages outside our
          reasonable control. Mandatory consumer rights remain unaffected.
        </p>
      </section>

      <section>
        <h2>11. Changes and governing law</h2>
        <p>
          We may update these terms by revising the effective date and providing
          an in-service notice when a material change requires one. If one term
          is invalid, the others continue. These terms are governed by the laws
          of England and Wales, subject to any mandatory rights that apply where
          you live.
        </p>
      </section>
    </PublicLegalPage>
  );
}
