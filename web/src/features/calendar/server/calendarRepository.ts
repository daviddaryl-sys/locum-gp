import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import type { GoogleFailureCategory } from "./oauth";
import type { SecretEnvelopeV1 } from "./secretEnvelope";

export type RetryCategory = GoogleFailureCategory;

export type CalendarSyncSummary = {
  state:
    | "disabled"
    | "not_connected"
    | "connected"
    | "pending"
    | "reconnect_required";
  pendingCount: number;
  lastSyncAt: string | null;
  nextRetryAt: string | null;
};

export type CalendarConnection = {
  ownerId: string;
  status: "connected" | "reconnect_required" | "disconnected";
  calendarId: string;
  refreshTokenEnvelope: SecretEnvelopeV1 | null;
  connectedAt: string;
  lastSyncAt: string | null;
};

export type ConnectedCalendar = Omit<
  CalendarConnection,
  "ownerId" | "status"
> & {
  status: "connected";
};

export type CalendarEventLink = {
  ownerId: string;
  sessionId: string;
  calendarId: string;
  eventId: string;
  lastAppliedRevision: number;
  state: "active" | "cancelled" | "delete_pending";
};

export type CalendarJob = {
  ownerId: string;
  sessionId: string;
  desiredAction: "upsert" | "delete";
  targetRevision: number;
  attempts: number;
  nextAttemptAt: string;
  claimToken: string;
  leaseExpiresAt: string;
};

export type CalendarCompletionResult =
  | "completed"
  | "superseded"
  | "stale_claim"
  | "stale_calendar";

export type CalendarReplacementClaim =
  | { state: "create" | "busy" | "stale" }
  | { state: "resume"; calendarId: string };

export type CalendarSetupClaim =
  | { state: "create" | "busy" }
  | { state: "resume"; calendarId: string };

export type CalendarJobRecord = {
  session: {
    id: string;
    practiceId: string;
    startsAt: string;
    endsAt: string;
    status: "planned" | "completed" | "invoiced" | "cancelled";
    revision: number;
    deletedAt: string | null;
    isDemo: boolean;
  };
  practice: {
    name: string;
    billingAddress: { formatted?: string };
  } | null;
};

export interface CalendarRepository {
  getConnection(ownerId: string): Promise<CalendarConnection | null>;
  saveConnection(ownerId: string, input: ConnectedCalendar): Promise<void>;
  markReconnectRequired(ownerId: string, at: string): Promise<void>;
  disconnect(ownerId: string, at: string): Promise<void>;
  reconcileJobs(ownerId: string, connectedAt: string, at: string): Promise<void>;
  claimDueJobs(
    ownerId: string,
    at: string,
    leaseUntil: string,
    limit: number,
  ): Promise<CalendarJob[]>;
  loadJobRecord(ownerId: string, sessionId: string): Promise<CalendarJobRecord>;
  eventLink(ownerId: string, sessionId: string): Promise<CalendarEventLink | null>;
  completeUpsert(
    ownerId: string,
    job: CalendarJob,
    calendarId: string,
    eventId: string,
    state: "active" | "cancelled",
    at: string,
  ): Promise<CalendarCompletionResult>;
  completeDelete(
    ownerId: string,
    job: CalendarJob,
    calendarId: string,
    at: string,
  ): Promise<CalendarCompletionResult>;
  retry(
    ownerId: string,
    job: CalendarJob,
    category: RetryCategory,
    nextAttemptAt: string,
    at: string,
  ): Promise<"scheduled" | "superseded" | "stale_claim">;
  claimCalendarSetup(
    ownerId: string,
    claimToken: string,
    at: string,
  ): Promise<CalendarSetupClaim>;
  stageCalendarSetup(
    ownerId: string,
    claimToken: string,
    calendarId: string,
    at: string,
  ): Promise<boolean>;
  completeCalendarSetup(
    ownerId: string,
    claimToken: string,
    calendarId: string,
    refreshTokenEnvelope: SecretEnvelopeV1,
    at: string,
  ): Promise<"completed" | "stale_claim">;
  releaseCalendarSetup(
    ownerId: string,
    claimToken: string,
  ): Promise<boolean>;
  claimCalendarReplacement(
    ownerId: string,
    expectedCalendarId: string,
    claimToken: string,
    at: string,
  ): Promise<CalendarReplacementClaim>;
  stageCalendarReplacement(
    ownerId: string,
    expectedCalendarId: string,
    claimToken: string,
    calendarId: string,
    at: string,
  ): Promise<boolean>;
  completeCalendarReplacement(
    ownerId: string,
    expectedCalendarId: string,
    claimToken: string,
    calendarId: string,
    at: string,
  ): Promise<"completed" | "stale_claim">;
  releaseCalendarReplacement(
    ownerId: string,
    expectedCalendarId: string,
    claimToken: string,
    at: string,
  ): Promise<boolean>;
  status(ownerId: string): Promise<CalendarSyncSummary>;
}

