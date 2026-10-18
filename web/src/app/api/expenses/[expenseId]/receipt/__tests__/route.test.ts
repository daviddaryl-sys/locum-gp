import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ownerId: "owner-a" as string | null,
  expense: null as Record<string, unknown> | null,
  uploadError: null as { message: string } | null,
  signedUrl: "https://signed.example.test/receipt" as string | null,
  maybeSingleResults: [] as Array<{
    data: Record<string, unknown> | null;
    error: Error | null;
  }>,
  removedKeys: [] as string[],
  uploadOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const query = {
      select: vi.fn(() => query),
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () =>
        state.maybeSingleResults.shift() ?? { data: state.expense, error: null },
      ),
    };
    return {
      auth: {
        getClaims: vi.fn(async () => ({
          data: state.ownerId ? { claims: { sub: state.ownerId } } : null,
          error: state.ownerId ? null : new Error("unauthorized"),
        })),
      },
      from: vi.fn(() => query),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (_key: string, _file: File, options: Record<string, unknown>) => {
            state.uploadOptions.push(options);
            return { data: {}, error: state.uploadError };
          }),
          remove: vi.fn(async (keys: string[]) => {
            state.removedKeys.push(...keys);
            return { data: {}, error: null };
          }),
          createSignedUrl: vi.fn(async () => ({
            data: state.signedUrl ? { signedUrl: state.signedUrl } : null,
            error: state.signedUrl ? null : new Error("failed"),
          })),
        })),
      },
    };
  }),
}));

import { DELETE, GET, POST } from "../route";

const params = Promise.resolve({ expenseId: "expense-1" });

function post(form: FormData) {
  return POST({ formData: async () => form } as Request, { params });
}

function rawPost({
  body = "demo",
  contentType = "application/pdf",
  name = "receipt.pdf",
  objectKey = "owner-a/expense-1/receipt.pdf",
}: {
  body?: BodyInit;
  contentType?: string;
  name?: string;
  objectKey?: string;
} = {}) {
  return POST(new Request("http://local", {
    body,
    headers: {
      "Content-Type": contentType,
      "X-Receipt-Object-Key": encodeURIComponent(objectKey),
      "X-Receipt-Original-Name": encodeURIComponent(name),
    },
    method: "POST",
  }), { params });
}

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: "expense-1",
    owner_id: "owner-a",
    revision: 1,
    updated_at: "2026-08-02T12:00:00.000Z",
    receipt_object_key: "owner-a/expense-1/receipt.pdf",
    receipt_original_name: "receipt.pdf",
    receipt_mime_type: "application/pdf",
    receipt_size_bytes: 10,
    receipt_sync_status: "pending",
    ...overrides,
  };
}

beforeEach(() => {
  state.ownerId = "owner-a";
  state.expense = expense();
  state.uploadError = null;
  state.signedUrl = "https://signed.example.test/receipt";
  state.maybeSingleResults = [];
  state.removedKeys = [];
  state.uploadOptions = [];
});

describe("expense receipt route", () => {
  it("returns 401 when unauthenticated and 404 for an unowned expense", async () => {
    state.ownerId = null;
    expect((await GET(new Request("http://local"), { params })).status).toBe(401);
    state.ownerId = "owner-a";
    state.expense = null;
    expect((await GET(new Request("http://local"), { params })).status).toBe(404);
  });

  it("rejects mismatched keys, unsupported files, and files over 10 MiB", async () => {
    const mismatch = new FormData();
    mismatch.set("objectKey", "owner-a/expense-1/different.pdf");
    mismatch.set("file", new File(["x"], "receipt.pdf", { type: "application/pdf" }));
    expect((await post(mismatch)).status).toBe(409);

    const unsupported = new FormData();
    unsupported.set("objectKey", "owner-a/expense-1/receipt.pdf");
    unsupported.set("file", new File(["x"], "receipt.exe", { type: "application/octet-stream" }));
    expect((await post(unsupported)).status).toBe(415);

    const oversized = new FormData();
    oversized.set("objectKey", "owner-a/expense-1/receipt.pdf");
    oversized.set("file", new File([new Uint8Array(10485761)], "receipt.pdf", { type: "application/pdf" }));
    expect((await post(oversized)).status).toBe(413);
  });

  it("uploads, signs only the owned key, and deletes idempotently", async () => {
    const form = new FormData();
    form.set("objectKey", "owner-a/expense-1/receipt.pdf");
    form.set("file", new File(["demo"], "receipt.pdf", { type: "application/pdf" }));
    expect((await post(form)).status).toBe(200);
    expect(state.uploadOptions).toEqual([
      { contentType: "application/pdf", upsert: true },
    ]);

    const signed = await GET(new Request("http://local"), { params });
    expect(signed.status).toBe(200);
    expect(signed.headers.get("Cache-Control")).toBe("private, no-store");

    const request = new Request(
      "http://local?objectKey=owner-a%2Fexpense-1%2Freceipt.pdf",
      { method: "DELETE" },
    );
    expect((await DELETE(request, { params })).status).toBe(204);
    expect((await DELETE(request, { params })).status).toBe(204);
  });

  it("accepts a raw typed receipt body from an iPhone offline queue", async () => {
    const response = await rawPost();

    expect(response.status).toBe(200);
    expect(state.uploadOptions).toEqual([
      { contentType: "application/pdf", upsert: true },
    ]);
  });

  it("returns a controlled error for malformed multipart instead of throwing", async () => {
    const request = new Request("http://local", {
      body: "broken multipart body",
      headers: { "Content-Type": "multipart/form-data" },
      method: "POST",
    });

    expect((await POST(request, { params })).status).toBe(400);
  });

  it("treats a same-key concurrent upload completion as success", async () => {
    const uploaded = expense({
      receipt_sync_status: "uploaded",
      revision: 2,
      updated_at: "2026-08-10T18:44:00.000Z",
    });
    state.maybeSingleResults = [
      { data: expense(), error: null },
      { data: null, error: null },
      { data: uploaded, error: null },
    ];
    const form = new FormData();
    form.set("objectKey", "owner-a/expense-1/receipt.pdf");
    form.set("file", new File(["demo"], "receipt.pdf", { type: "application/pdf" }));

    const response = await post(form);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { receiptSyncStatus: "uploaded" },
      revision: 2,
    });
    expect(state.removedKeys).toEqual([]);
  });
});
