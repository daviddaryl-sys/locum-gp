"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { GuidedStepShell } from "@/components/guided/GuidedStepShell";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { durationHours, sessionValuePence } from "@/domain/session";
import {
  formatPenceForInput,
  parsePoundsToPence,
} from "@/features/practices/PracticeForm";

export type SessionPractice = {
  id: string;
  name: string;
  defaultHourlyRatePence: number;
  archived: boolean;
};

export type SessionFormValues = {
  practiceId: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRatePounds: string;
  notes: string;
  completed: boolean;
};

export type SessionInput = {
  practiceId: string;
  startsAt: string;
  endsAt: string;
  hourlyRatePence: number;
  status: "planned" | "completed";
  notes: string;
};

type SessionFormErrors = Partial<
  Record<"practiceId" | "date" | "startTime" | "endTime" | "hourlyRatePounds", string>
>;

type SessionFormProps = {
  initialValues: SessionFormValues;
  invoiced?: boolean;
  onSubmit: (input: SessionInput) => Promise<void>;
  practices: SessionPractice[];
  submitLabel?: string;
};

const todayInLondon = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const emptySessionFormValues: SessionFormValues = {
  practiceId: "",
  date: todayInLondon(),
  startTime: "09:00",
  endTime: "17:00",
  hourlyRatePounds: "",
  notes: "",
  completed: false,
};

export function sessionFormValuesForDate(
  dateKey: string | null,
): SessionFormValues {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!match) return { ...emptySessionFormValues };

  const [, year, month, day] = match;
  const candidate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  const isExactDate =
    candidate.getUTCFullYear() === Number(year) &&
    candidate.getUTCMonth() === Number(month) - 1 &&
    candidate.getUTCDate() === Number(day);

  return isExactDate
    ? { ...emptySessionFormValues, date: dateKey as string }
    : { ...emptySessionFormValues };
}

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function londonParts(value: Date) {
  const parts = londonFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

export function londonDateTimeToIso(date: string, time: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(
    `${date} ${time}`,
  );
  if (!match) throw new Error("Choose a valid local date and time.");
  const [, year, month, day, hour, minute] = match;
  const numbers = [year, month, day, hour, minute].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber] = numbers;
  const calendarCheck = new Date(
    Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber),
  );
  if (
    calendarCheck.getUTCFullYear() !== yearNumber ||
    calendarCheck.getUTCMonth() !== monthNumber - 1 ||
    calendarCheck.getUTCDate() !== dayNumber ||
    hourNumber > 23 ||
    minuteNumber > 59
  ) {
    throw new Error("Choose a valid local date and time.");
  }

  const wallTime = calendarCheck.getTime();
  const wanted = { year, month, day, hour, minute };
  const candidates = [-60, 0, 60, 120]
    .map((offsetMinutes) => new Date(wallTime - offsetMinutes * 60_000))
    .filter((candidate) => {
      const actual = londonParts(candidate);
      return Object.entries(wanted).every(
        ([key, value]) => actual[key as keyof typeof actual] === value,
      );
    });

  if (candidates.length === 0) {
    throw new Error("Choose a valid local date and time.");
  }
  if (candidates.length > 1) {
    throw new Error("This local time occurs twice. Choose another time.");
  }
  return candidates[0].toISOString();
}

export function isoToLondonFormValues(iso: string) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) throw new Error("Session time is invalid.");
  const parts = londonParts(value);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function validate(values: SessionFormValues) {
  const errors: SessionFormErrors = {};
  const rate = parsePoundsToPence(values.hourlyRatePounds);
  let startsAt: string | undefined;
  let endsAt: string | undefined;

  if (!values.practiceId) errors.practiceId = "Choose a practice.";
  try {
    startsAt = londonDateTimeToIso(values.date, values.startTime);
  } catch (error) {
    errors.startTime =
      error instanceof Error ? error.message : "Choose a valid local date and time.";
  }
  try {
    endsAt = londonDateTimeToIso(values.date, values.endTime);
  } catch (error) {
    errors.endTime =
      error instanceof Error ? error.message : "Choose a valid local date and time.";
  }
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.endTime = "End time must be later than start time.";
  }
  if (rate === null) {
    errors.hourlyRatePounds = "Enter a valid hourly rate in pounds.";
  }

  if (Object.keys(errors).length || !startsAt || !endsAt || rate === null) {
    return { errors };
  }
  return {
    errors,
    input: {
      practiceId: values.practiceId,
      startsAt,
      endsAt,
      hourlyRatePence: rate,
      status: values.completed ? "completed" : "planned",
      notes: values.notes.trim(),
    } satisfies SessionInput,
  };
}

