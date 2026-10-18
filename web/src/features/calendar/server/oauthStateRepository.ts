import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type OAuthStateRegistration = {
  ownerId: string;
  stateDigest: string;
  expiresAt: number;
};

export type OAuthStateClaim = {
  ownerId: string;
  stateDigest: string;
  nowMs: number;
};

export interface OAuthStateStore {
  register(registration: OAuthStateRegistration): Promise<void>;
  claim(claim: OAuthStateClaim): Promise<boolean>;
}

const STORE_ERROR = "OAuth state store is unavailable.";

export function createOAuthStateStore(): OAuthStateStore {
  const client = createAdminClient();

  return {
    async register({ ownerId, stateDigest, expiresAt }) {
      const { error } = await client
        .from("google_calendar_oauth_state_claims")
        .insert({
          owner_id: ownerId,
          state_digest: stateDigest,
          expires_at: new Date(expiresAt).toISOString(),
        });
      if (error) throw new Error(STORE_ERROR);
    },

    async claim({ ownerId, stateDigest, nowMs }) {
      const { data, error } = await client
        .from("google_calendar_oauth_state_claims")
        .delete()
        .eq("owner_id", ownerId)
        .eq("state_digest", stateDigest)
        .gt("expires_at", new Date(nowMs).toISOString())
        .select("state_digest")
        .maybeSingle();
      if (error) throw new Error(STORE_ERROR);
      return Boolean(data);
    },
  };
}