type AdminClient = ReturnType<typeof createAdminClient>;

const REPOSITORY_ERROR = "Calendar repository is unavailable.";
const CONNECTION_FIELDS =
  "owner_id,status,calendar_id,refresh_token_envelope,connected_at,last_sync_at";
const LINK_FIELDS =
  "owner_id,session_id,calendar_id,event_id,last_applied_revision,state";
const JOB_FIELDS =
  "owner_id,session_id,desired_action,target_revision,attempts,next_attempt_at";
const SESSION_FIELDS =
  "id,practice_id,starts_at,ends_at,status,revision,deleted_at,is_demo";
const PRACTICE_FIELDS = "name,billing_address";

function failed(error: unknown): asserts error is null | undefined {
  if (error) throw new Error(REPOSITORY_ERROR);
}

function envelopeFrom(value: Json | null): SecretEnvelopeV1 | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const row = value as Record<string, Json | undefined>;
  if (
    row.version !== 1 ||
    typeof row.iv !== "string" ||
    typeof row.ciphertext !== "string" ||
    typeof row.tag !== "string"
  ) {
    return null;
  }
  return {
    version: 1,
    iv: row.iv,
    ciphertext: row.ciphertext,
    tag: row.tag,
  };
}

function connectionFrom(row: {
  owner_id: string;
  status: string;
  calendar_id: string;
  refresh_token_envelope: Json | null;
  connected_at: string;
  last_sync_at: string | null;
}): CalendarConnection {
  if (
    row.status !== "connected" &&
    row.status !== "reconnect_required" &&
    row.status !== "disconnected"
  ) {
    throw new Error(REPOSITORY_ERROR);
  }
  return {
    ownerId: row.owner_id,
    status: row.status,
    calendarId: row.calendar_id,
    refreshTokenEnvelope: envelopeFrom(row.refresh_token_envelope),
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
  };
}

function statusFrom(value: string): CalendarJobRecord["session"]["status"] {
  if (
    value !== "planned" &&
    value !== "completed" &&
    value !== "invoiced" &&
    value !== "cancelled"
  ) {
    throw new Error(REPOSITORY_ERROR);
  }
  return value;
}

function linkStateFrom(value: string): CalendarEventLink["state"] {
  if (value !== "active" && value !== "cancelled" && value !== "delete_pending") {
    throw new Error(REPOSITORY_ERROR);
  }
  return value;
}

function jobActionFrom(value: string): CalendarJob["desiredAction"] {
  if (value !== "upsert" && value !== "delete") {
    throw new Error(REPOSITORY_ERROR);
  }
  return value;
}

function completionFrom(value: unknown): CalendarCompletionResult {
  if (
    value !== "completed" &&
    value !== "superseded" &&
    value !== "stale_claim" &&
    value !== "stale_calendar"
  ) {
    throw new Error(REPOSITORY_ERROR);
  }
  return value;
}

function formattedAddress(value: Json): { formatted?: string } {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const formatted = (value as Record<string, Json | undefined>).formatted;
  return typeof formatted === "string" ? { formatted } : {};
}

