import type { Metadata } from "next";

import { PublicLegalPage } from "@/components/legal/PublicLegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Locum Manager",
  description:
    "How Locum Manager handles account, business and optional Google Calendar data.",
};

export default function PrivacyPage() {
  return (
    <PublicLegalPage eyebrow="Your data and choices" title="Privacy Policy">
      <p className="legal-notice">
        Locum Manager is a business-administration tool for GP locums. It is not
        designed for patient records, and you must not enter patient-identifiable
        or clinical information.
      </p>

      <section>
        <h2>1. Who is responsible</h2>
        <p>
          David Despres is the operator and data controller for Locum Manager.
          For privacy questions or requests, email{" "}
          <a href="mailto:ai@daviddespres.co.uk">ai@daviddespres.co.uk</a>.
        </p>
      </section>

      <section>
        <h2>2. Information we handle</h2>
        <p>Depending on the features you use, Locum Manager handles:</p>
        <ul>
          <li>account identity, authentication and security metadata;</li>
          <li>your GP profile, practices, sessions and working arrangements;</li>
          <li>invoices, payment status, expenses and receipt metadata;</li>
          <li>private uploaded receipt files and encrypted bank settings;</li>
          <li>synchronisation, backup and operational error metadata; and</li>
          <li>optional Google Calendar connection and event-link metadata.</li>
        </ul>
      </section>

      <section>
        <h2>3. Why we use it</h2>
        <p>
          We use information to provide your account and requested features,
          secure and synchronise records, support and improve reliability, and
          meet applicable legal obligations. Core account processing is needed
          to provide the service. Security and reliability processing supports
          our legitimate interests in operating it safely. Processing required
          by law is based on the relevant legal obligation.
        </p>
        <p>
          Google Calendar is optional. We use its connection data only after you
          choose to connect it, and you can withdraw that choice by disconnecting.
        </p>
      </section>

      <section>
        <h2>4. Where information is stored</h2>
        <p>
          Supported working records may be stored offline in your browser and
          synchronised later. Owner-scoped cloud records and private files use
          Supabase-backed authentication, database and storage services. Bank
          details are encrypted before storage and are decrypted only for an
          authenticated request while you use invoicing.
        </p>
        <p>
          Necessary infrastructure providers process only the information needed
          to operate, secure and support the service. Where information is
          processed internationally, we use the protections required by
          applicable data-protection law.
        </p>
      </section>

      <section>
        <h2>5. Sharing and cookies</h2>
        <p>
          We do not sell personal data, use it for advertising or provide it to
          data brokers. Information is shared only with providers needed to run
          Locum Manager, when you direct an optional integration, for security,
          or where the law requires it.
        </p>
        <p>
          The service may use strictly necessary authentication and security
          cookies when you sign in. These public legal pages add no analytics,
          advertising trackers, forms or optional cookies.
        </p>
      </section>

      <section>
        <h2>6. Google Calendar</h2>
        <p>
          Locum Manager requests only{" "}
          <code>https://www.googleapis.com/auth/calendar.app.created</code>.
          After you consent, it creates one dedicated secondary calendar named
          Locum Manager and creates, updates or deletes only events managed in
          that application-created calendar.
        </p>
        <p>
          Managed events are limited to practice name, session date, start and
          end time, practice address, cancellation status and a fixed Locum
          Manager marker. Locum Manager does not inspect Gmail or list or import
          other calendars. It does not perform two-way sync or send rates,
          income, invoices, payments, tax, receipts, notes, owner identifiers or
          credentials to Google Calendar.
        </p>
        <p>
          The refresh token is encrypted server-side. Persistent event links and
          jobs retain opaque provider identifiers and operational metadata, not
          event payloads. Google user data is used only for the visible Calendar
          sync feature and is not sold, used for advertising or read by humans
          except where strictly necessary for security or law.
        </p>
        <p>
          Locum Manager&apos;s use and transfer of information received from Google
          APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          Disconnecting stops future Google work, removes the encrypted refresh
          token and attempts to revoke provider access. Locum Manager retains
          owner-scoped opaque calendar and event identifiers, connection status
          and sync timestamps so reconnecting the same account can resume
          without duplicates. Existing events remain in your Google Calendar
          until you remove them.
        </p>
      </section>

      <section>
        <h2>7. Retention and deletion</h2>
        <p>
          We keep records while needed to provide your account and meet
          applicable obligations. Email us to request access, correction, export
          or deletion. Deletion may not immediately remove information that must
          be retained by law or that remains in a routine protected backup until
          that backup expires.
        </p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          Locum Manager uses account isolation, private storage, encryption
          boundaries, encrypted backups and sign-out cache clearing. No system
          can guarantee absolute security, so protect your credentials and
          report suspected misuse promptly.
        </p>
      </section>

      <section>
        <h2>9. Your UK privacy rights</h2>
        <p>
          Depending on the circumstances, you may request access, correction,
          erasure, restriction, portability or object to processing. You may
          also complain to the UK Information Commissioner&apos;s Office. Contact us
          first if you would like help exercising a right.
        </p>
      </section>

      <section>
        <h2>10. Changes</h2>
        <p>
          We will update the effective date when this policy changes and will
          provide an in-service notice when a material change requires one.
        </p>
      </section>
    </PublicLegalPage>
  );
}
