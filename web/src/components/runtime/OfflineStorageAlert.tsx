export function OfflineStorageAlert({ initializationError }: { initializationError: boolean }) {
  if (!initializationError) return null;
  return <p className="record-page__error" role="alert">Offline storage is unavailable.</p>;
}
