import { describe, expect, it } from "vitest";

import {
  fromDatabaseSettingsPayload,
  toDatabaseSettingsPayload,
} from "../settingsPayload";

describe("settings route payload mapping", () => {
  it("retains profession and no-vault values across the database boundary", () => {
    const databasePayload = toDatabaseSettingsPayload({
      profile: {
        profession: "pharmacist",
        doctorName: "Alex Example",
      },
      invoicePrefix: "LOCUM",
    });

    expect(databasePayload).toEqual({
      profile: {
        profession: "pharmacist",
        doctorName: "Alex Example",
      },
      invoice_prefix: "LOCUM",
    });
    expect(
      fromDatabaseSettingsPayload({
        ...databasePayload,
        ciphertext: null,
        salt: null,
        initialization_vector: null,
        kdf_parameters: null,
        encryption_version: null,
      }),
    ).toEqual({
      profile: {
        profession: "pharmacist",
        doctorName: "Alex Example",
      },
      invoicePrefix: "LOCUM",
    });
  });
});
