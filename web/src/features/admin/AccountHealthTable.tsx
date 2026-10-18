export type AccountHealth = {
  accountId: string;
  status: string;
  createdAt: string;
  lastSignInAt: string | null;
  lastSyncAt: string | null;
  failedSyncCount: number;
  applicationErrorCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAdminClaims(value: unknown) {
  if (!isRecord(value) || !isRecord(value.app_metadata)) return false;
  return value.app_metadata.app_role === "admin";
}

export function sanitizeAccountHealth(
  value: Record<string, unknown>,
): AccountHealth {
  return {
    accountId: typeof value.account_id === "string" ? value.account_id : "",
    status: typeof value.status === "string" ? value.status : "unknown",
    createdAt: typeof value.created_at === "string" ? value.created_at : "",
    lastSignInAt:
      typeof value.last_sign_in_at === "string" ? value.last_sign_in_at : null,
    lastSyncAt:
      typeof value.last_sync_at === "string" ? value.last_sync_at : null,
    failedSyncCount:
      typeof value.failed_sync_count === "number" ? value.failed_sync_count : 0,
    applicationErrorCount:
      typeof value.application_error_count === "number"
        ? value.application_error_count
        : 0,
  };
}

function formatTimestamp(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      }).format(date)
    : "Unavailable";
}

export function AccountHealthTable({ accounts }: { accounts: AccountHealth[] }) {
  if (!accounts.length) return <p className="record-page__empty">No accounts are available.</p>;
  return (
    <div className="account-health-table" role="table" aria-label="Account health">
      <div className="account-health-table__row account-health-table__header" role="row">
        <span role="columnheader">Account</span><span role="columnheader">Status</span><span role="columnheader">Last sign in</span><span role="columnheader">Last sync</span><span role="columnheader">Sync failures</span><span role="columnheader">Application errors</span>
      </div>
      {accounts.map((account) => (
        <div className="account-health-table__row" key={account.accountId} role="row">
          <span role="cell"><strong>{account.accountId}</strong><small>Created {formatTimestamp(account.createdAt)}</small></span>
          <span role="cell">{account.status}</span>
          <span role="cell">{formatTimestamp(account.lastSignInAt)}</span>
          <span role="cell">{formatTimestamp(account.lastSyncAt)}</span>
          <span role="cell">{account.failedSyncCount}</span>
          <span role="cell">{account.applicationErrorCount}</span>
        </div>
      ))}
    </div>
  );
}
