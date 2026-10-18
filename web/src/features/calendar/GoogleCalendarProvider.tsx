"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { CalendarSyncSummary } from "./server/calendarRepository";
import { requestCalendarSync } from "./googleCalendarClient";

export type GoogleCalendarContextValue = {
  summary: GoogleCalendarSummary;
  syncCalendarNow: () => Promise<void>;
};

export type GoogleCalendarSummary =
  | CalendarSyncSummary
  | {
      state: "loading" | "unavailable";
      pendingCount: 0;
      lastSyncAt: null;
      nextRetryAt: null;
    };

type GoogleCalendarProviderProps = {
  children: ReactNode;
  enabled: boolean;
  ownerId: string;
  now?: () => Date;
  transport?: () => Promise<CalendarSyncSummary>;
};

const DISABLED: CalendarSyncSummary = {
  state: "disabled",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};
const LOADING: GoogleCalendarSummary = {
  state: "loading",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};
const UNAVAILABLE: GoogleCalendarSummary = {
  state: "unavailable",
  pendingCount: 0,
  lastSyncAt: null,
  nextRetryAt: null,
};
const currentTime = () => new Date();

const GoogleCalendarContext = createContext<GoogleCalendarContextValue>({
  summary: DISABLED,
  syncCalendarNow: async () => {},
});

export function GoogleCalendarProvider({
  children,
  enabled,
  ownerId,
  now = currentTime,
  transport = requestCalendarSync,
}: GoogleCalendarProviderProps) {
  return (
    <GoogleCalendarRuntime
      enabled={enabled}
      key={`${enabled}:${ownerId}`}
      now={now}
      transport={transport}
    >
      {children}
    </GoogleCalendarRuntime>
  );
}

function GoogleCalendarRuntime({
  children,
  enabled,
  now,
  transport,
}: {
  children: ReactNode;
  enabled: boolean;
  now: () => Date;
  transport: () => Promise<CalendarSyncSummary>;
}) {
  const [summary, setSummary] = useState<GoogleCalendarSummary>(
    enabled ? LOADING : DISABLED,
  );
  const mountedRef = useRef(false);
  const confirmedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRef = useRef(false);
  const attemptedRetryAtRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const syncCalendarNow = useCallback((): Promise<void> => {
    if (!enabled || !mountedRef.current || !navigator.onLine) {
      return Promise.resolve();
    }
    if (inFlightRef.current) {
      trailingRef.current = true;
      return inFlightRef.current;
    }

    const run = async () => {
      do {
        trailingRef.current = false;
        try {
          const nextSummary = await transport();
          if (!mountedRef.current) return;
          confirmedRef.current = true;
          setSummary(nextSummary);
        } catch {
          if (!mountedRef.current) return;
          if (!confirmedRef.current) setSummary(UNAVAILABLE);
        }
      } while (
        mountedRef.current &&
        navigator.onLine &&
        trailingRef.current
      );
    };
    const tracked = run().finally(() => {
      if (inFlightRef.current === tracked) inFlightRef.current = null;
    });
    inFlightRef.current = tracked;
    return tracked;
  }, [enabled, transport]);

  useEffect(() => {
    mountedRef.current = true;
    clearRetry();
    if (!enabled) {
      return () => {
        mountedRef.current = false;
        trailingRef.current = false;
        clearRetry();
      };
    }

    if (navigator.onLine) queueMicrotask(() => void syncCalendarNow());
    const handleOnline = () => void syncCalendarNow();
    window.addEventListener("online", handleOnline);
    return () => {
      mountedRef.current = false;
      trailingRef.current = false;
      clearRetry();
      window.removeEventListener("online", handleOnline);
    };
  }, [clearRetry, enabled, syncCalendarNow]);

  useEffect(() => {
    clearRetry();
    if (
      !enabled ||
      summary.state !== "pending" ||
      summary.nextRetryAt === null
    ) {
      attemptedRetryAtRef.current = null;
      return;
    }
    if (attemptedRetryAtRef.current === summary.nextRetryAt) return;
    const retryAt = Date.parse(summary.nextRetryAt);
    if (!Number.isFinite(retryAt)) return;
    const scheduledRetryAt = summary.nextRetryAt;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      attemptedRetryAtRef.current = scheduledRetryAt;
      void syncCalendarNow();
    }, Math.max(0, retryAt - now().getTime()));
    return clearRetry;
  }, [clearRetry, enabled, now, summary, syncCalendarNow]);

  const value = useMemo<GoogleCalendarContextValue>(
    () => ({ summary, syncCalendarNow }),
    [summary, syncCalendarNow],
  );
  return (
    <GoogleCalendarContext.Provider value={value}>
      {children}
    </GoogleCalendarContext.Provider>
  );
}

export function useGoogleCalendar() {
  return useContext(GoogleCalendarContext);
}
