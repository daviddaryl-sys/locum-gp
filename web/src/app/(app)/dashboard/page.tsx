import { DashboardWorkspace } from "@/features/dashboard/DashboardSummary";

export default function DashboardPage() {
  return (
    <section className="record-page dashboard-page" aria-labelledby="dashboard-title">
      <DashboardWorkspace />
    </section>
  );
}
