import Link from "next/link";

import { ConnectedServices } from "@/features/calendar/ConnectedServices";
import { calendarFeatureEnabled } from "@/features/calendar/server/config";

export default async function ConnectedServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <section
      className="record-page record-page--form"
      aria-labelledby="connected-services-title"
    >
      <Link className="record-page__back" href="/more">
        ← My account
      </Link>
      <p className="eyebrow">Account and safety</p>
      <h1 id="connected-services-title">Connected services</h1>
      <ConnectedServices
        callbackError={query.calendar === "error"}
        enabled={calendarFeatureEnabled()}
      />
    </section>
  );
}
