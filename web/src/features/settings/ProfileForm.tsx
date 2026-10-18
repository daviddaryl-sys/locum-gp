"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { OfflineRepository } from "@/offline/repository";
import type { RecordPayload } from "@/offline/types";
import type { EncryptedVault } from "@/security/vault";
import { useSync } from "@/sync/SyncProvider";
import {
  normalizeProfileAndPayments,
  normalizeSortCode,
  validateProfileAndPayments,
  type ProfileAndPaymentsInput,
} from "./profilePaymentsDomain";
import {
  getProfileAndPayments,
  ProfilePaymentsUnauthenticatedError,
  putProfileAndPayments,
} from "./profilePaymentsClient";

export type ProfileInput = {
  doctorName: string;
  tradingName: string;
  address: string;
  email: string;
  invoicePrefix: string;
  accountName: string;
  sortCode: string;
  accountNumber: string;
  passcode?: string;
};

type ProfileField = Exclude<keyof ProfileInput, "passcode">;
export type ProfileErrors = Partial<Record<ProfileField, string>>;
type PaymentState = "loading" | "ready" | "missing" | "upgrade_required" | "unauthenticated" | "error";

const EMPTY_PROFILE: ProfileInput = {
  doctorName: "",
  tradingName: "",
  address: "",
  email: "",
  invoicePrefix: "INV",
  accountName: "",
  sortCode: "",
  accountNumber: "",
};

export function validateProfileInput(input: ProfileInput, paymentRequired: boolean): ProfileErrors {
  return validateProfileAndPayments({
    profile: {
      doctorName: input.doctorName,
      tradingName: input.tradingName,
      address: input.address,
      email: input.email,
    },
    invoicePrefix: input.invoicePrefix,
    ...(paymentRequired ? {
      paymentDetails: {
        accountName: input.accountName,
        sortCode: input.sortCode,
        accountNumber: input.accountNumber,
      },
    } : {}),
  }, paymentRequired);
}

/** Compatibility helper for encrypted version-1 records created by older clients. */
export function profileSettingPayload(
  input: ProfileInput,
  vault: EncryptedVault,
  existingSettings: RecordPayload = {},
): RecordPayload {
  const existingProfile = existingSettings.profile &&
    typeof existingSettings.profile === "object" &&
    !Array.isArray(existingSettings.profile)
    ? existingSettings.profile as Record<string, unknown>
    : {};
  return {
    ...existingSettings,
    profile: {
      ...existingProfile,
      doctorName: input.doctorName.trim(),
      tradingName: input.tradingName.trim(),
      address: input.address.trim(),
      email: input.email.trim(),
    },
    invoicePrefix: input.invoicePrefix.trim().toUpperCase(),
    ciphertext: vault.ciphertext,
    salt: vault.salt,
    initializationVector: vault.initializationVector,
    kdfParameters: vault.kdfParameters,
    encryptionVersion: vault.version,
  };
}

