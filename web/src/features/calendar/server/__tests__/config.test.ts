// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CALENDAR_SCOPE,
  calendarFeatureEnabled,
  readCalendarConfig,
} from "../config";

describe("Calendar server configuration", () => {
  it("enables the feature only for the exact lowercase true value", () => {
    expect(
      calendarFeatureEnabled({
        NODE_ENV: "test",
        GOOGLE_CALENDAR_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      calendarFeatureEnabled({
        NODE_ENV: "test",
        GOOGLE_CALENDAR_ENABLED: "TRUE",
      }),
    ).toBe(false);
  });

  it("fails closed when enabled configuration is incomplete", () => {
    expect(() =>
      readCalendarConfig({
        NODE_ENV: "test",
        GOOGLE_CALENDAR_ENABLED: "true",
      }),
    ).toThrow("Google Calendar configuration is unavailable.");
  });

  it("returns the exact narrow scope and a canonical callback URL", () => {
    const config = readCalendarConfig({
      NODE_ENV: "test",
      GOOGLE_CALENDAR_ENABLED: "true",
      GOOGLE_CALENDAR_CLIENT_ID: "fictional-client-id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "fictional-client-secret",
      GOOGLE_CALENDAR_REDIRECT_ORIGIN: "https://locum-manager.example",
      GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    });

    expect(CALENDAR_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
    expect(config.redirectUri).toBe(
      "https://locum-manager.example/api/google-calendar/callback",
    );
    expect(config.tokenKey).toHaveLength(32);
  });

  it.each([
    "http://locum-manager.example",
    "https://locum-manager.example/path",
    "https://locum-manager.example/?query=1",
    "https://locum-manager.example/#fragment",
  ])("rejects an unsafe redirect origin: %s", (origin) => {
    expect(() =>
      readCalendarConfig({
        NODE_ENV: "test",
        GOOGLE_CALENDAR_ENABLED: "true",
        GOOGLE_CALENDAR_CLIENT_ID: "fictional-client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "fictional-client-secret",
        GOOGLE_CALENDAR_REDIRECT_ORIGIN: origin,
        GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow("Google Calendar configuration is unavailable.");
  });
});
