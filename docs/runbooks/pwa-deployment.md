# Locum Manager PWA deployment runbook

This is historical release guidance. The public snapshot includes local receipt
OCR only; the unpublished Luna assistant is not included. References to the
original deployment are context, not permission to access or change that service.
Use your own isolated project and deployment settings.

Status: implementation complete; external deployment acceptance is not yet
authorized or evidenced.

## MTD-ready bookkeeping release (2026-08-04)

This paired database and web release adds HMRC expense classifications,
allowable-use percentages, invoice payment-received dates, cumulative quarterly
bookkeeping totals, and accountant JSON/CSV exports. Apply
`202608040001_mtd_ready_bookkeeping.sql` before promoting the matching web
artifact. The migration is additive, but the web release depends on its new
columns; do not promote only one half of the pair.

The release prepares digital records only. It does **not** authenticate with,
connect to, or submit an update to HMRC. The Tax & MTD screen and exports must
continue to say **Not submitted to HMRC**. A future direct-submission feature
requires separate HMRC production credentials, fraud-prevention headers,
software recognition, user consent, and its own acceptance evidence.

Before promotion, run the complete checks in section 1 and verify specifically:

- paid invoices without a payment-received date are flagged instead of counted;
- demo records and reimbursed expenses are excluded from tax totals and exports;
- partial business-use expenses use the stored allowable percentage;
- JSON/CSV exports contain bookkeeping fields only, with no receipt object keys,
  notes, patient information, credentials, or submission claim;
- `/tax-mtd` works at iPhone width and remains available after the PWA cache
  upgrade (`locum-manager-shell-v6`, `locum-manager-private-pages-v5`).

This runbook separates repeatable technical checks from actions that require an
owner-controlled Supabase account, Cloudflare account, domain choice, credentials,
or physical iPhone. Never invent those values and never commit them.

## Standalone demo-data release (2026-08-03)

This web-only release adds an explicit **More → Load demo data** action. It
creates 11 clearly labelled fictional practices, eight sessions and six
illustrative invoices in the signed-in owner's existing offline store and sync
outbox. Loading is idempotent; **Remove demo data** targets only the exact
owner-scoped fixture IDs and refuses removal when a user record depends on one.

The release requires no Supabase migration and includes no Expenses feature.
Do not deploy any database change with it. The rollback boundary is the prior
web container and build artifact; retain both until the public login, Google
button, relative authentication callback, More controls and PWA cache upgrade
have been verified. The service worker cache names for this release are
`locum-manager-shell-v4` and `locum-manager-private-pages-v3`.

## Required owner inputs

Obtain explicit owner authorization before any of the following:

1. Choosing the exact owner-supplied HTTPS private acceptance origin or its
   hosting path.
2. Creating or changing the private acceptance hostname, owner-only access
   policy, or DNS. Cloudflare Access is one possible access mechanism, not an
   authorization to use it.
3. Changing the Supabase Auth Site URL or redirect allow-list.
4. Enabling or changing the Google provider, sign-up setting, or deployment
   flag.
5. Using a disposable Supabase acceptance project, fictional accounts, a
   separate production project, or a production rollout/rollback window.

Do not invent a hostname, domain, account, credential, or access-control
provider. A placeholder in this runbook is an instruction to stop for the
owner-supplied value; it is not a configuration value.

Ordinary browser records and the admin health projection use the signed-in
user's session and RLS. The optional Google Calendar server routes additionally
require a service-role credential for their server-only tables. When Calendar
is disabled, do not configure those server-only values. When it is authorized,
inject the service-role credential only through protected runtime secret storage;
never provide it to browser code, a public environment variable, the image,
logs, screenshots, or this runbook.

## 1. Verify the release candidate

Use a clean, detached checkout of the exact full Git commit SHA reviewed for
this release. Do not substitute a moving branch name (including
`codex/locum-manager-mvp`) for that reviewed commit. Record the reviewed SHA in
the release evidence, then verify it before running any gate:

```sh
REVIEWED_RELEASE_COMMIT=OWNER_REVIEWED_FULL_GIT_SHA
git rev-parse --verify "${REVIEWED_RELEASE_COMMIT}^{commit}"
git checkout --detach "$REVIEWED_RELEASE_COMMIT"
test "$(git rev-parse HEAD)" = "$REVIEWED_RELEASE_COMMIT"
git status --short
```

