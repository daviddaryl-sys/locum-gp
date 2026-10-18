import { MoreWorkspace } from "@/features/settings/MoreWorkspace";
import { calendarFeatureEnabled } from "@/features/calendar/server/config";

export default function MorePage() {
  return (
    <section className="record-page" aria-labelledby="more-title">
      <h1 id="more-title">My account</h1>
      <MoreWorkspace calendarEnabled={calendarFeatureEnabled()} />
    </section>
  );
}
