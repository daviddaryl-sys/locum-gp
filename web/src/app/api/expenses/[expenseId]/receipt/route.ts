import { NextResponse } from "next/server";

import { validateReceiptFile } from "@/domain/expense";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string }> };
type Client = Awaited<ReturnType<typeof createClient>>;

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function noStoreEmpty(status: number) {
  const response = new Response(null, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function authenticatedClient() {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const ownerId = data?.claims?.sub;
  return error || !ownerId ? null : { client, ownerId };
}

async function ownedExpense(client: Client, ownerId: string, expenseId: string) {
  const { data, error } = await client
    .from("expense_records")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", expenseId)
    .maybeSingle();
  return error ? null : (data as unknown as Record<string, unknown> | null);
}

function clientExpense(row: Record<string, unknown>) {
  return {
    expenseDate: row.expense_date,
    amountPence: row.amount_pence,
    categoryKey: row.category_key,
    customCategoryId: row.custom_category_id,
    mtdCategory: row.mtd_category,
    allowablePercentage: row.allowable_percentage,
    practiceId: row.practice_id,
    supplierDescription: row.supplier_description,
    notes: row.notes,
    reimbursedByPractice: row.reimbursed_by_practice,
    needsAccountantReview: row.needs_accountant_review,
    receiptObjectKey: row.receipt_object_key,
    receiptOriginalName: row.receipt_original_name,
    receiptMimeType: row.receipt_mime_type,
    receiptSizeBytes: row.receipt_size_bytes,
    receiptSyncStatus: row.receipt_sync_status,
    isDemo: row.is_demo,
  };
}

async function receiptUploadInput(request: Request): Promise<{
  file: File;
  objectKey: string;
} | null> {
  const encodedObjectKey = request.headers?.get?.("X-Receipt-Object-Key") ?? null;
  const encodedOriginalName = request.headers?.get?.("X-Receipt-Original-Name") ?? null;
  if (encodedObjectKey !== null || encodedOriginalName !== null) {
    if (!encodedObjectKey || !encodedOriginalName) return null;
    try {
      const objectKey = decodeURIComponent(encodedObjectKey);
      const originalName = decodeURIComponent(encodedOriginalName);
      const contentType = request.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        .trim();
      if (!objectKey || !originalName || !contentType) return null;
      const body = await request.arrayBuffer();
      return {
        file: new File([body], originalName, { type: contentType }),
        objectKey,
      };
    } catch {
      return null;
    }
  }

  try {
    const form = await request.formData();
    const objectKey = form.get("objectKey");
    const file = form.get("file");
    return typeof objectKey === "string" && file instanceof File
      ? { file, objectKey }
      : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const authenticated = await authenticatedClient();
  if (!authenticated) return noStoreJson({ error: "Unauthorized" }, 401);
  const { expenseId } = await context.params;
  const row = await ownedExpense(
    authenticated.client,
    authenticated.ownerId,
    expenseId,
  );
  if (!row) return noStoreJson({ error: "Receipt not found" }, 404);
  const objectKey = row.receipt_object_key;
  if (typeof objectKey !== "string") {
    return noStoreJson({ error: "Receipt not found" }, 404);
  }
  const { data, error } = await authenticated.client.storage
    .from("expense-receipts")
    .createSignedUrl(objectKey, 60);
  if (error || !data?.signedUrl) {
    return noStoreJson({ error: "Receipt is temporarily unavailable" }, 503);
  }
  return noStoreJson({ url: data.signedUrl });
}

export async function POST(request: Request, context: RouteContext) {
  const authenticated = await authenticatedClient();
  if (!authenticated) return noStoreJson({ error: "Unauthorized" }, 401);
  const { expenseId } = await context.params;
  const row = await ownedExpense(
    authenticated.client,
    authenticated.ownerId,
    expenseId,
  );
  if (!row) return noStoreJson({ error: "Expense not found" }, 404);

  const input = await receiptUploadInput(request);
  if (!input) {
    return noStoreJson({ error: "Choose a receipt" }, 400);
  }
  const { file, objectKey } = input;
  if (objectKey !== row.receipt_object_key) {
    return noStoreJson({ error: "Receipt key conflict" }, 409);
  }
  const validation = validateReceiptFile(file);
  if (validation) {
    return noStoreJson(
      { error: validation },
      file.size > 10 * 1024 * 1024 ? 413 : 415,
    );
  }

  const upload = await authenticated.client.storage
    .from("expense-receipts")
    .upload(objectKey, file, { contentType: file.type, upsert: true });
  if (upload.error) {
    return noStoreJson({ error: "Receipt upload failed" }, 503);
  }

  const nextRevision = Number(row.revision) + 1;
  const updatedAt = new Date().toISOString();
  const updated = await authenticated.client
    .from("expense_records")
    .update({
      receipt_sync_status: "uploaded",
      revision: nextRevision,
      updated_at: updatedAt,
    })
    .eq("owner_id", authenticated.ownerId)
    .eq("id", expenseId)
    .eq("revision", Number(row.revision))
    .select("*")
    .maybeSingle();
  if (updated.error || !updated.data) {
    const current = await ownedExpense(
      authenticated.client,
      authenticated.ownerId,
      expenseId,
    );
    if (
      current?.receipt_object_key === objectKey &&
      current.receipt_sync_status === "uploaded"
    ) {
      return noStoreJson({
        data: clientExpense(current),
        revision: Number(current.revision),
        updatedAt: String(current.updated_at),
      });
    }
    await authenticated.client.storage.from("expense-receipts").remove([objectKey]);
    return noStoreJson({ error: "Receipt changed while uploading" }, 409);
  }
  const updatedRow = updated.data as unknown as Record<string, unknown>;
  return noStoreJson({
    data: clientExpense(updatedRow),
    revision: Number(updatedRow.revision ?? nextRevision),
    updatedAt: String(updatedRow.updated_at ?? updatedAt),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authenticated = await authenticatedClient();
  if (!authenticated) return noStoreJson({ error: "Unauthorized" }, 401);
  const { expenseId } = await context.params;
  const objectKey = new URL(request.url).searchParams.get("objectKey");
  const prefix = `${authenticated.ownerId}/${expenseId}/`;
  if (!objectKey?.startsWith(prefix)) {
    return noStoreJson({ error: "Receipt key conflict" }, 409);
  }
  const removal = await authenticated.client.storage
    .from("expense-receipts")
    .remove([objectKey]);
  if (removal.error) {
    return noStoreJson({ error: "Receipt deletion failed" }, 503);
  }
  return noStoreEmpty(204);
}