Only continue when the status output is empty and `HEAD` is the exact reviewed
commit. Run:

```sh
supabase start
supabase db reset
supabase test db
cd web
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test --project=chromium
```

Stop the disposable local Supabase stack after the database checks. A green
local gate does not authorize deployment and does not replace the live tests.

### Google Calendar release boundary

Google Calendar connection is separate from Supabase Google sign-in. Before an
authorized Calendar rollout:

1. Back up the target database and record the backup reference without copying
   database contents into release notes. Apply the additive Calendar migration
   only to the reviewed target.
2. Create a dedicated OAuth Web client for Calendar. Its exact production
   callback is
   `https://locum-manager.linktheworlds.co.uk/api/google-calendar/callback`.
   Configure no wildcard, embedded-WebView, or alternate callback.
3. Request only
   `https://www.googleapis.com/auth/calendar.app.created`, with offline access
   and contextual consent when the owner chooses **Connect Google Calendar**.
4. Provide `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_CLIENT_ID`,
   `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_ORIGIN`,
   `GOOGLE_CALENDAR_TOKEN_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` only through the
   protected server runtime. The token-encryption key must have a protected,
   access-controlled recovery copy outside the artifact and database. Never log,
   print, export, or place any value in source control.
5. Build once from the reviewed commit, record its immutable artifact digest,
   and promote that exact artifact. Keep the previously verified container
   stopped but available for rollback until all acceptance gates pass.
6. Use only owner-authorized fictional accounts for live acceptance. Complete
   Google consent in a full system browser; never attempt OAuth inside an
   embedded WebView and never inspect credentials, authorization codes, cookies,
   or tokens.

Acceptance must prove the in-app offline Calendar, new future real sessions,
cancelled and deleted projections, retry recovery, reconnect-required behavior,
disconnect, and the private no-store/cache boundary. Disconnect performs
best-effort provider revocation, removes the stored refresh token, and stops
future work. It leaves the dedicated Calendar and existing managed events
unchanged; refresh-token invalidation instead produces reconnect-required.

Calendar non-goals are equally binding: no Gmail access, no inspection or
selection of other calendars, no two-way import, no demo sessions, and no rates,
income, invoices, payments, notes, tax, receipts, owner IDs, or credentials in
events. A rollback changes only the web artifact to the retained container and
leaves the additive Calendar tables dormant. Do not reverse the migration or
delete Calendar rows as a rollback shortcut.

## 2. Prepare the Supabase acceptance project

Use an empty, disposable project. Link and review the target before applying any
change:

```sh
supabase link --project-ref YOUR_ACCEPTANCE_PROJECT_REF
supabase db push --dry-run
supabase db push
```

Verify in the target:

- every business table has RLS enabled;
- owner A cannot read, update, or delete owner B's rows;
- invoice issuance allocates one owner/year sequence under concurrency;
- issued invoices and issued line items reject financial mutation;
- `invoice-artifacts` is private and owner-scoped;
- the admin health view contains only approved operational fields;
- no patient, bank plaintext, auth token, or secret appears in logs or rows.

### Invite-only Google authentication

The exact owner-supplied HTTPS private acceptance origin is the only place to
test Google before public enablement. It must be protected by an owner-only
access policy; Cloudflare Access is an example, not a pre-authorized choice.
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true only on that private acceptance deployment.
The public production deployment remains false until invited and uninvited
acceptance evidence is complete.

After the owner has authorized the named changes, the owner performs these
steps. No agent should make them from this runbook:

1. Configure the private acceptance hostname, HTTPS, and owner-only access
   policy. Confirm that access is denied to people outside the owner-approved
   policy before exposing the application login page.
2. Configure the acceptance artifact with
   `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`; keep the public production artifact
   at `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`.
3. In the owner-controlled Google Cloud project, configure the external audience,
   app name `Locum Manager`, support email, `linktheworlds.co.uk` authorized
   domain, and owner-approved public homepage, privacy-policy, and terms URLs.
   Create one OAuth Web application client with the exact selected-project
   redirect URI, which remains
   `https://imskaggarofqlqssoxow.supabase.co/auth/v1/callback`. The Google
   redirect URI is the Supabase callback, not the private acceptance origin.
