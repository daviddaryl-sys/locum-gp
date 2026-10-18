import { describe, expect, it } from "vitest";

import { validateProfileInput } from "@/features/settings/ProfileForm";

const valid = {
  doctorName: "Dr Alex Example",
  tradingName: "Example Locums",
  address: "1 Example Road, London",
  email: "alex@example.test",
  invoicePrefix: "INV",
  accountName: "Dr Alex Example",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};

describe("profile settings", () => {
  it("validates profile and payment fields without a passcode", () => {
    expect(validateProfileInput(valid, true)).toEqual({});
    const errors = validateProfileInput({
      ...valid,
      doctorName: "",
      email: "invalid",
      invoicePrefix: "not valid!",
      sortCode: "123",
      accountNumber: "abc",
    }, true);
    expect(errors).toMatchObject({
      doctorName: expect.any(String),
      email: expect.any(String),
      invoicePrefix: expect.any(String),
      sortCode: expect.any(String),
      accountNumber: expect.any(String),
    });
    expect(errors).not.toHaveProperty("passcode");
  });

  it("allows profile-only updates when payment details are saved", () => {
    expect(validateProfileInput({
      ...valid,
      accountName: "",
      sortCode: "",
      accountNumber: "",
    }, false)).toEqual({});
  });
});
