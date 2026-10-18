import type { RecordPayload } from "@/offline/types";
import type { ServerPaymentEnvelope } from "@/security/paymentEnvelope";
import type { BankDetails } from "@/security/vault";

export type PublicProfile = {
  doctorName: string;
  tradingName: string;
  address: string;
  email: string;
};

export type ProfileAndPaymentsInput = {
  profile: PublicProfile;
  invoicePrefix: string;
  paymentDetails?: BankDetails;
};

export type ProfileAndPaymentsErrors = Partial<Record<
  "doctorName" | "address" | "email" | "invoicePrefix" |
  "accountName" | "sortCode" | "accountNumber",
  string
>>;

export type ProfilePaymentsReadyResponse = {
  state: "ready";
  profile: PublicProfile;
  invoicePrefix: string;
  paymentDetails: BankDetails;
  paymentSummary: { accountName: string; accountNumberLast4: string };
  encryptedSnapshot: ServerPaymentEnvelope;
  settingsRecord: {
    id: string;
    data: RecordPayload;
    revision: number;
    updatedAt: string;
  };
};

export type ProfilePaymentsSetupResponse = {
  state: "missing" | "upgrade_required";
  profile?: PublicProfile;
  invoicePrefix?: string;
};

export function normalizeSortCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
    : value.trim();
}

export function normalizeProfileAndPayments(
  input: ProfileAndPaymentsInput,
): ProfileAndPaymentsInput {
  const paymentDetails = input.paymentDetails
    ? {
        accountName: input.paymentDetails.accountName.trim(),
        sortCode: normalizeSortCode(input.paymentDetails.sortCode),
        accountNumber: input.paymentDetails.accountNumber.trim(),
      }
    : undefined;
  return {
    profile: {
      doctorName: input.profile.doctorName.trim(),
      tradingName: input.profile.tradingName.trim(),
      address: input.profile.address.trim(),
      email: input.profile.email.trim(),
    },
    invoicePrefix: input.invoicePrefix.trim().toUpperCase(),
    ...(paymentDetails ? { paymentDetails } : {}),
  };
}

export function validateProfileAndPayments(
  input: ProfileAndPaymentsInput,
  paymentRequired: boolean,
): ProfileAndPaymentsErrors {
  const normalized = normalizeProfileAndPayments(input);
  const errors: ProfileAndPaymentsErrors = {};
  if (!normalized.profile.doctorName) errors.doctorName = "Name is required.";
  if (!normalized.profile.address) errors.address = "Address is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.profile.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!/^[A-Z0-9]{1,10}$/.test(normalized.invoicePrefix)) {
    errors.invoicePrefix = "Use 1 to 10 uppercase letters or numbers.";
  }
  if (paymentRequired && !normalized.paymentDetails) {
    errors.accountName = "Payment details are required.";
    errors.sortCode = "Payment details are required.";
    errors.accountNumber = "Payment details are required.";
    return errors;
  }
  if (normalized.paymentDetails) {
    if (!normalized.paymentDetails.accountName) errors.accountName = "Account name is required.";
    if (!/^\d{2}-\d{2}-\d{2}$/.test(normalized.paymentDetails.sortCode)) {
      errors.sortCode = "Enter a six-digit sort code.";
    }
    if (!/^\d{8}$/.test(normalized.paymentDetails.accountNumber)) {
      errors.accountNumber = "Enter an eight-digit account number.";
    }
  }
  return errors;
}
