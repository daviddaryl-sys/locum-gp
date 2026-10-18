import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  calendarDateLabel,
  calendarStatusLabel,
  calendarTimeLabel,
  groupCalendarSessions,
  londonDateKey,
  moveMonth,
  practiceColourIndex,
  type CalendarSession,
} from "../calendarModel";

const session = (
  id: string,
  startsAt: string,
  status: CalendarSession["status"] = "planned",
): CalendarSession => ({
  id,
  practiceName: "Fictional Medical Centre",
  startsAt,
  endsAt: "2026-08-11T15:00:00.000Z",
  status,
  isDemo: false,
});

describe("calendar month model", () => {
  it("formats accessible UK calendar labels", () => {
    expect(calendarDateLabel("2026-08-11")).toBe("Tuesday 11 August 2026");
    expect(calendarTimeLabel("2026-08-11T09:00:00.000Z")).toBe("10:00");
    expect(calendarStatusLabel("cancelled")).toBe("Cancelled");
  });

  it("builds a Monday-first 42-cell August 2026 grid", () => {
    const grid = buildMonthGrid({ month: 8, year: 2026 });
    expect(grid).toHaveLength(42);
    expect(grid[0]).toMatchObject({ dateKey: "2026-07-27", inMonth: false });
    expect(grid[5]).toMatchObject({ dateKey: "2026-08-01", inMonth: true });
    expect(grid[41]).toMatchObject({ dateKey: "2026-09-06", inMonth: false });
  });

  it("moves across year boundaries", () => {
    expect(moveMonth({ month: 12, year: 2026 }, 1)).toEqual({ month: 1, year: 2027 });
    expect(moveMonth({ month: 1, year: 2027 }, -1)).toEqual({ month: 12, year: 2026 });
  });

  it("groups exact instants by their Europe/London calendar date", () => {
    expect(londonDateKey("2026-03-29T23:30:00.000Z")).toBe("2026-03-30");
    const grouped = groupCalendarSessions([
      session("later", "2026-08-11T13:00:00.000Z"),
      session("earlier", "2026-08-11T09:00:00.000Z", "cancelled"),
    ]);
    expect(grouped.get("2026-08-11")?.map(({ id }) => id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("assigns stable normalized practice colours within the six-colour palette", () => {
    const names = [
      "Fictional Medical Centre",
      "Northstar Surgery",
      "Willowbrook Practice",
      "Harbour Health Clinic",
    ];
    const indices = names.map(practiceColourIndex);

    expect(practiceColourIndex("  FICTIONAL MEDICAL CENTRE  ")).toBe(
      practiceColourIndex("fictional medical centre"),
    );
    expect(new Set(indices).size).toBeGreaterThanOrEqual(2);
    expect(indices.every((index) => Number.isInteger(index) && index >= 0 && index <= 5)).toBe(
      true,
    );
  });
});
