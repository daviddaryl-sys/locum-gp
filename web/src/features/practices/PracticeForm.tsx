"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";

export type PracticeFormValues = {
  name: string;
  billingAddress: string;
  hourlyRatePounds: string;
  paymentTermsDays: string;
};

export type PracticeInput = {
  name: string;
  billingAddress: { formatted: string };
  defaultHourlyRatePence: number;
  paymentTermsDays: number;
  archived: boolean;
};

type PracticeFormErrors = Partial<Record<keyof PracticeFormValues, string>>;

type PracticeFormProps = {
  archived?: boolean;
  initialValues: PracticeFormValues;
  onArchive?: () => Promise<void>;
  onSubmit: (input: PracticeInput) => Promise<void>;
  submitLabel?: string;
};

export const emptyPracticeFormValues: PracticeFormValues = {
  name: "",
  billingAddress: "",
  hourlyRatePounds: "",
  paymentTermsDays: "30",
};

const SAVE_ERROR = "Practice could not be saved. Your entries have been kept.";
const ARCHIVE_ERROR = "Practice could not be archived. Please try again.";

export function formatPenceForInput(pence: number) {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}`;
}

export function parsePoundsToPence(value: string): number | null {
  const normalized = value.trim().replace(/^£\s*/, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(pence) ? pence : null;
}

function validate(values: PracticeFormValues) {
  const errors: PracticeFormErrors = {};
  const name = values.name.trim();
  const billingAddress = values.billingAddress.trim();
  const defaultHourlyRatePence = parsePoundsToPence(values.hourlyRatePounds);
  const termsText = values.paymentTermsDays.trim();
  const paymentTermsDays = /^\d+$/.test(termsText) ? Number(termsText) : Number.NaN;

  if (!name) errors.name = "Enter a practice name.";
  if (defaultHourlyRatePence === null) {
    errors.hourlyRatePounds = "Enter a valid hourly rate in pounds.";
  }
  if (!Number.isSafeInteger(paymentTermsDays) || paymentTermsDays < 0) {
    errors.paymentTermsDays = "Enter a non-negative whole number of days.";
  }

  if (Object.keys(errors).length || defaultHourlyRatePence === null) {
    return { errors };
  }

  return {
    errors,
    input: {
      name,
      billingAddress: { formatted: billingAddress },
      defaultHourlyRatePence,
      paymentTermsDays,
      archived: false,
    } satisfies PracticeInput,
  };
}

export function PracticeForm({
  archived = false,
  initialValues,
  onArchive,
  onSubmit,
  submitLabel = "Save practice",
}: PracticeFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<PracticeFormErrors>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const update = (field: keyof PracticeFormValues, value: string) => {
    if (inFlight.current || archived) return;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || archived) return;
    const result = validate(values);
    setErrors(result.errors);
    setMessage("");
    if (!result.input) return;

    inFlight.current = true;
    setSaving(true);
    try {
      await onSubmit(result.input);
      setMessage("Saved on this device.");
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!onArchive || inFlight.current || archived) return;
    inFlight.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onArchive();
      setMessage("Practice archived on this device.");
    } catch {
      setMessage(ARCHIVE_ERROR);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const isError = message === SAVE_ERROR || message === ARCHIVE_ERROR;

  return (
    <form className="record-form" onSubmit={submit}>
      {archived ? (
        <p className="record-form__notice">
          This practice is archived and is read-only.
        </p>
      ) : null}
      <div className="record-form__fields">
        <TextField
          autoComplete="organization"
          disabled={saving || archived}
          error={errors.name}
          label="Practice name"
          onChange={(event) => update("name", event.target.value)}
          value={values.name}
        />
        <TextField
          autoComplete="street-address"
          disabled={saving || archived}
          error={errors.billingAddress}
          hint="Used on invoices"
          label="Billing address"
          onChange={(event) => update("billingAddress", event.target.value)}
          value={values.billingAddress}
        />
        <TextField
          disabled={saving || archived}
          error={errors.hourlyRatePounds}
          hint="Amount in pounds, for example 60.00"
          inputMode="decimal"
          label="Default hourly rate"
          onChange={(event) => update("hourlyRatePounds", event.target.value)}
          value={values.hourlyRatePounds}
        />
        <TextField
          disabled={saving || archived}
          error={errors.paymentTermsDays}
          hint="Number of days before payment is due"
          inputMode="numeric"
          label="Payment terms"
          onChange={(event) => update("paymentTermsDays", event.target.value)}
          value={values.paymentTermsDays}
        />
      </div>
      {message ? (
        <p
          className={isError ? "record-form__error" : "record-form__success"}
          role={isError ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
      {!archived ? (
        <div className="record-form__actions">
          <Button loading={saving} type="submit">
            {submitLabel}
          </Button>
          {onArchive ? (
            <Button
              disabled={saving}
              onClick={archive}
              type="button"
              variant="secondary"
            >
              Archive practice
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
