import type { RecordPayload, RecordStoreName } from "@/offline/types";

import { DEMO_PRACTICE_SOURCES } from "./practiceSources";

export const DEMO_ADDRESS = "Demo address — not for correspondence";
export const DEMO_SEED_VERSION = 1;

export type DemoFixture = {
  recordType: Extract<
    RecordStoreName,
    "practices" | "sessions" | "invoices" | "invoiceItems" | "expenses"
  >;
  id: string;
  data: RecordPayload;
};

export type DemoRecordIds = {
  practices: string[];
  sessions: string[];
  invoices: string[];
  invoiceItems: string[];
  expenses: string[];
};

export type DemoFixtureSet = {
  fixtures: DemoFixture[];
  ids: DemoRecordIds;
};
export type DemoFixtures = DemoFixtureSet;

function isoDateWithOffset(referenceDate: string, offsetDays: number) {
  const date = new Date(`${referenceDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid demo reference date.");
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date: string, hour: number) {
  return `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

async function demoId(ownerId: string, fixtureKey: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `${ownerId}:standalone-demo-v1:${fixtureKey}`,
      ),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function idsFor(ownerId: string, prefix: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      demoId(ownerId, `${prefix}-${index + 1}`),
    ),
  );
}

export async function demoRecordIds(ownerId: string): Promise<DemoRecordIds> {
  const [practices, sessions, invoices, invoiceItems, expenses] = await Promise.all([
    idsFor(ownerId, "practice", 11),
    idsFor(ownerId, "session", 8),
    idsFor(ownerId, "invoice", 6),
    idsFor(ownerId, "invoice-item", 6),
    idsFor(ownerId, "expense", 16),
  ]);
  return { practices, sessions, invoices, invoiceItems, expenses };
}

export function isDemoPracticePayload(payload: RecordPayload) {
  const address = payload.billingAddress;
  return (
    Boolean(address) &&
    typeof address === "object" &&
    !Array.isArray(address) &&
    (address as Record<string, unknown>).formatted === DEMO_ADDRESS
  );
}

export function isDemoSessionPayload(payload: RecordPayload) {
  return typeof payload.notes === "string" && payload.notes.startsWith("Demo —");
}

export function isDemoInvoicePayload(payload: RecordPayload) {
  return (
    typeof payload.invoiceNumber === "string" &&
    payload.invoiceNumber.startsWith("DEMO-")
  );
}