4. Transfer the client ID and secret directly from Google Cloud to Supabase
   Authentication > Sign In / Providers > Google. Do not copy them into the
   repository, Next.js environment, Docker configuration, logs, screenshots,
   or chat.
5. In Supabase, keep sign-up disabled. Set the Auth Site URL to the exact
   owner-approved acceptance origin and add only the exact owner-approved
   acceptance callback destinations for `/auth/confirm` and `/auth/reset` to
   the redirect allow-list. Do not use wildcards and do not add a placeholder,
   public production callback, or any other redirect destination.

#### Owner-performed fictional-account acceptance checks

The owner performs and records these checks using two fictional accounts, without
recording their addresses or credentials in this repository:

1. Invite the fictional invited account through Supabase Authentication > Users,
   then use Google at the private acceptance origin. Prove it reaches the
   dashboard and retains the invited Supabase user ID.
2. Attempt Google sign-in with the separate fictional uninvited account. Prove it
   is rejected, then inspect Supabase Authentication > Users (or an approved
   owner query) to prove the uninvited attempt creates no `auth.users` row.
3. Record timestamped, non-sensitive invited/uninvited evidence, including the
   private origin, access-policy verification, and the `auth.users` result.

The intended public production origin is `https://locum-manager.linktheworlds.co.uk`.
Its final callback destinations are
`https://locum-manager.linktheworlds.co.uk/auth/confirm` and
`https://locum-manager.linktheworlds.co.uk/auth/reset`. These retained values are
not authorization to create a hostname or change Supabase.

Only after that evidence is complete and the owner explicitly authorizes public
enablement, perform this transition in order:

1. First, apply and verify the final production Supabase Auth Site URL and exact
   public callback destinations above. This is the separately authorized
   production Site URL/redirect allow-list change; do not apply it earlier. Keep
   the private acceptance hostname and its exact callbacks available, private,
   and owner-only for the transition until the public smoke tests complete.
2. Next, enable, build, and deploy the reviewed public artifact with
   `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`, then complete password, Google,
   password-reset, account-isolation, and admin-privacy smoke tests on the exact
   owner-approved public origin. Do not treat a successful deployment as
   acceptance evidence.
3. Only after the public smoke tests succeed, remove the temporary acceptance
   redirect and hostname. The owner may keep it disabled and private only with
   explicit owner approval; retain no unapproved public route. Update or remove
   the private acceptance callback destinations only as separately authorized.

Rollback authorization is limited to setting
`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`, deploying the fail-closed artifact, and
repeating password and password-reset smoke tests. It does not authorize disabling
the Google provider, deleting the OAuth client, or altering redirects. Those
changes require separate owner authorization. Password and password-reset access
remain available.

## 3. Configure and build the web service

Provide these as deployment environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

They are public browser configuration, not authorization secrets. RLS remains
the security boundary. Do not set `LOCUM_E2E_AUTH_BYPASS` in preview or
production.

Build once from the exact reviewed release commit verified in step 1 and promote
that same artifact. Record the commit SHA in the web-image metadata and verify
it matches the reviewed release evidence before deployment:

```sh
cd web
npm ci
npm run build
npm run start
```

The app requires a full Next.js Node/Docker runtime; it is not a static export.
Place a reverse proxy or managed HTTPS platform in front of the Node server.

## 4. Publish through Cloudflare only after approval

Cloudflare Tunnel is suitable for publishing a Node service running on Nathalie
without opening an inbound router port. Create a named tunnel in the owner account,
map the approved hostname to the internal Next service (for example,
`http://locum-manager:3000` on the same Docker network), and store the tunnel token
only in Docker/host secret storage. Do not paste it into Compose, Git, logs, or this
runbook.

At Cloudflare:

- create only the approved subdomain record;
- require HTTPS and confirm the origin is reachable only through the intended path;
- do not cache `/api/*`, authenticated HTML, or invoice artifacts at the edge;
- retain the service worker's `must-revalidate` response for `/sw.js`;
- confirm security headers on the public origin.

No DNS record or tunnel should be created until the exact subdomain and external
authorization are supplied.

## 5. Expense and demo-data production release gate

