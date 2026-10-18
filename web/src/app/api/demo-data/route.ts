import { NextResponse } from "next/server";

import { buildDemoFixtures, DEMO_SEED_VERSION, type DemoFixture, type DemoFixtures } from "@/features/demo/demoFixtures";
import { renderDemoReceiptPdf } from "@/features/demo/DemoReceiptDocument";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const FIXTURE_TABLES = {
  practices: "practice_records",
  sessions: "session_records",
  invoices: "invoice_records",
  invoiceItems: "invoice_item_records",
  expenses: "expense_records",
} as const;

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function londonDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", timeZone: "Europe/London", year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fixtureCount(fixtures: DemoFixtures) {
  return fixtures.fixtures.length;
}

function databaseFixture(fixture: DemoFixture, ownerId: string) {
  const common = { id: fixture.id, owner_id: ownerId, is_demo: true };
  const data = fixture.data;
  switch (fixture.recordType) {
    case "practices": return { ...common, name: data.name, billing_address: data.billingAddress, default_hourly_rate_pence: data.defaultHourlyRatePence, payment_terms_days: data.paymentTermsDays, archived: data.archived };
    case "sessions": return { ...common, practice_id: data.practiceId, starts_at: data.startsAt, ends_at: data.endsAt, hourly_rate_pence: data.hourlyRatePence, status: data.status, notes: data.notes };
    case "invoices": return { ...common, invoice_number: data.invoiceNumber, status: data.status, practice_id: data.practiceId, issue_date: data.issueDate, due_date: data.dueDate, paid_at: data.paidAt, total_pence: data.totalPence, practice_snapshot: data.practiceSnapshot, payment_snapshot: data.paymentSnapshot, issued_at: data.issuedAt, artifact_path: data.artifactPath };
    case "invoiceItems": return { ...common, invoice_id: data.invoiceId, session_id: data.sessionId, description: data.description, quantity: data.quantity, unit_rate_pence: data.unitRatePence, line_total_pence: data.lineTotalPence };
    case "expenses": return { ...common, expense_date: data.expenseDate, amount_pence: data.amountPence, category_key: data.categoryKey, custom_category_id: data.customCategoryId, mtd_category: data.mtdCategory, allowable_percentage: data.allowablePercentage, practice_id: data.practiceId, supplier_description: data.supplierDescription, notes: data.notes, reimbursed_by_practice: data.reimbursedByPractice, needs_accountant_review: data.needsAccountantReview, receipt_object_key: data.receiptObjectKey, receipt_original_name: data.receiptOriginalName, receipt_mime_type: data.receiptMimeType, receipt_size_bytes: data.receiptSizeBytes, receipt_sync_status: data.receiptSyncStatus };
  }
}

async function uploadPendingDemoReceipts(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client
    .from("expense_records")
    .select("id,owner_id,amount_pence,expense_date,receipt_object_key,receipt_sync_status,revision")
    .eq("owner_id", ownerId)
    .eq("is_demo", true)
    .not("receipt_object_key", "is", null);
  if (error) throw new Error("Could not inspect demo receipts.");

  for (const row of data ?? []) {
    if (row.receipt_sync_status === "uploaded" || !row.receipt_object_key) continue;
    if (!row.receipt_object_key.startsWith(`${ownerId}/${row.id}/`)) {
      throw new Error("Demo receipt key is outside the owner namespace.");
    }
    const pdf = await renderDemoReceiptPdf({
      amountPence: Number(row.amount_pence),
      date: row.expense_date,
      reference: `Demo expense ${row.id.slice(0, 8)}`,
    });
    const uploaded = await client.storage.from("expense-receipts").upload(
      row.receipt_object_key,
      pdf,
      { cacheControl: "0", contentType: "application/pdf", upsert: true },
    );
    if (uploaded.error) throw new Error("Could not upload a generated demo receipt.");
    const updated = await client
      .from("expense_records")
      .update({
        receipt_size_bytes: pdf.byteLength,
        receipt_sync_status: "uploaded",
        revision: Number(row.revision) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId)
      .eq("id", row.id);
    if (updated.error) throw new Error("Could not confirm a generated demo receipt.");
  }
}

async function seedDemoData(client: SupabaseClient, ownerId: string, referenceDate: string) {
  const seedState = await client
    .from("demo_seed_state")
    .select("owner_id,seed_version,demo_deleted_at")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (seedState.error) throw new Error("Could not read demo seed state.");

  const fixtures = await buildDemoFixtures(ownerId, referenceDate);
  if (seedState.data?.demo_deleted_at) {
    return { demoRecordCount: 0, seeded: false, seedVersion: DEMO_SEED_VERSION };
  }

  let seeded = false;
  if (!seedState.data) {
    const grouped = new Map<string, ReturnType<typeof databaseFixture>[]>();
    for (const fixture of fixtures.fixtures) {
      const table = FIXTURE_TABLES[fixture.recordType];
      grouped.set(table, [...(grouped.get(table) ?? []), databaseFixture(fixture, ownerId)]);
    }
    for (const [table, rows] of grouped) {
      const result = await client.from(table as never).upsert(rows as never, {
        onConflict: "owner_id,id",
      });
      if (result.error) throw new Error(`Could not seed ${table}.`);
    }
    const stateResult = await client.from("demo_seed_state").upsert({
      demo_deleted_at: null,
      owner_id: ownerId,
      seed_version: DEMO_SEED_VERSION,
      seeded_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (stateResult.error) throw new Error("Could not finalize demo seed state.");
    seeded = true;
  }

  await uploadPendingDemoReceipts(client, ownerId);
  return { demoRecordCount: fixtureCount(fixtures), seeded, seedVersion: DEMO_SEED_VERSION };
}

export async function POST() {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const ownerId = data?.claims?.sub;
    if (error || typeof ownerId !== "string") return noStoreJson({ error: "Unauthorized" }, 401);
    return noStoreJson(await seedDemoData(client, ownerId, londonDate()));
  } catch {
    return noStoreJson({ error: "Demo data could not be prepared." }, 500);
  }
}

export async function DELETE() {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const ownerId = data?.claims?.sub;
    if (error || typeof ownerId !== "string") return noStoreJson({ error: "Unauthorized" }, 401);

    const cleanup = await client.rpc("delete_owned_demo_data");
    if (cleanup.error) return noStoreJson({ error: "Demo data could not be deleted." }, 500);
    const objectKeys = (cleanup.data ?? [])
      .map(({ object_key }) => object_key)
      .filter((key): key is string => typeof key === "string" && key.startsWith(`${ownerId}/`));
    if (objectKeys.length) {
      const removed = await client.storage.from("expense-receipts").remove(objectKeys);
      if (removed.error) return noStoreJson({ error: "Demo receipts could not be deleted." }, 503);
    }
    return new Response(null, { status: 204 });
  } catch {
    return noStoreJson({ error: "Demo data could not be deleted." }, 500);
  }
}
