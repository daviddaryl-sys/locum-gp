import { describe, expect, it } from "vitest";

import { fromDatabasePayload, toDatabasePayload } from "../payloadMappings";

describe("expense route mileage mappings", () => {
  const clientPayload = {
    expenseKind: "mileage",
    journeyOrigin: "Example Surgery",
    journeyDestination: "Example Pharmacy",
    distanceMiles: 12.5,
    mileageRatePence: 55,
    linkedSessionId: null,
  };

  const databasePayload = {
    expense_kind: "mileage",
    journey_origin: "Example Surgery",
    journey_destination: "Example Pharmacy",
    distance_miles: 12.5,
    mileage_rate_pence: 55,
    linked_session_id: null,
  };

  it("maps all mileage fields from camelCase to snake_case on write", () => {
    expect(toDatabasePayload("expenses", clientPayload)).toMatchObject(
      databasePayload,
    );
  });

  it("maps all mileage fields from snake_case to camelCase on pull", () => {
    expect(fromDatabasePayload("expenses", databasePayload)).toMatchObject(
      clientPayload,
    );
  });
});
