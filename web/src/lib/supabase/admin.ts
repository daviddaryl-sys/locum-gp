import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

const CONFIGURATION_ERROR =
  "Supabase server configuration is not available.";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error(CONFIGURATION_ERROR);

  try {
    return createClient<Database>(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    throw new Error(CONFIGURATION_ERROR);
  }
}
