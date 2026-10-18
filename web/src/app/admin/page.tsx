import { redirect } from "next/navigation";

import {
  AccountHealthTable,
  isAdminClaims,
  sanitizeAccountHealth,
} from "@/features/admin/AccountHealthTable";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const client = await createClient();
  const { data: auth, error: authError } = await client.auth.getClaims();
  if (authError || !isAdminClaims(auth?.claims)) redirect("/dashboard");
  const { data, error } = await client
    .from("admin_account_health")
    .select(
      "account_id,status,created_at,last_sign_in_at,last_sync_at,failed_sync_count,application_error_count",
    )
    .order("created_at", { ascending: false });
  return (
    <main className="admin-shell">
      <p className="eyebrow">Restricted operations</p>
      <h1>Account health</h1>
      <p>Operational metadata only. GP work and financial records are not available here.</p>
      {error ? <p className="record-page__error" role="alert">Account health is unavailable.</p> : <AccountHealthTable accounts={(data ?? []).map((row) => sanitizeAccountHealth(row))} />}
    </main>
  );
}
