"use client";

import { useState } from "react";

import { PublicLegalLinks } from "@/components/legal/PublicLegalLinks";
import { Button } from "@/components/ui/Button";
import {
  collectBackupRecords,
  downloadEncryptedBackup,
  exportEncryptedBackup,
} from "@/features/backup/exportBackup";
import {
  loadDemoData,
  removeDemoData,
} from "@/features/demo/demoDataService";
import {
  FinancialOverview,
  useDashboardMetrics,
} from "@/features/dashboard/DashboardSummary";
import { useOfflineRecords } from "@/offline/useRecords";
import { useSync } from "@/sync/SyncProvider";
import { MoreActionRow } from "./MoreActionRow";

type MoreDisclosure = "demo" | "backup" | "privacy";

export function MoreWorkspace({ calendarEnabled }: { calendarEnabled: boolean }) {
  const metrics = useDashboardMetrics();
  const settings = useOfflineRecords("settings");
  const { markSaving, ready, repository, syncNow } = useSync();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [signOutMessage, setSignOutMessage] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
  const [demoError, setDemoError] = useState(false);
  const [open, setOpen] = useState<Record<MoreDisclosure, boolean>>({
    demo: false,
    backup: false,
    privacy: false,
  });
  const configured = Boolean(settings?.length);
  const toggle = (name: MoreDisclosure) =>
    setOpen((current) => ({ ...current, [name]: !current[name] }));

  const runDemoAction = async (action: "load" | "remove") => {
    if (!ready || !repository) return;
    if (
      action === "remove" &&
      !window.confirm(
        "Remove the 11 demo practices, 8 demo sessions and 6 demo invoices? Your own records will not be changed.",
      )
    ) {
      return;
    }
    setDemoBusy(true);
    setDemoMessage("");
    setDemoError(false);
    try {
      if (action === "load") {
        const parts = new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Europe/London",
        }).formatToParts(new Date());
        const value = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find((part) => part.type === type)?.value ?? "";
        await loadDemoData(
          repository,
          `${value("year")}-${value("month")}-${value("day")}`,
        );
        setDemoMessage(
          "Demo data loaded: 11 practices, 8 sessions and 6 invoices.",
        );
      } else {
        await removeDemoData(repository);
        setDemoMessage("Demo data removed. Your own records were not changed.");
      }
      markSaving();
      await syncNow();
    } catch (error) {
      setOpen((current) => ({ ...current, demo: true }));
      setDemoError(true);
      setDemoMessage(
        error instanceof Error && error.message.includes("linked")
          ? "Demo data is linked to one of your own records, so nothing was removed."
          : "Demo data could not be changed. Please try again.",
      );
    } finally {
      setDemoBusy(false);
    }
  };

  const createBackup = async () => {
    if (!repository) return;
    setBusy(true);
    setBackupMessage("");
    try {
      const records = await collectBackupRecords(repository);
      const envelope = await exportEncryptedBackup(records, passphrase);
      downloadEncryptedBackup(envelope);
      setPassphrase("");
      setBackupMessage("Encrypted backup downloaded.");
    } catch {
      setOpen((current) => ({ ...current, backup: true }));
      setBackupMessage("Backup could not be created. No file was downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setSignOutMessage("");
    const response = await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      setSignOutMessage("Sign out could not be completed.");
      return;
    }
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("locum-manager-private-pages"))
        .map((name) => caches.delete(name)),
    );
    window.location.assign("/login");
  };

  return (
    <div className="more-actions">
      <p className="record-page__intro">Your details and app settings stay here.</p>
      {metrics ? (
        <FinancialOverview metrics={metrics} />
      ) : (
        <p className="record-page__runtime" role="status">
          Preparing financial overview
        </p>
      )}
      <MoreActionRow
        description="Manage places you work"
        href="/practices"
        icon="practices"
        title="Practices"
        tone="primary"
        variant="link"
      />
      <section aria-labelledby="more-explore-title" className="more-actions__group">
        <h2 className="more-actions__label" id="more-explore-title">
          Explore
        </h2>
        <MoreActionRow
          description="Review your digital tax totals"
          href="/tax-mtd"
          icon="tax-mtd"
          title="Tax & MTD"
          variant="link"
        />
        <MoreActionRow
          controls="demo-controls"
          description="Load clearly labelled fictional examples"
          expanded={open.demo}
          icon="demo"
          onToggle={() => toggle("demo")}
          title="Demo data"
          variant="disclosure"
        >
          <p>
            Add fictional records to see Locum Manager working. Your own data is
            not replaced or altered.
          </p>
          <div className="more-action__actions">
            <Button
              disabled={!ready || !repository || demoBusy}
              loading={demoBusy}
              onClick={() => void runDemoAction("load")}
              type="button"
            >
              Load demo data
            </Button>
            <Button
              disabled={!ready || !repository || demoBusy}
              onClick={() => void runDemoAction("remove")}
              type="button"
              variant="secondary"
            >
              Remove demo data
            </Button>
          </div>
          {demoMessage ? (
            <p
              className={demoError ? "record-form__error" : "record-form__success"}
              role={demoError ? "alert" : "status"}
            >
              {demoMessage}
            </p>
          ) : null}
        </MoreActionRow>
      </section>

      <section aria-labelledby="more-safety-title" className="more-actions__group">
        <h2 className="more-actions__label" id="more-safety-title">
          Account and safety
        </h2>
        {calendarEnabled ? (
          <MoreActionRow
            description="Connect and sync your Google Calendar"
            href="/settings/connected-services"
            icon="calendar"
            title="Google Calendar"
            variant="link"
          />
        ) : null}
        <MoreActionRow
          description={
            configured
              ? "Your GP details and payment details are ready"
              : "Add your GP details before invoicing"
          }
          href="/settings/profile"
          icon="profile"
          title="Profile"
          variant="link"
        />
        <MoreActionRow
          controls="backup-controls"
          description="Download a passphrase-protected copy"
          expanded={open.backup}
          icon="backup"
          onToggle={() => toggle("backup")}
          title="Encrypted backup"
          variant="disclosure"
        >
          <label>
            Backup passphrase
            <input
              autoComplete="off"
              minLength={12}
              onChange={(event) => setPassphrase(event.target.value)}
              type="password"
              value={passphrase}
            />
          </label>
          <Button
            disabled={!repository || passphrase.length < 12}
            loading={busy}
            onClick={createBackup}
            type="button"
          >
            Download encrypted backup
          </Button>
          {backupMessage ? (
            <p
              className={
                backupMessage.includes("could not")
                  ? "record-form__error"
                  : "record-form__success"
              }
              role={backupMessage.includes("could not") ? "alert" : "status"}
            >
              {backupMessage}
            </p>
          ) : null}
        </MoreActionRow>
        <MoreActionRow
          controls="privacy-content"
          description="How your business records stay private"
          expanded={open.privacy}
          icon="privacy"
          onToggle={() => toggle("privacy")}
          title="Privacy"
          variant="disclosure"
        >
          <p>
            Locum Manager stores no patient records. GP business rows are
            isolated by account, and bank details remain encrypted at rest and
            available only after normal sign-in.
          </p>
          <PublicLegalLinks />
        </MoreActionRow>
      </section>

      <section aria-labelledby="more-account-title" className="more-actions__group">
        <h2 className="more-actions__label" id="more-account-title">
          Account
        </h2>
        <MoreActionRow
          description="Synchronise changes, then leave this account"
          icon="sign-out"
          onAction={() => void signOut()}
          title="Sign out"
          tone="danger"
          variant="action"
        />
        {signOutMessage ? (
          <p className="record-form__error" role="alert">
            {signOutMessage}
          </p>
        ) : null}
      </section>
    </div>
  );
}