export function createCalendarRepository(
  client: AdminClient = createAdminClient(),
): CalendarRepository {
  async function getConnection(ownerId: string) {
    const { data, error } = await client
      .from("google_calendar_connections")
      .select(CONNECTION_FIELDS)
      .eq("owner_id", ownerId)
      .maybeSingle();
    failed(error);
    return data ? connectionFrom(data) : null;
  }

  return {
    getConnection,

    async saveConnection(ownerId, input) {
      const { error } = await client.from("google_calendar_connections").upsert(
        {
          owner_id: ownerId,
          status: "connected",
          calendar_id: input.calendarId,
          refresh_token_envelope: input.refreshTokenEnvelope,
          connected_at: input.connectedAt,
          last_sync_at: input.lastSyncAt,
          replacement_claim_token: null,
          replacement_started_at: null,
          replacement_calendar_id: null,
        },
        { onConflict: "owner_id" },
      );
      failed(error);
    },

    async markReconnectRequired(ownerId, at) {
      const { error } = await client
        .from("google_calendar_connections")
        .update({
          status: "reconnect_required",
          last_failure_at: at,
          last_failure_category: "authorization",
          updated_at: at,
        })
        .eq("owner_id", ownerId);
      failed(error);
    },

    async disconnect(ownerId, at) {
      const { error } = await client
        .from("google_calendar_connections")
        .update({
          status: "disconnected",
          refresh_token_envelope: null,
          last_failure_at: null,
          last_failure_category: null,
          replacement_claim_token: null,
          replacement_started_at: null,
          replacement_calendar_id: null,
          updated_at: at,
        })
        .eq("owner_id", ownerId);
      failed(error);
    },

    async reconcileJobs(ownerId, connectedAt, at) {
      const [sessionsResult, linksResult, jobsResult] = await Promise.all([
        client
          .from("session_records")
          .select(SESSION_FIELDS)
          .eq("owner_id", ownerId),
        client
          .from("google_calendar_event_links")
          .select(LINK_FIELDS)
          .eq("owner_id", ownerId),
        client
          .from("google_calendar_sync_jobs")
          .select(JOB_FIELDS)
          .eq("owner_id", ownerId),
      ]);
      failed(sessionsResult.error);
      failed(linksResult.error);
      failed(jobsResult.error);

      const links = new Map(
        (linksResult.data ?? []).map((row) => [row.session_id, row]),
      );
      const jobs = new Map(
        (jobsResult.data ?? []).map((row) => [row.session_id, row]),
      );
      const queued = [];
      for (const session of sessionsResult.data ?? []) {
        if (session.is_demo) continue;
        const link = links.get(session.id);
        const isUpcoming =
          session.deleted_at === null && session.starts_at >= connectedAt;
        const linkedChange =
          Boolean(link) && session.revision > (link?.last_applied_revision ?? 0);
        if (!isUpcoming && !linkedChange) continue;

        const desiredAction = session.deleted_at ? "delete" : "upsert";
        const existing = jobs.get(session.id);
        if (existing && existing.target_revision >= session.revision) continue;
        queued.push({
          owner_id: ownerId,
          session_id: session.id,
          desired_action: desiredAction,
          target_revision: session.revision,
          attempts: 0,
          next_attempt_at: at,
          last_failure_category: null,
          updated_at: at,
        });
      }
      if (!queued.length) return;
      const { error } = await client
        .from("google_calendar_sync_jobs")
        .upsert(queued, {
          onConflict: "owner_id,session_id",
          ignoreDuplicates: true,
        });
      failed(error);
      for (const job of queued) {
        const update = await client
          .from("google_calendar_sync_jobs")
          .update({
            desired_action: job.desired_action,
            target_revision: job.target_revision,
            attempts: 0,
            next_attempt_at: at,
            last_failure_category: null,
            updated_at: at,
          })
          .eq("owner_id", ownerId)
          .eq("session_id", job.session_id)
          .lt("target_revision", job.target_revision);
        failed(update.error);
      }
    },

    async claimDueJobs(ownerId, at, leaseUntil, limit) {
      const { data, error } = await client.rpc(
        "claim_google_calendar_sync_jobs",
        {
          requested_owner: ownerId,
          claimed_at: at,
          lease_until: leaseUntil,
          requested_limit: Math.min(25, Math.max(0, limit)),
        },
      );
      failed(error);
      return (data ?? []).map((row) => ({
        ownerId: row.owner_id,
        sessionId: row.session_id,
        desiredAction: jobActionFrom(row.desired_action),
        targetRevision: row.target_revision,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        claimToken: row.claim_token,
        leaseExpiresAt: row.lease_expires_at,
      }));
    },

    async loadJobRecord(ownerId, sessionId) {
      const { data: session, error: sessionError } = await client
        .from("session_records")
        .select(SESSION_FIELDS)
        .eq("owner_id", ownerId)
        .eq("id", sessionId)
        .single();
      failed(sessionError);
      if (!session) throw new Error(REPOSITORY_ERROR);

      const { data: practice, error: practiceError } = await client
        .from("practice_records")
        .select(PRACTICE_FIELDS)
        .eq("owner_id", ownerId)
        .eq("id", session.practice_id)
        .maybeSingle();
      failed(practiceError);
      return {
        session: {
          id: session.id,
          practiceId: session.practice_id,
          startsAt: session.starts_at,
          endsAt: session.ends_at,
          status: statusFrom(session.status),
          revision: session.revision,
          deletedAt: session.deleted_at,
          isDemo: session.is_demo,
        },
        practice: practice
          ? {
              name: practice.name,
              billingAddress: formattedAddress(practice.billing_address),
            }
          : null,
      };
    },

    async eventLink(ownerId, sessionId) {
      const { data, error } = await client
        .from("google_calendar_event_links")
        .select(LINK_FIELDS)
        .eq("owner_id", ownerId)
        .eq("session_id", sessionId)
        .maybeSingle();
      failed(error);
      return data
        ? {
            ownerId: data.owner_id,
            sessionId: data.session_id,
            calendarId: data.calendar_id,
            eventId: data.event_id,
            lastAppliedRevision: data.last_applied_revision,
            state: linkStateFrom(data.state),
          }
        : null;
    },

    async completeUpsert(ownerId, job, calendarId, eventId, state, at) {
      const { data, error } = await client.rpc("complete_google_calendar_upsert", {
        requested_owner: ownerId,
        requested_session: job.sessionId,
        requested_claim: job.claimToken,
        requested_calendar: calendarId,
        requested_event: eventId,
        requested_revision: job.targetRevision,
        requested_state: state,
        completed_at: at,
      });
      failed(error);
      return completionFrom(data);
    },

    async completeDelete(ownerId, job, calendarId, at) {
      const { data, error } = await client.rpc("complete_google_calendar_delete", {
        requested_owner: ownerId,
        requested_session: job.sessionId,
        requested_claim: job.claimToken,
        requested_calendar: calendarId,
        requested_revision: job.targetRevision,
        completed_at: at,
      });
      failed(error);
      return completionFrom(data);
    },

    async retry(ownerId, job, category, nextAttemptAt, at) {
      const { data, error } = await client.rpc(
        "retry_google_calendar_sync_job",
        {
          requested_owner: ownerId,
          requested_session: job.sessionId,
          requested_claim: job.claimToken,
          requested_category: category,
          requested_retry_at: nextAttemptAt,
          failed_at: at,
        },
      );
      failed(error);
      if (data !== "scheduled" && data !== "superseded" && data !== "stale_claim") {
        throw new Error(REPOSITORY_ERROR);
      }
      return data;
    },

    async claimCalendarSetup(ownerId, claimToken, at) {
      const { data, error } = await client.rpc("claim_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        claimed_at: at,
      });
      failed(error);
      const row = data?.[0];
      if (!row || (row.disposition !== "create" && row.disposition !== "busy" &&
        row.disposition !== "resume")) {
        throw new Error(REPOSITORY_ERROR);
      }
      if (row.disposition === "resume") {
        if (typeof row.calendar_id !== "string" || !row.calendar_id) {
          throw new Error(REPOSITORY_ERROR);
        }
        return { state: "resume", calendarId: row.calendar_id };
      }
      return { state: row.disposition };
    },

    async stageCalendarSetup(ownerId, claimToken, calendarId, at) {
      const { data, error } = await client.rpc("stage_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        requested_calendar: calendarId,
        staged_at: at,
      });
      failed(error);
      return data === true;
    },

    async completeCalendarSetup(
      ownerId,
      claimToken,
      calendarId,
      refreshTokenEnvelope,
      at,
    ) {
      const { data, error } = await client.rpc("complete_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
        requested_calendar: calendarId,
        requested_envelope: refreshTokenEnvelope,
        completed_at: at,
      });
      failed(error);
      if (data !== "completed" && data !== "stale_claim") {
        throw new Error(REPOSITORY_ERROR);
      }
      return data;
    },

    async releaseCalendarSetup(ownerId, claimToken) {
      const { data, error } = await client.rpc("release_google_calendar_setup", {
        requested_owner: ownerId,
        requested_claim: claimToken,
      });
      failed(error);
      return data === true;
    },

    async claimCalendarReplacement(ownerId, expectedCalendarId, claimToken, at) {
      const { data, error } = await client.rpc(
        "claim_google_calendar_replacement",
        {
          requested_owner: ownerId,
          requested_calendar: expectedCalendarId,
          requested_claim: claimToken,
          claimed_at: at,
        },
      );
      failed(error);
      const row = data?.[0];
      if (!row || (row.disposition !== "create" && row.disposition !== "busy" &&
        row.disposition !== "stale" && row.disposition !== "resume")) {
        throw new Error(REPOSITORY_ERROR);
      }
      if (row.disposition === "resume") {
        if (typeof row.calendar_id !== "string" || !row.calendar_id) {
          throw new Error(REPOSITORY_ERROR);
        }
        return { state: "resume", calendarId: row.calendar_id };
      }
      return { state: row.disposition };
    },

    async stageCalendarReplacement(
      ownerId,
      expectedCalendarId,
      claimToken,
      calendarId,
      at,
    ) {
      const { data, error } = await client.rpc(
        "stage_google_calendar_replacement",
        {
          requested_owner: ownerId,
          requested_calendar: expectedCalendarId,
          requested_claim: claimToken,
          requested_replacement: calendarId,
          staged_at: at,
        },
      );
      failed(error);
      return data === true;
    },

    async completeCalendarReplacement(
      ownerId,
      expectedCalendarId,
      claimToken,
      calendarId,
      at,
    ) {
      const { data, error } = await client.rpc(
        "complete_google_calendar_replacement",
        {
          requested_owner: ownerId,
          requested_calendar: expectedCalendarId,
          requested_claim: claimToken,
          requested_replacement: calendarId,
          completed_at: at,
        },
      );
      failed(error);
      if (data !== "completed" && data !== "stale_claim") {
        throw new Error(REPOSITORY_ERROR);
      }
      return data;
    },

    async releaseCalendarReplacement(
      ownerId,
      expectedCalendarId,
      claimToken,
      at,
    ) {
      const { data, error } = await client.rpc(
        "release_google_calendar_replacement",
        {
          requested_owner: ownerId,
          requested_calendar: expectedCalendarId,
          requested_claim: claimToken,
          released_at: at,
        },
      );
      failed(error);
      return data === true;
    },

    async status(ownerId) {
      const connection = await getConnection(ownerId);
      if (!connection || connection.status === "disconnected") {
        return {
          state: "not_connected",
          pendingCount: 0,
          lastSyncAt: connection?.lastSyncAt ?? null,
          nextRetryAt: null,
        };
      }
      if (connection.status === "reconnect_required") {
        return {
          state: "reconnect_required",
          pendingCount: 0,
          lastSyncAt: connection.lastSyncAt,
          nextRetryAt: null,
        };
      }
      const { data, error, count } = await client
        .from("google_calendar_sync_jobs")
        .select("next_attempt_at", { count: "exact" })
        .eq("owner_id", ownerId)
        .order("next_attempt_at", { ascending: true })
        .limit(1);
      failed(error);
      const pendingCount = count ?? 0;
      return {
        state: pendingCount ? "pending" : "connected",
        pendingCount,
        lastSyncAt: connection.lastSyncAt,
        nextRetryAt: data?.[0]?.next_attempt_at ?? null,
      };
    },
  };
}
