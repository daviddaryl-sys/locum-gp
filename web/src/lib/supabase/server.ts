import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

function getPublicSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase public configuration is not available.");
  }

  return { key, url };
}

export async function createClient() {
  const cookieStore = await cookies();
  const { key, url } = getPublicSupabaseConfiguration();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes
          // the session before rendering, while handlers/actions can write.
        }
      },
    },
  });
}

export async function signOutCurrentUser() {
  const supabase = await createClient();
  return supabase.auth.signOut();
}
