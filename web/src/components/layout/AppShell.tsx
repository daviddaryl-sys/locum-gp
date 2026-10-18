"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AppNavigation } from "@/components/navigation/AppNavigation";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import { useSync } from "@/sync/SyncProvider";

function SyncSurface() {
  const { conflicts, resolveConflict } = useSync();
  const [resolving, setResolving] = useState(false);
  const conflict = conflicts[0];
  return (
    <>
      {conflict ? (
        <div className="conflict-overlay">
          <ConflictDialog
            conflict={conflict}
            resolving={resolving}
            onResolve={async (choice) => {
              setResolving(true);
              try {
                await resolveConflict(conflict, choice);
              } finally {
                setResolving(false);
              }
            }}
          />
        </div>
      ) : null}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const currentPath = usePathname();
  const { ready } = useSync();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <AppNavigation currentPath={currentPath} />
      <div className="app-shell__content">
        <header className="app-shell__topbar">
          <Link className="app-shell__mobile-brand" href="/dashboard">
            <span aria-hidden="true">LM</span>
            Locum Manager
          </Link>
        </header>
        <SyncSurface />
        <main
          className="app-shell__main"
          data-runtime-ready={ready}
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
