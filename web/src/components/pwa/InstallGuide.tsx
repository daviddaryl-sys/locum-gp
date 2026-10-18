"use client";

import { useSyncExternalStore } from "react";

const DISMISSED_KEY = "locum-manager:install-guide-dismissed";
const DISMISSAL_EVENT = "locum-manager:install-guide-change";

function subscribeToDismissal(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISSAL_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DISMISSAL_EVENT, callback);
  };
}

function getDismissedSnapshot() {
  return window.localStorage.getItem(DISMISSED_KEY) === "true";
}

function getServerDismissedSnapshot() {
  return true;
}

type InstallGuideProps = {
  authenticated: boolean;
  forceOpen?: boolean;
};

export function InstallGuide({
  authenticated,
  forceOpen = false,
}: InstallGuideProps) {
  const dismissed = useSyncExternalStore(
    subscribeToDismissal,
    getDismissedSnapshot,
    getServerDismissedSnapshot,
  );
  const visible = authenticated && (forceOpen || !dismissed);

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    window.dispatchEvent(new Event(DISMISSAL_EVENT));
  }

  if (!visible) return null;

  return (
    <section
      className="install-guide"
      role="dialog"
      aria-modal="false"
      aria-labelledby="install-guide-title"
    >
      <div className="install-guide__card">
        <p className="eyebrow">Use it like an app</p>
        <h2 id="install-guide-title">Install Locum Manager</h2>
        <p className="install-guide__intro">
          On your iPhone, open this page in Safari and follow these steps:
        </p>
        <ol className="install-guide__steps">
          <li>
            Tap <strong>Share</strong> in Safari.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Keep <strong>Open as Web App</strong> enabled.
          </li>
          <li>
            Tap <strong>Add</strong> to finish.
          </li>
        </ol>
        <p className="install-guide__note">
          Safari requires these manual steps; Locum Manager cannot install
          itself automatically on iPhone.
        </p>
        <button className="install-guide__dismiss" type="button" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
