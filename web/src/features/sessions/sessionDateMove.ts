import {
  isoToLondonFormValues,
  londonDateTimeToIso,
} from "@/features/sessions/SessionForm";

export function moveSessionInstantsToLondonDate(input: {
  startsAt: string;
  endsAt: string;
  targetDate: string;
}) {
  const start = isoToLondonFormValues(input.startsAt);
  const end = isoToLondonFormValues(input.endsAt);
  const startsAt = londonDateTimeToIso(input.targetDate, start.time);
  const endsAt = londonDateTimeToIso(input.targetDate, end.time);

  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("The moved session must end after it starts.");
  }

  return { startsAt, endsAt };
}
