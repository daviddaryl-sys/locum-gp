import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProfileAndPayments } from "@/features/settings/profilePaymentsClient";
import { usePaymentConfiguration } from "@/features/invoices/usePaymentConfiguration";

vi.mock("@/features/settings/profilePaymentsClient", () => ({
  getProfileAndPayments: vi.fn(),
}));

const ready = {
  state: "ready",
  profile: {
    doctorName: "Dr Demo",
    tradingName: "Demo Locums",
    address: "Demo address",
    email: "demo@example.test",
  },
  invoicePrefix: "INV",
  paymentDetails: {
    accountName: "Demo Payments",
    sortCode: "12-34-56",
    accountNumber: "12345678",
  },
  encryptedSnapshot: {
    version: 2,
    ciphertext: "ICEiIyQlJicoKSorLC0uLzA=",
    salt: "AAECAwQFBgcICQoLDA0ODw==",
    initializationVector: "EBESExQVFhcYGRob",
    kdfParameters: { name: "HKDF", hash: "SHA-256", info: "locum-manager-payment:v2" },
  },
} as const;

describe("automatic invoice payment configuration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads payment details after normal sign-in", async () => {
    vi.mocked(getProfileAndPayments).mockResolvedValue(ready as never);
    const { result } = renderHook(() => usePaymentConfiguration("owner-1", true));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current).toMatchObject({ paymentDetails: ready.paymentDetails });
  });

  it("clears details immediately on owner change or offline transition", async () => {
    vi.mocked(getProfileAndPayments).mockResolvedValue(ready as never);
    const { result, rerender } = renderHook(
      ({ owner, online }) => usePaymentConfiguration(owner, online),
      { initialProps: { owner: "owner-1" as string | null, online: true } },
    );
    await waitFor(() => expect(result.current.state).toBe("ready"));
    rerender({ owner: "owner-2", online: true });
    expect(result.current).toEqual({ state: "loading" });
    rerender({ owner: "owner-2", online: false });
    expect(result.current).toEqual({ state: "offline" });
    expect(JSON.stringify(result.current)).not.toContain("12345678");
  });

  it("aborts an active request when authentication ends", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(getProfileAndPayments).mockImplementation((signal) => {
      if (signal) signals.push(signal);
      return new Promise(() => undefined) as never;
    });
    const { result, rerender } = renderHook(
      ({ owner }) => usePaymentConfiguration(owner, true),
      { initialProps: { owner: "owner-1" as string | null } },
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ owner: null });
    expect(result.current).toEqual({ state: "unauthenticated" });
    await waitFor(() => expect(signals[0]?.aborted).toBe(true));
  });

  it.each(["missing", "upgrade_required", "unauthenticated", "error"] as const)(
    "maps the %s response without retaining readable details",
    async (state) => {
      vi.mocked(getProfileAndPayments).mockResolvedValue({ state } as never);
      const { result } = renderHook(() => usePaymentConfiguration("owner-1", true));
      await waitFor(() => expect(result.current).toEqual({ state }));
      expect(JSON.stringify(result.current)).not.toContain("12345678");
    },
  );
});