This ordered procedure applies only after the owner authorizes the named
Supabase project, deployment window, two fictional acceptance accounts, and
the web-image promotion. It is not a command to deploy from a development
workstation.

1. Back up the target database and record both the backup location and the
   currently deployed web-image identifier before making any change.
2. Apply `202608020002_expenses.sql` and
   `202608020003_demo_cleanup.sql` to the authorized Supabase project. Review
   the exact target project before applying either migration.
3. Confirm `expense-receipts` is private. Using the two fictional accounts,
   run the Storage isolation checks in both directions: neither account may
   list, download, upload to, replace, or delete an object in the other
   account's owner-prefixed path.
4. Deploy the reviewed new web image. Supply configuration only through the
   approved runtime secret/configuration store; never embed a secret in the
   image, repository, client bundle, logs, or screenshots.
5. Smoke-test one fresh account and one existing unseeded account. Confirm
   automatic demo data is created once, is owner-scoped, and does not replace
   a real row.
6. Verify the tax-year boundaries independently for 5 April and 6 April;
   verify offline receipt recovery after restart and reconnect; verify signed
   receipt access for its owner only; and verify every dashboard filter opens
   its approved URL and visible records.
7. In a fictional test account, delete the demo data and prove a newly created
   real expense remains. Reload and confirm demo data does not reseed.
8. If rollback is required, roll back only the web image. Keep the additive
   expense and demo-cleanup tables while user expense data may exist, and
   disable demo bootstrap only through approved application configuration.
   Never delete user rows, receipt objects, or additive tables as a rollback
   shortcut.

Record non-sensitive timestamps, image identifiers, and pass/fail results for
each gate. Stop and escalate on any failed two-account isolation, receipt,
tax-boundary, demo-preservation, or dashboard-routing check.

### Receipt-first expenses release gate

The receipt-first and mileage changes are an additive, paired database and web
release. This checklist describes a future authorised release; it does not
authorize a production deployment.

1. Create a protected database backup and record its non-secret reference, the
   running web image digest, and the stopped rollback container before changing
   either tier.
2. Confirm the exact target, then apply
   `202608080000_profession_preference.sql` followed by
   `202608080001_receipt_first_expenses.sql`. Deploy the matching immutable web
   image only after both migrations succeed. Do not expose the new routes from
   an older image or deploy the new image before its additive schema exists.
3. Generate OCR assets during the image build with `npm run prepare:ocr-assets`.
   Inspect `public/ocr` and prove the worker, WASM core, and English trained data
   are served from same-origin `/ocr/` URLs. Reject the image if generated OCR
   files contain `http://`, `https://`, a CDN hostname, or are absent. The
   service worker uses shell cache v17 and private-page cache v16; OCR assets are
   cached lazily and authenticated pages, receipt APIs, and signed receipt URLs
   must not enter the public shell cache.
4. Run the authenticated mobile checks with fictional accounts only: require a
   legacy user to choose GP or Pharmacist; verify the profession-specific
   categories; save a manual expense offline and reopen it; scan a fictional
   PNG locally, review/edit every suggestion, and prove no remote OCR request or
   raw OCR text is stored; keep PDF/HEIC attached while entering details
   manually; verify mileage rate bands, threshold split, optional same-owner
   session link, and reconfirmation after a calculation change; then prove a
   second owner cannot see the first owner's expenses, mileage fields, or
   receipt action. Reopen the installed PWA after the cache update.
5. Keep the tax boundary explicit: Locum Manager records and exports bookkeeping
   data. This release does not connect to HMRC, file an MTD return, submit an
   update, or guarantee that an expense is deductible. Uncertain items remain
   marked for accountant review.
6. If acceptance fails, restore the prior web image/container. Leave the
   additive schema in place and dormant; never delete expense rows or receipt
   objects as a rollback shortcut. Use the protected backup only through the
   separately approved database recovery procedure.

### Passcode-free invoice payments release gate

This is a paired, forward-only database and web change. It removes the separate
payment passcode; normal Locum Manager authentication remains required. Bank
details stay owner-scoped and encrypted at rest.

1. Create a protected database backup and record its non-secret reference.
   Record the current immutable web image and retain a stopped rollback
   container. Do not copy payment rows or secret values into release notes.
