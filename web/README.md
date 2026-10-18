# Locum Manager PWA

This directory contains the production-target, offline-first Locum Manager web
app. It is a Next.js PWA backed by Supabase Auth, Postgres Row Level Security,
private invoice storage, and an IndexedDB outbox for resilient offline work.

This public repository contains the web/PWA snapshot only. The original Expo
prototype and unpublished Luna integration remain outside this repository.
See the root README for the publication scope and current-readiness limitations.

## Local setup

Requirements:

- Node.js 20.9 or newer and npm
- Docker and the Supabase CLI for database tests and a local backend

Install the web dependencies:

```sh
cd web
npm ci
cp .env.example .env.local
```

Replace only the two public Supabase placeholders in `.env.local`. Never add a
service-role key, database password, tunnel token, or account password to this
directory. Environment files other than `.env.example` are ignored by Git.

Google Calendar is disabled locally by default. Leave
`GOOGLE_CALENDAR_ENABLED=false` and all Calendar server-only values empty unless
you are operating an explicitly authorized server environment. Never add fake or
real Calendar client secrets, token-encryption keys, service-role values, OAuth
codes, cookies, or tokens to local files, tests, browser code, screenshots, or
logs. The checked-in example contains names and empty values only.

From the repository root, start the local Supabase stack and apply migrations:

```sh
supabase start
supabase db reset
```

Create a fictional local user through Supabase Studio, then start the app:

```sh
cd web
npm run dev
```

Open `http://localhost:3000/login`. Local email is captured by the Supabase
development mail viewer; it is not delivered to a real inbox.

## Invite-only Google authentication

Google authentication is hidden unless `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
Keep it false until the target Supabase project has Google configured and new user
sign-ups disabled. Create fictional local and acceptance users through the
Supabase admin invitation flow; the public application has no self-service sign-up.

Google's client secret belongs only in Supabase's provider settings. Do not add it
to `.env.local`, the Next.js container, Docker configuration, Git, tests, or logs.

## Optional Google Calendar connection

Calendar connection is independent of Google authentication. An authorized
server deployment uses a dedicated OAuth Web client, the exact production
callback
`https://locum-manager.linktheworlds.co.uk/api/google-calendar/callback`, and only
`https://www.googleapis.com/auth/calendar.app.created` with offline access and
contextual consent. All Calendar variables are server-only and the token key
requires a protected recovery copy outside both the artifact and database.

The connection is one-way from Locum Manager to one dedicated calendar. It does
not access Gmail or other calendars, import changes, sync demo records, or send
financial, invoice, payment, tax, receipt, or notes data. Google consent and live
fictional-account acceptance must use a full system browser, never an embedded
WebView. Do not inspect credentials, cookies, codes, or tokens.

The public OAuth legal documents are
`https://locum-manager.linktheworlds.co.uk/privacy` and
`https://locum-manager.linktheworlds.co.uk/terms`. Configure those exact URLs in
Google Auth Platform Branding before publishing or submitting the OAuth app for
verification. The documents must remain accessible without authentication.

## Quality gate

Run the database and web gates before deployment:

```sh
supabase db reset
supabase test db
cd web
npm ci
npm audit --omit=dev
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test
```

The default Playwright suite uses fictional owners and a development-only auth
guard. The bypass requires an exact test value and is disabled in production.

The live acceptance tests are opt-in and mutate only an explicitly authorized,
disposable acceptance account. Pass their values through the shell or CI secret
store, never a file:

```sh
LOCUM_E2E_LIVE=1 \
LOCUM_E2E_BASE_URL=https://YOUR_AUTHORIZED_ACCEPTANCE_DOMAIN \
LOCUM_E2E_USER_EMAIL=FROM_SECRET_STORE \
LOCUM_E2E_USER_PASSWORD=FROM_SECRET_STORE \
npx playwright test e2e/auth.spec.ts e2e/invoice-lifecycle.spec.ts
```

See `docs/runbooks/pwa-deployment.md` for the release checklist and
`docs/runbooks/pwa-recovery.md` for incident and data-recovery steps.

The release checklist includes an owner-controlled backup, two-account private
receipt Storage isolation, exact 5 April/6 April tax-boundary checks, offline
receipt recovery, demo seed/delete preservation, and a web-image-only rollback.
Do not deploy or run the public acceptance gate without owner-authorized
fictional accounts, target access, and a physical-iPhone check. Use your own
deployment; the original production service is not a public test environment.

## Privacy boundary

- Patient data is out of scope and must never be entered.
- Account rows are isolated by `owner_id` and RLS.
- Bank details are encrypted in the browser and are never stored as plaintext.
- Issued invoice PDFs use a private storage bucket and owner-scoped paths.
- Authentication tokens are excluded from encrypted backups.
- Backups include only allowed record metadata; queued receipt blobs, receipt
  bytes, signed URLs, and tokens are excluded.
- Private page caches are deleted at sign-out and are never shared between owner
  identities in the same browser profile.