export async function buildDemoFixtures(
  ownerId: string,
  referenceDate: string,
): Promise<DemoFixtureSet> {
  const ids = await demoRecordIds(ownerId);
  const practices: DemoFixture[] = DEMO_PRACTICE_SOURCES.map(
    (source, index) => ({
      recordType: "practices",
      id: ids.practices[index],
      data: {
        name: source.name,
        billingAddress: { formatted: DEMO_ADDRESS },
        defaultHourlyRatePence: 6000 + (index % 4) * 250,
        paymentTermsDays: 30,
        archived: false,
        isDemo: true,
      },
    }),
  );

  const sessionOffsets = [-90, -75, -60, -45, -20, -10, 7, 14];
  const sessions: DemoFixture[] = sessionOffsets.map((offset, index) => {
    const date = isoDateWithOffset(referenceDate, offset);
    return {
      recordType: "sessions",
      id: ids.sessions[index],
      data: {
        practiceId: ids.practices[index],
        startsAt: isoDateTime(date, 9),
        endsAt: isoDateTime(date, 13),
        hourlyRatePence: 6000 + (index % 4) * 250,
        status: index < 4 ? "invoiced" : index < 6 ? "completed" : "planned",
        notes: `Demo — fictional GP session ${index + 1}`,
        isDemo: true,
      },
    };
  });

  const statuses = ["paid", "paid", "sent", "sent", "draft", "draft"] as const;
  const invoices: DemoFixture[] = statuses.map((status, index) => {
    const issueDate = isoDateWithOffset(referenceDate, -82 + index * 14);
    const dueDate =
      index === 2
        ? isoDateWithOffset(referenceDate, -10)
        : isoDateWithOffset(issueDate, 30);
    const totalPence = 24000 + index * 2500;
    return {
      recordType: "invoices",
      id: ids.invoices[index],
      data: {
        invoiceNumber: `DEMO-2026-${String(index + 1).padStart(4, "0")}`,
        status,
        paidAt: status === "paid" ? isoDateWithOffset(issueDate, 14) : null,
        practiceId: ids.practices[index],
        issueDate,
        dueDate,
        totalPence,
        practiceSnapshot: {
          id: ids.practices[index],
          name: DEMO_PRACTICE_SOURCES[index].name,
          billingAddress: { formatted: DEMO_ADDRESS },
        },
        paymentSnapshot: null,
        issuedAt: null,
        artifactPath: null,
        isDemo: true,
      },
    };
  });

  const invoiceItems: DemoFixture[] = invoices.map((invoice, index) => ({
    recordType: "invoiceItems",
    id: ids.invoiceItems[index],
    data: {
      invoiceId: invoice.id,
      sessionId: ids.sessions[index],
      description: `Demo — fictional locum session ${index + 1}`,
      quantity: 4,
      unitRatePence: Number(invoice.data.totalPence) / 4,
      lineTotalPence: invoice.data.totalPence,
      isDemo: true,
    },
  }));

  const expenseBlueprints = [
    [3, 1250, "parking_tolls_congestion", "travel_costs", false, false],
    [8, 3820, "mileage_business_travel", "travel_costs", false, false],
    [13, 49500, "professional_indemnity", "other_business_expenses", false, true],
    [20, 45000, "professional_memberships", "professional_fees", false, false],
    [27, 12900, "professional_training", "professional_fees", false, true],
    [34, 1800, "computer_software_phone_internet", "office_costs", false, false],
    [41, 2740, "public_transport_taxi", "travel_costs", true, false],
    [49, 1850, "qualifying_subsistence", "travel_costs", false, true],
    [56, 13500, "qualifying_accommodation", "travel_costs", true, true],
    [63, 8999, "doctors_bag_equipment", "other_business_expenses", false, false],
    [70, 450, "practice_printing_phone_postage", "office_costs", false, false],
    [78, 24000, "accountancy_legal_bank_fees", "professional_fees", false, false],
    [85, 3200, "home_office", "premises_costs", false, true],
    [92, 7500, "agency_booking_fees", "other_business_expenses", false, false],
    [100, 6800, "uniform_protective_clothing", "other_business_expenses", false, true],
    [110, 999, "other_general", "other_business_expenses", false, false],
  ] as const;
  const expenses: DemoFixture[] = expenseBlueprints.map((blueprint, index) => ({
    recordType: "expenses",
    id: ids.expenses[index],
    data: {
      expenseDate: isoDateWithOffset(referenceDate, -120 + blueprint[0]),
      amountPence: blueprint[1],
      categoryKey: blueprint[2],
      customCategoryId: null,
      mtdCategory: blueprint[3],
      allowablePercentage: 100,
      practiceId: index % 3 === 0 ? ids.practices[index % ids.practices.length] : null,
      supplierDescription: `Demo — fictional supplier ${index + 1}`,
      notes: `Demo — fictional expense ${index + 1}`,
      reimbursedByPractice: blueprint[4],
      needsAccountantReview: blueprint[5],
      receiptObjectKey: null,
      receiptOriginalName: null,
      receiptMimeType: null,
      receiptSizeBytes: null,
      receiptSyncStatus: "none",
      expenseKind: "standard",
      journeyOrigin: null,
      journeyDestination: null,
      distanceMiles: null,
      mileageRatePence: null,
      linkedSessionId: null,
      isDemo: true,
    },
  }));

  return {
    fixtures: [...practices, ...sessions, ...invoices, ...invoiceItems, ...expenses],
    ids,
  };
}
