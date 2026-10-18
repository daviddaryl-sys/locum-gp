import { describe, expect, it } from "vitest";

import { moveSessionInstantsToLondonDate } from "../sessionDateMove";

describe("moveSessionInstantsToLondonDate", () => {
  it("moves a session to another date in the same London offset", () => {
    expect(
      moveSessionInstantsToLondonDate({
        startsAt: "2026-08-11T09:00:00.000Z",
        endsAt: "2026-08-11T15:00:00.000Z",
        targetDate: "2026-08-14",
      }),
    ).toEqual({
      startsAt: "2026-08-14T09:00:00.000Z",
      endsAt: "2026-08-14T15:00:00.000Z",
    });
  });

  it("preserves London wall times when moving from winter to summer", () => {
    expect(
      moveSessionInstantsToLondonDate({
        startsAt: "2026-01-12T09:00:00.000Z",
        endsAt: "2026-01-12T15:00:00.000Z",
        targetDate: "2026-07-14",
      }),
    ).toEqual({
      startsAt: "2026-07-14T08:00:00.000Z",
      endsAt: "2026-07-14T14:00:00.000Z",
    });
  });

  it("preserves London wall times when moving from summer to winter", () => {
    expect(
      moveSessionInstantsToLondonDate({
        startsAt: "2026-08-11T09:00:00.000Z",
        endsAt: "2026-08-11T15:00:00.000Z",
        targetDate: "2026-12-14",
      }),
    ).toEqual({
      startsAt: "2026-12-14T10:00:00.000Z",
      endsAt: "2026-12-14T16:00:00.000Z",
    });
  });

  it("rejects an invalid target date", () => {
    expect(() =>
      moveSessionInstantsToLondonDate({
        startsAt: "2026-08-11T09:00:00.000Z",
        endsAt: "2026-08-11T15:00:00.000Z",
        targetDate: "2026-02-30",
      }),
    ).toThrow("Choose a valid local date and time.");
  });

  it.each([
    ["nonexistent", "2026-03-29", "Choose a valid local date and time."],
    [
      "ambiguous",
      "2026-10-25",
      "This local time occurs twice. Choose another time.",
    ],
  ])("rejects a %s Europe/London wall time", (_kind, targetDate, message) => {
    expect(() =>
      moveSessionInstantsToLondonDate({
        startsAt: "2026-01-12T01:30:00.000Z",
        endsAt: "2026-01-12T02:30:00.000Z",
        targetDate,
      }),
    ).toThrow(message);
  });

  it("rejects a moved session whose end is not later than its start", () => {
    expect(() =>
      moveSessionInstantsToLondonDate({
        startsAt: "2026-08-11T22:00:00.000Z",
        endsAt: "2026-08-12T00:00:00.000Z",
        targetDate: "2026-08-14",
      }),
    ).toThrow("The moved session must end after it starts.");
  });
});
