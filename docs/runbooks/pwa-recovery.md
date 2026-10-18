# Locum Manager PWA recovery runbook

Use this runbook for a service outage, failed deployment, browser-data loss, sync
conflict, or suspected account-boundary incident. Never ask a user to send a bank
passcode, backup passphrase, auth token, or password.

## First response

1. Record the time, affected account id, app version/commit, route, sync label,
   and online/offline state. Do not record business content or credentials.
2. If cross-account exposure is suspected, stop the public web deployment and
   revoke affected sessions before investigating. Preserve server audit evidence.
3. If it is an ordinary outage, leave the client installed and keep the tab/PWA
   open. Do not clear site data, uninstall the PWA, or repeatedly press save.
4. Confirm whether the app says Offline, Saving, Syncing, All changes saved, or
   Action required.

## Service or network outage

Users may continue drafts and records already supported offline. Final invoice
issuance, account authentication, cloud PDF retention, and cross-device sync need
connectivity.

After service restoration:

1. Reopen the app while online and wait for `All changes saved`.
2. If it remains `Action required`, inspect server availability and the sync API
   response before changing any client record.
3. Compare only record ids, revisions, owner ids, and timestamps in diagnostics.
4. Verify the outbox drains once. Confirm the target rows through the signed-in
   account; never use a service-role key in the browser.

## Conflict recovery

The conflict dialog is deliberate protection. Review the local and cloud values
with the owner and choose one side explicitly. Choosing cloud replaces the local
record; choosing local queues the selected local version for sync. Do not resolve
conflicts by editing Postgres directly unless a separately reviewed incident plan
requires it.

After resolution, confirm:

- the dialog closes;
- the sync label reaches `All changes saved`;
- the selected value appears after a full restart;
- the other authorized device receives the same revision.

## Browser data or device loss

Cloud-synced records can repopulate after sign-in. Records that never completed
sync may exist only in that browser profile and cannot be recreated automatically.

The More page can download a passphrase-encrypted JSON backup. It excludes auth
tokens. Keep the file and passphrase separately. The current release has no
self-service import screen; restoration is an operator-assisted, version-checked
procedure and must first be rehearsed against a disposable project. Never paste
the backup or passphrase into a ticket or chat.

The encrypted-backup passphrase is intentionally not recoverable. If it is lost,
create a new backup after identity verification; do not try to bypass encryption.

Payment details no longer use a separate user vault passcode. They use the
server-only `PAYMENT_DETAILS_MASTER_KEY`, bound to the authenticated account. The
protected recovery copy of this key is essential: losing it makes existing
version-2 payment settings unreadable. Do not guess, derive, log or replace the
key while those rows remain in use.

For a missing or invalid payment key:

1. Stop invoice payment-detail reads and new invoice issuance; ordinary records
   and drafts may continue where safe.
2. Restore the exact protected key into the server runtime without printing it.
3. Restart only the affected immutable web service and verify a fictional owner
   can load the masked payment summary and create an invoice without a passcode.
4. If the exact key cannot be restored, keep affected encrypted rows unchanged
   and escalate to a separately reviewed recovery/migration procedure. Do not
   delete, downgrade, or overwrite them through sync or direct SQL.

Key rotation requires a separately reviewed, transactional re-encryption plan
that can decrypt every owned row with the old key and write a fresh envelope
with the new key before the old key is retired. A normal web rollback must retain
the active key and the forward-only database boundary.

## Google Calendar recovery

An invalidated or revoked Google refresh token moves the connection to
reconnect-required. Ask the owner to reconnect from **More → Connected
services** in a full system browser. Never attempt the OAuth consent flow in an
embedded WebView, and never inspect or record credentials, authorization codes,
cookies, refresh tokens, or provider response bodies.

The Calendar token-encryption key must be restored only from its protected,
access-controlled server recovery copy. If that copy is lost or cannot be
verified, existing encrypted refresh tokens are intentionally unrecoverable:
disable Calendar processing, remove the unusable server-side connection through
the reviewed disconnect procedure, and have each affected owner reconnect.
Never guess the key, log it, export token envelopes, copy encrypted or decrypted
tokens into a ticket, or attempt to derive a replacement from database contents.

Disconnect and reconnect stop future work for the old token but leave the
dedicated Google calendar and existing events unchanged. Revocation is
best-effort; failure to revoke must not expose provider details. Locum Manager
records remain authoritative and ordinary offline/cloud sync must continue while
Calendar is unavailable.

## Failed web deployment

1. Stop promotion and keep the previous immutable artifact available.
2. Roll the Node/Docker service back to the previously verified commit without
   rolling the database backward.
3. Re-run login, owner-isolation, sync, invoice list, and private PDF checks.
4. Service workers may retain the prior shell. Keep `/sw.js` revalidated, publish
   a new cache version when its behavior changes, and verify a fresh installed-PWA
   launch after rollback.

Database migrations are forward-only by default. If a migration fails, stop and
restore into a new disposable database from the provider backup/PITR mechanism,
then prove the repair. Do not run destructive SQL or `db reset` against preview or
production.

For a Calendar-only web rollback, restore the retained immutable container and
leave all additive Calendar tables in place and dormant. Do not delete provider
events, token rows, or additive tables as part of rollback.

## Supabase or storage incident

Check Auth, Database, and Storage independently. Issued invoice rows and line
items are immutable financial records; do not rewrite them to repair an artifact.
If a PDF upload failed after issuance, use the signed-in retry path to regenerate
and retain the artifact under the same owner/invoice path.

For suspected storage exposure:

1. Disable public access or the affected deployment.
2. Verify the bucket remains private and policies scope the first path segment to
   the authenticated owner id.
3. Test with two fictional accounts before reopening service.
4. Rotate sessions/credentials through the provider controls as required; never
   place replacement values in Git or the incident record.

## Recovery verification

Before closing an incident, record zero-inclusive results for:

- accounts checked;
- records recovered or still local-only;
- conflicts resolved;
- outbox entries remaining;
- invoice PDFs verified private;
- cross-account access attempts allowed (must be zero);
- errors remaining.

If the incident involved production data, obtain owner approval before reopening
service and keep the Expo reference unchanged until PWA acceptance is complete.