2. Confirm the protected runtime contains `PAYMENT_DETAILS_MASTER_KEY` as a
   base64-encoded 32-byte random value. Verify presence and length without
   printing the value. Keep its recovery copy separate from the database backup.
3. Apply `202608090000_payment_data_boundaries.sql` before starting the new web
   image. The migration blocks version-2 downgrade/deletion and requires exact
   encrypted snapshots for newly issued invoices. Do not run the new image
   against the older schema.
4. Start the matching immutable web image with the protected key injected only
   into the server runtime. Verify `/api/profile-and-payments` returns
   `Cache-Control: private, no-store`, is rejected while signed out, and never
   appears in Cache Storage.
5. With a fictional authenticated account, enter payment details once in
   **More → Profile and payments**. Confirm only the account-name summary and
   last four digits are displayed afterward. Create an invoice without any
   vault/passcode/unlock prompt, issue it, and open the PDF. Inspect IndexedDB,
   outbox and Cache Storage and prove they contain no readable account name,
   sort code or account number.
6. Reopen the installed PWA and confirm shell cache v18/private-page cache v17
   replace the prior generations. Sign out and prove transient payment details
   are no longer usable.
7. If acceptance fails, restore only the retained prior web image. Leave the
   additive database guard in place and do not downgrade or delete version-2
   settings. Restore the protected key rather than editing encrypted rows.

## 6. Run live acceptance

Use only the disposable acceptance account and inject its password through a
secret store:

```sh
cd web
LOCUM_E2E_LIVE=1 \
LOCUM_E2E_BASE_URL=https://YOUR_AUTHORIZED_ACCEPTANCE_DOMAIN \
LOCUM_E2E_USER_EMAIL=FROM_SECRET_STORE \
LOCUM_E2E_USER_PASSWORD=FROM_SECRET_STORE \
npx playwright test e2e/auth.spec.ts e2e/invoice-lifecycle.spec.ts
```

Then complete this physical-iPhone checklist in Safari:

1. Sign in with password, sign out, and reset a password.
2. Add the app to the Home Screen and launch it from the installed icon.
3. Create a practice and session online; confirm a second authorized device syncs.
4. Turn off Wi-Fi and mobile data; reopen the installed PWA and create another
   session and invoice draft.
5. Restart Safari/the PWA and confirm the offline draft remains.
6. Reconnect; confirm the queue drains and the other device receives the record.
7. Produce the same-field conflict and confirm the explicit local/cloud choice.
8. Issue an invoice, download/open its A4 PDF, mark it sent, then paid.
9. Sign in as a second owner and prove the first owner's rows, cache, PDF, and
   private settings are inaccessible.
10. Verify a non-admin receives 403 from `/api/admin/accounts`; verify an approved
    admin sees only account id, email, created/last-sign-in timestamps, record
    counts, and sync health.

Record timestamped screenshots or logs without private data. Do not call the
release accepted merely because a manifest, build, or desktop browser test passes.

## 7. Production promotion and Expo retirement

Repeat the migration and smoke checks against the separate production project.
The owner must explicitly approve the stable HTTPS URL and the verified iPhone
flow. Keep the Expo project untouched until all acceptance evidence is signed off.
Retire it in a later, separately reviewed change; never as part of deployment.

## Current external blockers

| Gate | Current state | Required next input |
| --- | --- | --- |
| Supabase live auth, sync, issuance, private PDF | Blocked | Authorized disposable and production projects plus test credentials |
| Invite-only Google activation | Blocked | Owner-controlled Google Cloud project, OAuth client, legal URLs, and two fictional acceptance accounts |
| Stable HTTPS deployment | Blocked | Exact subdomain, host decision, and Cloudflare authorization |
| Physical iPhone install/offline/reconnect | Blocked | Public HTTPS acceptance URL and owner/device test |
| Production promotion | Blocked | Completed evidence and explicit owner approval |
| Expo retirement | Blocked by design | All prior gates plus separate removal approval |
| Expense/demo public acceptance | Blocked | Owner-authorized test accounts, target Supabase/Storage access, web-image identifier, and physical-iPhone test |

## Authoritative references

- [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase database testing](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Next.js deployment options](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting)
- [Cloudflare Tunnel commands](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/)
- [React PDF renderer](https://react-pdf.org/)
