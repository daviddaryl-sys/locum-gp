import { type NextRequest, NextResponse } from "next/server";

import {
  isAdminClaims,
  sanitizeAccountHealth,
} from "@/features/admin/AccountHealthTable";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("Pragma", "no-cache");
  return result;
}

const E2E_ACCOUNT = {
  accountId: "00000000-0000-4000-8000-0000000000aa",
  status: "active",
  createdAt: "2026-08-01T09:00:00.000Z",
  lastSignInAt: null,
  lastSyncAt: null,
  failedSyncCount: 0,
  applicationErrorCount: 0,
};

export async function GET(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.LOCUM_E2E_AUTH_BYPASS === "responsive-shell"
  ) {
    if (request.headers.get("x-locum-e2e-admin") === "account-health") {
      return response({ accounts: [E2E_ACCOUNT] });
    }
    if (request.headers.get("x-locum-e2e-auth") === "responsive-shell") {
      return response({ error: "Administrator access is required." }, 403);
    }
  }
  const client = await createClient();
  const { data: auth, error: authError } = await client.auth.getClaims();
  if (authError || !isAdminClaims(auth?.claims)) {
    return response({ error: "Administrator access is required." }, 403);
  }
  const { data, error } = await client
    .from("admin_account_health")
    .select(
      "account_id,status,created_at,last_sign_in_at,last_sync_at,failed_sync_count,application_error_count",
    )
    .order("created_at", { ascending: false });
  if (error) return response({ error: "Account health is unavailable." }, 503);
  return response({ accounts: (data ?? []).map((row) => sanitizeAccountHealth(row)) });
}
