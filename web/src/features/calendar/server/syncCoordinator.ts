import "server-only";

import { randomUUID } from "node:crypto";

import { GoogleOAuthError, type GoogleTokenResult } from "./oauth";
import type { SecretEnvelopeV1 } from "./secretEnvelope";
import {
  eventIdForSession,
  projectCalendarEvent,
} from "./eventProjection";
import {
  GoogleCalendarError,
  type GoogleCalendarGateway,
} from "./googleCalendarApi";
import type {
  CalendarConnection,
  CalendarJob,
  CalendarRepository,
  CalendarSyncSummary,
  RetryCategory,
} from "./calendarRepository";

export type CalendarSyncDependencies = {
  repository: CalendarRepository;
  gateway: GoogleCalendarGateway;
  eventIdKey: Buffer;
  decryptRefreshToken: (envelope: SecretEnvelopeV1) => string;
  refreshAccessToken: (refreshToken: string) => Promise<GoogleTokenResult>;
  now?: () => Date;
  newClaimToken?: () => string;
  enabled?: boolean;
};

const JOB_LEASE_MS = 5 * 60_000;

const DISABLED: CalendarSyncSummary = {
  state: "disabled",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};

function categoryOf(error: unknown): RetryCategory {
  return error instanceof GoogleCalendarError || error instanceof GoogleOAuthError
    ? error.category
    : "transient";
}

function outcomeOf(error: unknown) {
  return error instanceof GoogleCalendarError ? error.outcome : "unknown";
}

function retryAt(at: Date, attempts: number) {
  const delays = [30_000, 2 * 60_000, 10 * 60_000];
  return new Date(
    at.getTime() + (delays[attempts] ?? 60 * 60_000),
  ).toISOString();
}

async function sanitizedStatus(
  repository: CalendarRepository,
  ownerId: string,
  fallback: CalendarSyncSummary,
) {
  try {
    return await repository.status(ownerId);
  } catch {
    return fallback;
  }
}

async function reconnectRequired(
  repository: CalendarRepository,
  ownerId: string,
  at: string,
  lastSyncAt: string | null,
) {
  try {
    await repository.markReconnectRequired(ownerId, at);
  } catch {
    // The public result remains sanitized even when persistence is unavailable.
  }
  return sanitizedStatus(repository, ownerId, {
    state: "reconnect_required",
    pendingCount: 0,
    lastSyncAt,
    nextRetryAt: null,
  });
}

async function retryJobs(
  repository: CalendarRepository,
  ownerId: string,
  jobs: CalendarJob[],
  category: RetryCategory,
  at: Date,
  outcome: "known_failure" | "unknown",
) {
  for (const job of jobs) {
    try {
      const scheduledAt = new Date(
        Math.max(
          Date.parse(retryAt(at, job.attempts)),
          outcome === "unknown" ? Date.parse(job.leaseExpiresAt) : 0,
        ),
      ).toISOString();
      await repository.retry(
        ownerId,
        job,
        category,
        scheduledAt,
        at.toISOString(),
      );
    } catch {
      // A coalesced job remains available for a later server invocation.
    }
  }
}

async function replaceMissingCalendar(
  ownerId: string,
  expectedCalendarId: string,
  accessToken: string,
  at: string,
  dependencies: CalendarSyncDependencies,
) {
  const claimToken = dependencies.newClaimToken?.() ?? randomUUID();
  const claim = await dependencies.repository.claimCalendarReplacement(
    ownerId,
    expectedCalendarId,
    claimToken,
    at,
  );
  if (claim.state === "busy" || claim.state === "stale") return null;

  let calendarId: string;
  if (claim.state === "resume") {
    calendarId = claim.calendarId;
    if (!(await dependencies.gateway.calendarExists(accessToken, calendarId))) {
      return null;
    }
  } else {
    try {
      calendarId = await dependencies.gateway.createCalendar(accessToken);
    } catch (error) {
      if (outcomeOf(error) === "known_failure") {
        await dependencies.repository.releaseCalendarReplacement(
          ownerId,
          expectedCalendarId,
          claimToken,
          at,
        );
      }
      throw error;
    }
    const staged = await dependencies.repository.stageCalendarReplacement(
      ownerId,
      expectedCalendarId,
      claimToken,
      calendarId,
      at,
    );
    if (!staged) return null;
  }
  const completed = await dependencies.repository.completeCalendarReplacement(
    ownerId,
    expectedCalendarId,
    claimToken,
    calendarId,
    at,
  );
  if (completed !== "completed") return null;
  await dependencies.repository.reconcileJobs(ownerId, at, at);
  return calendarId;
}

