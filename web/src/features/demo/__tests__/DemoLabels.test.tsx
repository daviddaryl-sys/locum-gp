import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { InvoiceList } from "@/features/invoices/InvoiceViews";
import { PracticeList } from "@/features/practices/PracticeViews";
import { SessionList } from "@/features/sessions/SessionViews";

const records = vi.hoisted(() => ({
  practices: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/offline/useRecords", () => ({
  useOfflineRecord: vi.fn(),
  useOfflineRecords: (recordType: keyof typeof records) => records[recordType] ?? [],
}));

vi.mock("@/sync/SyncProvider", () => ({
  useSync: () => ({ ready: true, initializationError: false }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  records.practices = [];
  records.sessions = [];
  records.invoices = [];
});

const baseRecord = {
  ownerId: "owner-1",
  version: 1,
  updatedAt: "2026-08-03T12:00:00.000Z",
  deletedAt: null,
};

it("shows a Demo badge on a fixture practice", () => {
  records.practices = [{
    ...baseRecord,
    id: "practice-1",
    data: {
      name: "Wembley Park Medical Centre",
      billingAddress: { formatted: "Demo address — not for correspondence" },
      defaultHourlyRatePence: 6000,
      paymentTermsDays: 30,
      archived: false,
    },
  }];
  render(<PracticeList />);
  expect(screen.getByText("Demo")).toBeVisible();
});

it("shows a Demo badge on a fixture session", () => {
  records.practices = [{
    ...baseRecord,
    id: "practice-1",
    data: {
      name: "Wembley Park Medical Centre",
      billingAddress: { formatted: "Demo address — not for correspondence" },
      defaultHourlyRatePence: 6000,
      paymentTermsDays: 30,
      archived: false,
    },
  }];
  records.sessions = [{
    ...baseRecord,
    id: "session-1",
    data: {
      practiceId: "practice-1",
      startsAt: "2026-07-01T09:00:00.000Z",
      endsAt: "2026-07-01T13:00:00.000Z",
      hourlyRatePence: 6000,
      status: "completed",
      notes: "Demo — fictional GP session 1",
    },
  }];
  render(<SessionList />);
  expect(screen.getByText("Demo")).toBeVisible();
});

it("shows a Demo badge on a fixture invoice", () => {
  records.invoices = [{
    ...baseRecord,
    id: "invoice-1",
    data: {
      invoiceNumber: "DEMO-2026-0001",
      status: "draft",
      practiceId: "practice-1",
      practiceSnapshot: {
        id: "practice-1",
        name: "Wembley Park Medical Centre",
        billingAddress: { formatted: "Demo address — not for correspondence" },
      },
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      totalPence: 24000,
      issuedAt: null,
      paymentSnapshot: null,
      artifactPath: null,
    },
  }];
  render(<InvoiceList />);
  expect(screen.getByText("Demo")).toBeVisible();
});
