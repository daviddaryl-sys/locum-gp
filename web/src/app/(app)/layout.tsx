import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { InstallGuide } from "@/components/pwa/InstallGuide";
import { GoogleCalendarProvider } from "@/features/calendar/GoogleCalendarProvider";
import { calendarFeatureEnabled } from "@/features/calendar/server/config";
import { createClient } from "@/lib/supabase/server";
import { SyncProvider } from "@/sync/SyncProvider";

const E2E_OWNER_ID = "00000000-0000-4000-8000-000000000001";

async function currentOwnerId() {
  const requestHeaders = await headers();
  if (
    process.env.NODE_ENV === "development" &&
    process.env.LOCUM_E2E_AUTH_BYPASS === "responsive-shell" &&
    requestHeaders.get("x-locum-e2e-auth") === "responsive-shell"
  ) {
    const requestedOwner = requestHeaders.get("x-locum-e2e-owner");
    return requestedOwner && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestedOwner)
      ? requestedOwner
      : E2E_OWNER_ID;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerId = data?.claims?.sub;
  if (error || typeof ownerId !== "string" || !ownerId) redirect("/login");
  return ownerId;
}

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ownerId = await currentOwnerId();
  return (
    <GoogleCalendarProvider enabled={calendarFeatureEnabled()} ownerId={ownerId}>
      <SyncProvider ownerId={ownerId}>
        <AppShell>
          {children}
          <InstallGuide authenticated />
        </AppShell>
      </SyncProvider>
    </GoogleCalendarProvider>
  );
}
