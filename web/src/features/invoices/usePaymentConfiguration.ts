import { useEffect, useState } from "react";

import { getProfileAndPayments } from "@/features/settings/profilePaymentsClient";
import type { PublicProfile } from "@/features/settings/profilePaymentsDomain";
import type { ServerPaymentEnvelope } from "@/security/paymentEnvelope";
import type { BankDetails } from "@/security/vault";

export type PaymentConfigurationState =
  | { state: "loading" }
  | { state: "offline" | "missing" | "upgrade_required" | "unauthenticated" | "error" }
  | {
      state: "ready";
      paymentDetails: BankDetails;
      encryptedSnapshot: ServerPaymentEnvelope;
      issuer: PublicProfile;
      invoicePrefix: string;
    };

type Input = { ownerId: string | null; online: boolean };
type Entry = { input: Input; generation: number; value: PaymentConfigurationState };

function sameInput(left: Input, right: Input) {
  return left.ownerId === right.ownerId && left.online === right.online;
}

function initialState(input: Input): PaymentConfigurationState {
  if (!input.online) return { state: "offline" };
  if (!input.ownerId) return { state: "unauthenticated" };
  return { state: "loading" };
}

export function usePaymentConfiguration(
  ownerId: string | null,
  online: boolean,
): PaymentConfigurationState {
  const input = { ownerId, online };
  const [entry, setEntry] = useState<Entry>(() => ({
    input,
    generation: 0,
    value: initialState(input),
  }));
  const aligned = sameInput(entry.input, input)
    ? entry
    : { input: { ...input }, generation: entry.generation + 1, value: initialState(input) };
  if (aligned !== entry) setEntry(aligned);

  const requestInput = aligned.input;
  const requestGeneration = aligned.generation;
  useEffect(() => {
    if (!requestInput.online || !requestInput.ownerId) return undefined;
    const controller = new AbortController();
    void getProfileAndPayments(controller.signal)
      .then((response) => {
        const value: PaymentConfigurationState = response.state === "ready"
          ? {
              state: "ready",
              paymentDetails: response.paymentDetails,
              encryptedSnapshot: response.encryptedSnapshot,
              issuer: response.profile,
              invoicePrefix: response.invoicePrefix,
            }
          : { state: response.state };
        setEntry((current) => sameInput(current.input, requestInput) && current.generation === requestGeneration
          ? { input: requestInput, generation: requestGeneration, value }
          : current);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setEntry((current) => sameInput(current.input, requestInput) && current.generation === requestGeneration
          ? { input: requestInput, generation: requestGeneration, value: { state: "error" } }
          : current);
      });
    return () => controller.abort();
  }, [requestGeneration, requestInput]);
  return aligned.value;
}
