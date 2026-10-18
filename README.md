# Locum GP / Locum Manager

An offline-first web app for managing locum work: practices, work sessions,
invoices, expenses, receipt capture, mileage and bookkeeping summaries.

Built with Next.js, React, TypeScript, Supabase and Dexie. It can be installed
as a progressive web app on an iPhone or other supported device.

## Publication scope

This is a clean public source snapshot of the 5 September 2026 web release,
with its database migration baseline and tests. It is not a new production
deployment. The original private Git history, operational handoffs, credentials,
database contents and real receipts are not included.

Receipt recognition in this snapshot runs locally using Tesseract. Unreleased
Luna integration and the separate Expo prototype are not included.

This historical snapshot is not a claim of current dependency security or
production readiness. Audit and update dependencies, test the migrations in an
isolated database, and complete the release checks before deploying your own
instance. Do not point local tests at the original production service.

Publication checks on 18 October 2026: 958 unit tests and TypeScript checks
passed; Gitleaks found no secrets in the published source/history. The production
dependency audit reported **one critical and two high findings**, affecting
`next`, `sharp` and `source-map-js`. This snapshot needs dependency remediation
and fresh deployment validation before being used for a new production instance.
A production build, browser acceptance and fresh database test run were not
performed as part of this source publication.

## Features

- Practice records, session tracking and invoice generation.
- Expense categories, mileage and private receipt attachments.
- Local receipt OCR with editable suggestions and manual entry.
- Offline records and queued synchronization with account isolation.
- Optional one-way Google Calendar integration.
- UK bookkeeping summaries; **this app does not submit returns to HMRC**.

## Getting started

Use Node.js 20.9 or newer, npm, and a separate Supabase project. Docker and the
Supabase CLI are needed for the isolated local database and database tests.

```sh
git clone https://github.com/daviddaryl-sys/locum-gp.git
cd locum-gp/web
npm ci
cp .env.example .env.local
```

Set the public Supabase URL and publishable key for **your own** project. The
snapshot's sign-in screen uses Google: configure Google authentication in your
own Supabase project and enable `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` after testing
your allowed users and redirect URLs. With the flag disabled, Google sign-in is
unavailable. Never use real patient data or production credentials for testing.

For an isolated local backend, run from the repository root:

```sh
supabase start
supabase db reset
```

`supabase db reset` is destructive to the local development database. Do not
link this checkout to an existing production project or apply migrations there
without an independently reviewed migration and backup plan.

Then run `npm run dev` in `web/` and open http://localhost:3000.
Optional Calendar and payment-encryption secrets must be injected server-side
from a secret store, never committed or exposed with a `NEXT_PUBLIC_` prefix.

## Checks

```sh
cd web
npm test
npm run typecheck
npm run lint
npm audit --omit=dev
npm run build
```

Database checks: `supabase test db` against an isolated local stack. Browser
checks: `npx playwright test` in `web/`; live-account tests are opt-in and need
separate authorization. See [web setup](web/README.md) and the historical
[deployment checklist](docs/runbooks/pwa-deployment.md).

## Privacy and licensing

Patient data is out of scope. Real financial records, receipts, account tokens,
backups, keys and environment files must never be committed. Row-level security
and private storage must remain enabled on any deployment.

No open-source license has been selected for the application source. Public
availability does not itself grant a general license to reuse or redistribute
it. Third-party dependencies retain their respective licenses.
