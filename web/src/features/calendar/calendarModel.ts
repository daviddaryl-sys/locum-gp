export type CalendarSession = {
  id: string;
  practiceName: string;
  startsAt: string;
  endsAt: string;
  status: "planned" | "completed" | "invoiced" | "cancelled";
  isDemo: boolean;
};

export type CalendarMonth = { month: number; year: number };

export type CalendarDay = { dateKey: string; day: number; inMonth: boolean };

export function calendarDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  })
    .format(new Date(`${dateKey}T12:00:00.000Z`))
    .replace(",", "");
}

export function calendarTimeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

export function calendarStatusLabel(status: CalendarSession["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function practiceColourIndex(practiceName: string) {
  let hash = 0;
  for (const character of practiceName.trim().toLowerCase()) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash % 6;
}

export function londonDateKey(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/London",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function moveMonth(value: CalendarMonth, delta: -1 | 1): CalendarMonth {
  const date = new Date(Date.UTC(value.year, value.month - 1 + delta, 1));
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

export function buildMonthGrid(value: CalendarMonth): CalendarDay[] {
  const first = new Date(Date.UTC(value.year, value.month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(value.year, value.month - 1, index - mondayOffset + 1));
    return {
      dateKey: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === value.month - 1,
    };
  });
}

export function groupCalendarSessions(sessions: CalendarSession[]) {
  const result = new Map<string, CalendarSession[]>();
  for (const session of [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = londonDateKey(session.startsAt);
    result.set(key, [...(result.get(key) ?? []), session]);
  }
  return result;
}
