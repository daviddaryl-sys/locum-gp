"use client";

import { useState } from "react";

import { useGoogleCalendar } from "./GoogleCalendarProvider";

type ConnectedServicesProps = {
  callbackError?: boolean;
  enabled: boolean;
};

function ConnectForm({ reconnect = false }: { reconnect?: boolean }) {
  return (
    <form action="/api/google-calendar/connect" method="post">
      <button className="button button--primary" type="submit">
        {reconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
      </button>
    </form>
  );
}

function PrivacyProjection() {
  return (
    <div className="connected-service__privacy">
      <p>
        Only your practice name, session start and end time, practice address,
        and session status are added to your dedicated Google calendar.
      </p>
      <p>
        Google does not become the source of truth. Changes continue to be made
        in Locum Manager and sync automatically.
      </p>
    </div>
  );
}

export function ConnectedServices({
  callbackError = false,
  enabled,
}: ConnectedServicesProps) {
  const { summary: view, syncCalendarNow } = useGoogleCalendar();
  const [disconnectFailed, setDisconnectFailed] = useState(false);

  const disconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Google Calendar? Existing Google events will remain.",
      )
    ) {
      return;
    }
    setDisconnectFailed(false);
    try {
      const response = await fetch("/api/google-calendar/disconnect", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      await syncCalendarNow();
    } catch {
      setDisconnectFailed(true);
    }
  };

  const disconnectButton = (
    <button
      className="button button--secondary"
      onClick={() => void disconnect()}
      type="button"
    >
      Disconnect
    </button>
  );

  const callbackAlert = callbackError ? (
    <p role="alert">Google Calendar connection could not be completed.</p>
  ) : null;
  const disconnectAlert = disconnectFailed ? (
    <p role="alert">Google Calendar could not be disconnected.</p>
  ) : null;

  if (!enabled || view.state === "disabled") {
    return (
      <section className="connected-service" aria-labelledby="google-calendar-title">
        <h2 id="google-calendar-title">Google Calendar</h2>
        <p>Google Calendar connection is not available.</p>
      </section>
    );
  }

  if (view.state === "loading") {
    return (
      <section className="connected-service" aria-labelledby="google-calendar-title">
        <h2 id="google-calendar-title">Google Calendar</h2>
        <p role="status">Checking Google Calendar connection…</p>
      </section>
    );
  }

  if (view.state === "unavailable") {
    return (
      <section className="connected-service" aria-labelledby="google-calendar-title">
        <h2 id="google-calendar-title">Google Calendar</h2>
        <p role="alert">Google Calendar status is temporarily unavailable.</p>
        <button
          className="button button--secondary"
          onClick={() => void syncCalendarNow()}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  if (view.state === "reconnect_required") {
    return (
      <section className="connected-service" aria-labelledby="google-calendar-title">
        <h2 id="google-calendar-title">Google Calendar</h2>
        {callbackAlert}
        {disconnectAlert}
        <p role="alert">
          Google Calendar needs permission again before automatic sync can continue.
        </p>
        <PrivacyProjection />
        <ConnectForm reconnect />
        {disconnectButton}
      </section>
    );
  }

  if (view.state === "not_connected") {
    return (
      <section className="connected-service" aria-labelledby="google-calendar-title">
        <h2 id="google-calendar-title">Google Calendar</h2>
        {callbackAlert}
        {disconnectAlert}
        <PrivacyProjection />
        <ConnectForm />
      </section>
    );
  }

  return (
    <section className="connected-service" aria-labelledby="google-calendar-title">
      <div className="connected-service__heading">
        <div>
          <h2 id="google-calendar-title">Google Calendar</h2>
          <strong>Locum Manager → Google</strong>
        </div>
        <span>Automatic</span>
      </div>
      <PrivacyProjection />
      {callbackAlert}
      {disconnectAlert}
      {view.lastSyncAt ? (
        <p>
          Last synced {new Intl.DateTimeFormat("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Europe/London",
          }).format(new Date(view.lastSyncAt))}
        </p>
      ) : null}
      {view.state === "pending" ? (
        <p role="status">
          Sync pending for {view.pendingCount} {view.pendingCount === 1 ? "session" : "sessions"}.
        </p>
      ) : null}
      {disconnectButton}
    </section>
  );
}