function formatGBP(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function durationLabel(hours: number) {
  const value = hours.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return `${value} ${hours === 1 ? "hour" : "hours"}`;
}

export function SessionForm({
  initialValues,
  invoiced = false,
  onSubmit,
  practices,
  submitLabel = "Save session",
}: SessionFormProps) {
  const formId = useId();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<SessionFormErrors>({});
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const rateManuallyEdited = useRef(Boolean(initialValues.hourlyRatePounds));
  const editable = !saving && !invoiced;

  const update = <K extends keyof SessionFormValues>(
    field: K,
    value: SessionFormValues[K],
  ) => {
    if (!editable || inFlight.current) return;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (field === "date" || field === "startTime" || field === "endTime") {
        return { ...current, date: undefined, startTime: undefined, endTime: undefined };
      }
      return { ...current, [field]: undefined };
    });
    setSaveMessage("");
  };

  const valueSummary = useMemo(() => {
    const rate = parsePoundsToPence(values.hourlyRatePounds);
    if (rate === null) return "Enter a rate to calculate this session's value.";
    try {
      const startsAt = londonDateTimeToIso(values.date, values.startTime);
      const endsAt = londonDateTimeToIso(values.date, values.endTime);
      const hours = durationHours(startsAt, endsAt);
      return `${durationLabel(hours)} × ${formatGBP(rate)} = ${formatGBP(
        sessionValuePence(hours, rate),
      )}`;
    } catch {
      return "Choose valid times to calculate this session's value.";
    }
  }, [values.date, values.endTime, values.hourlyRatePounds, values.startTime]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || invoiced) return;
    const result = validate(values);
    setErrors(result.errors);
    setSaveMessage("");
    if (!result.input) return;

    inFlight.current = true;
    setSaving(true);
    try {
      await onSubmit(result.input);
      setSaveMessage("Saved on this device.");
    } catch {
      setSaveMessage("Session could not be saved. Your entries have been kept.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <GuidedStepShell
      actionFormId={invoiced ? undefined : formId}
      actionLabel="Session actions"
      actions={
        invoiced ? null : (
          <Button form={formId} loading={saving} type="submit">
            {submitLabel}
          </Button>
        )
      }
      intro="Add the work details, then save the session."
      title="Session details"
    >
      <form className="record-form" id={formId} onSubmit={submit}>
        {invoiced ? (
          <p className="record-form__notice">
            This session is included on an invoice and is read-only.
          </p>
        ) : null}
        <div className="record-form__fields record-form__fields--guided">
          <div className="record-form__group">
            <div className="text-field">
              <label className="text-field__label" htmlFor="session-practice">
                Practice
              </label>
              <select
                aria-describedby={errors.practiceId ? "session-practice-error" : undefined}
                aria-invalid={Boolean(errors.practiceId)}
                className="text-field__input"
                disabled={!editable}
                id="session-practice"
                onChange={(event) => {
                  const practice = practices.find((item) => item.id === event.target.value);
                  if (!practice) {
                    update("practiceId", "");
                    return;
                  }
                  setValues((current) => ({
                    ...current,
                    practiceId: practice.id,
                    hourlyRatePounds: rateManuallyEdited.current
                      ? current.hourlyRatePounds
                      : formatPenceForInput(practice.defaultHourlyRatePence),
                  }));
                  setErrors((current) => ({ ...current, practiceId: undefined }));
                }}
                value={values.practiceId}
              >
                <option value="">Choose a practice</option>
                {practices.map((practice) => {
                  const retained = practice.id === initialValues.practiceId;
                  return (
                    <option
                      disabled={practice.archived && !retained}
                      key={practice.id}
                      value={practice.id}
                    >
                      {practice.name}{practice.archived ? " — archived" : ""}
                    </option>
                  );
                })}
              </select>
              {errors.practiceId ? (
                <p className="text-field__error" id="session-practice-error" role="alert">
                  {errors.practiceId}
                </p>
              ) : null}
            </div>
          </div>

          <div className="record-form__group">
            <div className="record-form__time-grid">
              <TextField
                disabled={!editable}
                error={errors.date}
                label="Session date"
                onChange={(event) => update("date", event.target.value)}
                type="date"
                value={values.date}
              />
              <TextField
                disabled={!editable}
                error={errors.startTime}
                label="Start time"
                onChange={(event) => update("startTime", event.target.value)}
                type="time"
                value={values.startTime}
              />
              <TextField
                disabled={!editable}
                error={errors.endTime}
                label="End time"
                onChange={(event) => update("endTime", event.target.value)}
                type="time"
                value={values.endTime}
              />
            </div>
            <p className="record-form__hint">Times use Europe/London.</p>
          </div>

          <div className="record-form__group">
            <label className="record-form__check">
              <input
                checked={values.completed}
                disabled={!editable}
                onChange={(event) => update("completed", event.target.checked)}
                type="checkbox"
              />
              Completed
            </label>
            <TextField
              disabled={!editable}
              hint="Optional"
              label="Notes"
              onChange={(event) => update("notes", event.target.value)}
              value={values.notes}
            />
          </div>

          <div className="record-form__group">
            <TextField
              disabled={!editable}
              error={errors.hourlyRatePounds}
              hint="Amount in pounds, for example 60.00"
              inputMode="decimal"
              label="Hourly rate"
              onChange={(event) => {
                rateManuallyEdited.current = true;
                update("hourlyRatePounds", event.target.value);
              }}
              value={values.hourlyRatePounds}
            />
            <p aria-live="polite" className="record-form__value">
              {valueSummary}
            </p>
          </div>
        </div>
        {saveMessage ? (
          <p
            className={
              saveMessage.startsWith("Session could")
                ? "record-form__error"
                : "record-form__success"
            }
            role={saveMessage.startsWith("Session could") ? "alert" : "status"}
          >
            {saveMessage}
          </p>
        ) : null}
      </form>
    </GuidedStepShell>
  );
}
