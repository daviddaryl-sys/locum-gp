import type { StoredConflict } from "@/offline/types";

type ConflictDialogProps = {
  conflict: StoredConflict;
  onResolve: (choice: "local" | "server") => void | Promise<void>;
  resolving?: boolean;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

export function ConflictDialog({
  conflict,
  onResolve,
  resolving = false,
}: ConflictDialogProps) {
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <h2 id="conflict-title">Review sync conflict</h2>
      <p>
        This record changed on this device and in the cloud. Choose the version
        to keep.
      </p>
      <div>
        <article aria-labelledby="local-version-title">
          <h3 id="local-version-title">My version</h3>
          <p>Edited {formatDate(conflict.localUpdatedAt)}</p>
          <pre>{JSON.stringify(conflict.localData, null, 2)}</pre>
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve("local")}
          >
            Keep my version
          </button>
        </article>
        <article aria-labelledby="cloud-version-title">
          <h3 id="cloud-version-title">Cloud version</h3>
          <p>Edited {formatDate(conflict.serverUpdatedAt)}</p>
          <pre>{JSON.stringify(conflict.serverData, null, 2)}</pre>
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve("server")}
          >
            Use cloud version
          </button>
        </article>
      </div>
    </section>
  );
}