function ProfileFormEditor({ ownerId, repository }: { ownerId: string; repository: OfflineRepository | null }) {
  const [values, setValues] = useState<ProfileInput>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentState, setPaymentState] = useState<PaymentState>("loading");
  const [paymentSummary, setPaymentSummary] = useState<{ accountName: string; accountNumberLast4: string } | null>(null);
  const [editingPayment, setEditingPayment] = useState(false);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getProfileAndPayments(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.state === "ready") {
          setValues({
            doctorName: result.profile.doctorName,
            tradingName: result.profile.tradingName,
            address: result.profile.address,
            email: result.profile.email,
            invoicePrefix: result.invoicePrefix,
            accountName: "",
            sortCode: "",
            accountNumber: "",
          });
          setPaymentSummary(result.paymentSummary);
          setPaymentState("ready");
          return;
        }
        if ((result.state === "missing" || result.state === "upgrade_required") && result.profile && result.invoicePrefix) {
          setValues({
            doctorName: result.profile.doctorName,
            tradingName: result.profile.tradingName,
            address: result.profile.address,
            email: result.profile.email,
            invoicePrefix: result.invoicePrefix,
            accountName: "",
            sortCode: "",
            accountNumber: "",
          });
        }
        setPaymentState(result.state);
        setEditingPayment(result.state === "missing" || result.state === "upgrade_required");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPaymentState("error");
      });
    return () => {
      controller.abort();
      saveController.current?.abort();
      saveController.current = null;
    };
  }, [ownerId]);

  const update = (field: ProfileField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage("");
  };

  const beginPaymentEdit = () => {
    setValues((current) => ({ ...current, accountName: "", sortCode: "", accountNumber: "" }));
    setEditingPayment(true);
    setMessage("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const paymentRequired = editingPayment || paymentState !== "ready";
    const validation = validateProfileInput(values, paymentRequired);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    if (!repository || repository.ownerId !== ownerId) {
      setMessage("Offline storage is not ready. Your entries have been kept.");
      return;
    }
    const input: ProfileAndPaymentsInput = normalizeProfileAndPayments({
      profile: {
        doctorName: values.doctorName,
        tradingName: values.tradingName,
        address: values.address,
        email: values.email,
      },
      invoicePrefix: values.invoicePrefix,
      ...(paymentRequired ? {
        paymentDetails: {
          accountName: values.accountName,
          sortCode: normalizeSortCode(values.sortCode),
          accountNumber: values.accountNumber.replace(/\D/g, ""),
        },
      } : {}),
    });
    saveController.current?.abort();
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const result = await putProfileAndPayments(input, controller.signal);
      if (controller.signal.aborted || repository.ownerId !== ownerId) return;
      await repository.reconcileServerRecord(
        "settings",
        result.settingsRecord.id,
        result.settingsRecord.data,
        result.settingsRecord.revision,
        result.settingsRecord.updatedAt,
        (local, server) => {
          const profile = local?.data.profile;
          const profession = profile && typeof profile === "object" && !Array.isArray(profile)
            ? (profile as Record<string, unknown>).profession
            : null;
          if (profession !== "gp" && profession !== "pharmacist") return server;
          const serverProfile = server.profile && typeof server.profile === "object" && !Array.isArray(server.profile)
            ? server.profile as Record<string, unknown>
            : {};
          return { ...server, profile: { ...serverProfile, profession } };
        },
      );
      setValues({
        doctorName: result.profile.doctorName,
        tradingName: result.profile.tradingName,
        address: result.profile.address,
        email: result.profile.email,
        invoicePrefix: result.invoicePrefix,
        accountName: "",
        sortCode: "",
        accountNumber: "",
      });
      setPaymentSummary(result.paymentSummary);
      setPaymentState("ready");
      setEditingPayment(false);
      setMessage("Profile and payment details saved.");
    } catch (error) {
      if (error instanceof ProfilePaymentsUnauthenticatedError) {
        setValues(EMPTY_PROFILE);
        setErrors({});
        setPaymentSummary(null);
        setPaymentState("unauthenticated");
        setEditingPayment(false);
        setMessage("");
      } else if (!(error instanceof Error && error.name === "AbortError")) {
        setMessage("Settings could not be saved. Your entries have been kept.");
      }
    } finally {
      if (saveController.current === controller) {
        saveController.current = null;
        setBusy(false);
      }
    }
  };

  const field = (name: ProfileField, label: string, options: { type?: string; autoComplete?: string } = {}) => (
    <div className="profile-form__field">
      <label htmlFor={`profile-${name}`}>
        {label}
        <input
          aria-describedby={errors[name] ? `profile-${name}-error` : undefined}
          aria-invalid={errors[name] ? true : undefined}
          autoComplete={options.autoComplete}
          disabled={busy}
          id={`profile-${name}`}
          onChange={(event) => update(name, event.target.value)}
          type={options.type ?? "text"}
          value={values[name]}
        />
      </label>
      {errors[name] ? <span className="text-field__error" id={`profile-${name}-error`} role="alert">{errors[name]}</span> : null}
    </div>
  );

  if (paymentState === "loading") return <p className="record-page__runtime" role="status">Loading profile and payments</p>;
  if (paymentState === "unauthenticated") return <p className="record-form__error" role="alert">Please sign in again to manage payment details.</p>;
  if (paymentState === "error") return <p className="record-form__error" role="alert">Settings could not be loaded. Try again shortly.</p>;

  const showPaymentFields = editingPayment || paymentState === "missing" || paymentState === "upgrade_required";
  const messageIsError = message.includes("could not") || message.includes("not ready");
  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset>
        <legend>Professional profile</legend>
        {field("doctorName", "Name", { autoComplete: "name" })}
        {field("tradingName", "Trading name (optional)")}
        {field("address", "Address", { autoComplete: "street-address" })}
        {field("email", "Email address", { type: "email", autoComplete: "email" })}
        {field("invoicePrefix", "Invoice prefix")}
      </fieldset>
      <fieldset>
        <legend>Payment details</legend>
        {paymentState === "upgrade_required" ? <p>Enter your bank details once to upgrade your saved payment details.</p> : null}
        {paymentState === "missing" ? <p>Enter your bank details to save payment details.</p> : null}
        {paymentState === "ready" && paymentSummary && !showPaymentFields ? (
          <>
            <p>Payment details saved</p>
            <p>{paymentSummary.accountName}</p>
            <p>••-••-••</p>
            <p>•••• {paymentSummary.accountNumberLast4}</p>
            <Button onClick={beginPaymentEdit} type="button">Change payment details</Button>
          </>
        ) : null}
        {showPaymentFields ? <>
          {field("accountName", "Account name", { autoComplete: "off" })}
          {field("sortCode", "Sort code", { autoComplete: "off" })}
          {field("accountNumber", "Account number", { autoComplete: "off" })}
        </> : null}
      </fieldset>
      {message ? <p className={messageIsError ? "record-form__error" : "record-form__success"} role={messageIsError ? "alert" : "status"}>{message}</p> : null}
      <Button loading={busy} type="submit">Save profile and payments</Button>
    </form>
  );
}

export function ProfileForm() {
  const { ownerId, repository } = useSync();
  if (!ownerId) return <p className="record-form__error" role="alert">Please sign in again to manage payment details.</p>;
  return <ProfileFormEditor key={ownerId} ownerId={ownerId} repository={repository} />;
}