export async function synchronizeOwnerCalendar(
  ownerId: string,
  dependencies: CalendarSyncDependencies,
): Promise<CalendarSyncSummary> {
  if (dependencies.enabled === false) return DISABLED;

  const at = dependencies.now?.() ?? new Date();
  const atIso = at.toISOString();
  let connection: CalendarConnection | null;
  try {
    connection = await dependencies.repository.getConnection(ownerId);
  } catch {
    return {
      state: "pending",
      pendingCount: 0,
      lastSyncAt: null,
      nextRetryAt: null,
    };
  }
  if (!connection || connection.status === "disconnected") {
    return sanitizedStatus(dependencies.repository, ownerId, {
      state: "not_connected",
      pendingCount: 0,
      lastSyncAt: connection?.lastSyncAt ?? null,
      nextRetryAt: null,
    });
  }
  if (
    connection.status === "reconnect_required" ||
    !connection.refreshTokenEnvelope
  ) {
    return reconnectRequired(
      dependencies.repository,
      ownerId,
      atIso,
      connection.lastSyncAt,
    );
  }

  let accessToken: string;
  try {
    const refreshToken = dependencies.decryptRefreshToken(
      connection.refreshTokenEnvelope,
    );
    accessToken = (
      await dependencies.refreshAccessToken(refreshToken)
    ).accessToken;
  } catch (error) {
    if (categoryOf(error) === "authorization") {
      return reconnectRequired(
        dependencies.repository,
        ownerId,
        atIso,
        connection.lastSyncAt,
      );
    }
    return sanitizedStatus(dependencies.repository, ownerId, {
      state: "pending",
      pendingCount: 0,
      lastSyncAt: connection.lastSyncAt,
      nextRetryAt: null,
    });
  }

  let calendarId = connection.calendarId;
  try {
    const exists = await dependencies.gateway.calendarExists(
      accessToken,
      calendarId,
    );
    if (exists) {
      await dependencies.repository.reconcileJobs(
        ownerId,
        connection.connectedAt,
        atIso,
      );
    } else {
      const replacement = await replaceMissingCalendar(
        ownerId,
        calendarId,
        accessToken,
        atIso,
        dependencies,
      );
      if (!replacement) {
        return sanitizedStatus(dependencies.repository, ownerId, {
          state: "pending",
          pendingCount: 0,
          lastSyncAt: connection.lastSyncAt,
          nextRetryAt: null,
        });
      }
      calendarId = replacement;
    }
  } catch (error) {
    if (categoryOf(error) === "authorization") {
      return reconnectRequired(
        dependencies.repository,
        ownerId,
        atIso,
        connection.lastSyncAt,
      );
    }
    return sanitizedStatus(dependencies.repository, ownerId, {
      state: "pending",
      pendingCount: 0,
      lastSyncAt: connection.lastSyncAt,
      nextRetryAt: null,
    });
  }

  let claimedCount = 0;
  for (let operation = 0; operation < 25; operation += 1) {
    const claimedAt = dependencies.now?.() ?? new Date();
    let job: CalendarJob | undefined;
    try {
      [job] = await dependencies.repository.claimDueJobs(
        ownerId,
        claimedAt.toISOString(),
        new Date(claimedAt.getTime() + JOB_LEASE_MS).toISOString(),
        1,
      );
    } catch {
      return sanitizedStatus(dependencies.repository, ownerId, {
        state: "pending",
        pendingCount: claimedCount,
        lastSyncAt: connection.lastSyncAt,
        nextRetryAt: null,
      });
    }
    if (!job) break;
    claimedCount += 1;

    try {
      const record = await dependencies.repository.loadJobRecord(
        ownerId,
        job.sessionId,
      );
      if (record.session.isDemo) {
        await dependencies.repository.completeDelete(
          ownerId,
          job,
          calendarId,
          (dependencies.now?.() ?? new Date()).toISOString(),
        );
        continue;
      }
      if (record.session.revision !== job.targetRevision) {
        const supersededAt = (dependencies.now?.() ?? new Date()).toISOString();
        await dependencies.repository.retry(
          ownerId,
          job,
          "transient",
          supersededAt,
          supersededAt,
        );
        continue;
      }

      const link = await dependencies.repository.eventLink(
        ownerId,
        job.sessionId,
      );
      if (job.desiredAction === "delete" || record.session.deletedAt) {
        if (link) {
          await dependencies.gateway.deleteEvent(
            accessToken,
            calendarId,
            link.eventId,
          );
        }
        await dependencies.repository.completeDelete(
          ownerId,
          job,
          calendarId,
          (dependencies.now?.() ?? new Date()).toISOString(),
        );
        continue;
      }
      if (!record.practice) {
        const failureAt = dependencies.now?.() ?? new Date();
        await dependencies.repository.retry(
          ownerId,
          job,
          "permanent",
          retryAt(failureAt, job.attempts),
          failureAt.toISOString(),
        );
        continue;
      }

      const eventId = eventIdForSession(
        ownerId,
        record.session.id,
        dependencies.eventIdKey,
      );
      const event = projectCalendarEvent({
        ownerId,
        session: {
          id: record.session.id,
          starts_at: record.session.startsAt,
          ends_at: record.session.endsAt,
          status: record.session.status,
          revision: record.session.revision,
        },
        practice: {
          name: record.practice.name,
          billing_address: record.practice.billingAddress,
        },
        eventId,
      });
      await dependencies.gateway.upsertEvent(accessToken, calendarId, event);
      await dependencies.repository.completeUpsert(
        ownerId,
        job,
        calendarId,
        eventId,
        record.session.status === "cancelled" ? "cancelled" : "active",
        (dependencies.now?.() ?? new Date()).toISOString(),
      );
    } catch (error) {
      const category = categoryOf(error);
      const failureAt = dependencies.now?.() ?? new Date();
      const failureAtIso = failureAt.toISOString();
      if (category === "authorization") {
        return reconnectRequired(
          dependencies.repository,
          ownerId,
          failureAtIso,
          connection.lastSyncAt,
        );
      }
      if (category === "calendar_missing") {
        try {
          await replaceMissingCalendar(
            ownerId,
            calendarId,
            accessToken,
            failureAtIso,
            dependencies,
          );
        } catch (replacementError) {
          const replacementCategory = categoryOf(replacementError);
          const replacementFailureAt = dependencies.now?.() ?? new Date();
          if (replacementCategory === "authorization") {
            return reconnectRequired(
              dependencies.repository,
              ownerId,
              replacementFailureAt.toISOString(),
              connection.lastSyncAt,
            );
          }
          await retryJobs(
            dependencies.repository,
            ownerId,
            [job],
            replacementCategory,
            replacementFailureAt,
            outcomeOf(replacementError),
          );
        }
        break;
      }
      await retryJobs(
        dependencies.repository,
        ownerId,
        [job],
        category,
        failureAt,
        outcomeOf(error),
      );
    }
  }

  return sanitizedStatus(dependencies.repository, ownerId, {
    state: claimedCount ? "pending" : "connected",
    pendingCount: claimedCount,
    lastSyncAt: connection.lastSyncAt,
    nextRetryAt: null,
  });
}
