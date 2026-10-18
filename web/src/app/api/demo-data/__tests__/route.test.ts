import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ownerId: "11111111-1111-4111-8111-111111111111" as string | null,
  createClient: vi.fn(),
  removeError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: state.createClient,
}));

import { DELETE, POST } from "../route";

type Row = Record<string, unknown>;

function fakeClient({ cleanupSemantics = false }: { cleanupSemantics?: boolean } = {}) {
  const tables = new Map<string, Map<string, Row>>();
  tables.set("practice_records", new Map([["real-practice", { id: "real-practice", is_demo: false, name: "Owner real practice" }]]));
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const from = vi.fn((name: string) => {
    const filters: Array<[string, unknown]> = [];
    let selected = false;
    const query = {
      select: vi.fn(() => { selected = true; return query; }),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; }),
      not: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        const rows = [...table(name).values()].filter((row) => filters.every(([key, value]) => row[key] === value));
        return { data: rows[0] ?? null, error: null };
      }),
      upsert: vi.fn(async (input: Row | Row[]) => {
        for (const row of Array.isArray(input) ? input : [input]) table(name).set(String(row.id ?? row.owner_id), { ...row });
        return { data: null, error: null };
      }),
      update: vi.fn((input: Row) => {
        const updateQuery = {
          eq: vi.fn((column: string, value: unknown) => {
            for (const [id, row] of table(name)) if (row[column] === value) table(name).set(id, { ...row, ...input });
            return updateQuery;
          }),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
        return updateQuery;
      }),
      then: (resolve: (value: { data: Row[]; error: null }) => void) => {
        const rows = selected ? [...table(name).values()].filter((row) => filters.every(([key, value]) => row[key] === value)) : [];
        resolve({ data: rows, error: null });
      },
    };
    return query;
  });
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  const remove = vi.fn(async () => ({ data: {}, error: state.removeError }));
  const rpc = vi.fn(async () => {
    if (!cleanupSemantics) {
      return { data: [{ object_key: `${state.ownerId}/expense-demo/demo.pdf` }], error: null };
    }

    const objectKeys: Array<{ object_key: string }> = [];
    for (const rows of tables.values()) {
      for (const [id, row] of rows) {
        if (row.owner_id !== state.ownerId || row.is_demo !== true) continue;
        if (typeof row.receipt_object_key === "string") {
          objectKeys.push({ object_key: row.receipt_object_key });
        }
        rows.delete(id);
      }
    }
    const seedState = table("demo_seed_state").get(String(state.ownerId));
    if (seedState) {
      table("demo_seed_state").set(String(state.ownerId), {
        ...seedState,
        demo_deleted_at: "2026-08-03T09:00:00.000Z",
      });
    }
    return { data: objectKeys, error: null };
  });
  return {
    auth: { getClaims: vi.fn(async () => ({ data: state.ownerId ? { claims: { sub: state.ownerId } } : null, error: null })) },
    from,
    rpc,
    storage: { from: vi.fn(() => ({ remove, upload })) },
    tables,
    upload,
    remove,
  };
}

beforeEach(() => {
  state.ownerId = "11111111-1111-4111-8111-111111111111";
  state.createClient.mockReset();
  state.removeError = null;
});

describe("POST /api/demo-data", () => {
  it("requires an authenticated owner", async () => {
    state.ownerId = null;
    state.createClient.mockResolvedValue(fakeClient());
    expect((await POST()).status).toBe(401);
  });

  it("seeds once for an existing account and preserves its real rows", async () => {
    const client = fakeClient();
    state.createClient.mockResolvedValue(client);

    const first = await POST();
    const second = await POST();
    expect(await first.json()).toMatchObject({ demoRecordCount: 47, seeded: true, seedVersion: 1 });
    expect(await second.json()).toMatchObject({ seeded: false, seedVersion: 1 });
    expect(client.tables.get("practice_records")?.size).toBe(12);
    expect(client.tables.get("practice_records")?.get("real-practice")).toMatchObject({ is_demo: false, name: "Owner real practice" });
    expect(client.tables.get("expense_records")?.size).toBe(16);
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("deletes only function-returned receipt keys and is repeatable", async () => {
    const client = fakeClient();
    state.createClient.mockResolvedValue(client);
    expect((await DELETE()).status).toBe(204);
    expect((await DELETE()).status).toBe(204);
    expect(client.rpc).toHaveBeenCalledWith("delete_owned_demo_data");
    expect(client.remove).toHaveBeenCalledWith([`${state.ownerId}/expense-demo/demo.pdf`]);
  });

  it("does not reseed after cleanup and keeps a real expense", async () => {
    const client = fakeClient({ cleanupSemantics: true });
    state.createClient.mockResolvedValue(client);

    expect((await POST()).status).toBe(200);
    client.tables.get("expense_records")?.set("real-expense", {
      amount_pence: 1800,
      id: "real-expense",
      is_demo: false,
      owner_id: state.ownerId,
      supplier_description: "Real expense created after demo seed",
    });

    expect((await DELETE()).status).toBe(204);
    const afterCleanup = await POST();

    expect(await afterCleanup.json()).toMatchObject({ demoRecordCount: 0, seeded: false });
    expect(client.tables.get("expense_records")?.size).toBe(1);
    expect(client.tables.get("expense_records")?.get("real-expense")).toMatchObject({
      is_demo: false,
      supplier_description: "Real expense created after demo seed",
    });
  });

  it("returns a retryable response when private receipt removal fails", async () => {
    const client = fakeClient();
    state.createClient.mockResolvedValue(client);
    state.removeError = { message: "temporary" };
    expect((await DELETE()).status).toBe(503);
    state.removeError = null;
    expect((await DELETE()).status).toBe(204);
    expect(client.remove).toHaveBeenCalledTimes(2);
  });
});
