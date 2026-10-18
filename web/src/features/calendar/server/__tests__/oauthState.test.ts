// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { consumeOAuthState, createOAuthState } from "../oauthState";

const key = Buffer.alloc(32, 7);
const ownerId = "00000000-0000-4000-8000-000000000001";
const state = "fixed-fictional-state";
const verifier = "fixed-fictional-pkce-verifier";
const returnTo = "/settings/connected-services";
const nowMs = Date.UTC(2026, 7, 5, 10, 0, 0);

type StateRow = {
  ownerId: string;
  stateDigest: string;
  expiresAt: number;
};

class DurableStateStore {
  constructor(private readonly rows = new Map<string, StateRow>()) {}

  async register(row: StateRow) {
    this.rows.set(`${row.ownerId}:${row.stateDigest}`, row);
  }

  async claim(row: StateRow & { nowMs: number }) {
    const key = `${row.ownerId}:${row.stateDigest}`;
    const existing = this.rows.get(key);
    if (!existing || existing.expiresAt <= row.nowMs) return false;
    this.rows.delete(key);
    return true;
  }
}

function options(store: DurableStateStore, overrides = {}) {
  return { key, nowMs, state, verifier, store, ...overrides };
}

async function createFixedState(
  store = new DurableStateStore(),
  overrides = {},
) {
  return createOAuthState(ownerId, returnTo, options(store, overrides));
}

describe("sealed OAuth state", () => {
  it("registers only the state digest before returning the sealed value", async () => {
    const register = vi.fn(async () => undefined);
    const store = {
      register,
      claim: vi.fn(async () => true),
    };

    const created = await createOAuthState(
      ownerId,
      returnTo,
      options(store as never),
    );

    expect(register).toHaveBeenCalledWith({
      ownerId,
      stateDigest: createHash("sha256").update(state).digest("base64url"),
      expiresAt: nowMs + 10 * 60 * 1000,
    });
    expect(JSON.stringify(register.mock.calls)).not.toContain(state);
    expect(JSON.stringify(register.mock.calls)).not.toContain(verifier);
    expect(created.sealedState).not.toContain(ownerId);
    expect(created.sealedState).not.toContain(verifier);
  });

  it("seals and consumes the owner, verifier, safe path, and ten-minute lifetime", async () => {
    const store = new DurableStateStore();
    const created = await createFixedState(store);

    expect(created).toMatchObject({ state });
    expect(created.codeChallenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    await expect(
      consumeOAuthState(created.sealedState, state, ownerId, {
        key,
        nowMs: nowMs + 10 * 60 * 1000 - 1,
        store,
      }),
    ).resolves.toEqual({ verifier, returnTo });
  });

  it("rejects a wrong returned state", async () => {
    const store = new DurableStateStore();
    const created = await createFixedState(store);

    await expect(
      consumeOAuthState(created.sealedState, "wrong-state", ownerId, {
        key,
        nowMs,
        store,
      }),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it("rejects a different authenticated owner without consuming the claim", async () => {
    const store = new DurableStateStore();
    const created = await createFixedState(store);

    await expect(
      consumeOAuthState(created.sealedState, state, "different-owner", {
        key,
        nowMs,
        store,
      }),
    ).rejects.toThrow("Google authorization state is invalid.");
    await expect(
      consumeOAuthState(created.sealedState, state, ownerId, {
        key,
        nowMs,
        store,
      }),
    ).resolves.toEqual({ verifier, returnTo });
  });

  it("rejects state at the ten-minute expiry boundary", async () => {
    const store = new DurableStateStore();
    const created = await createFixedState(store);

    await expect(
      consumeOAuthState(created.sealedState, state, ownerId, {
        key,
        nowMs: nowMs + 10 * 60 * 1000,
        store,
      }),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it("rejects an unsafe return path before registration", async () => {
    const store = new DurableStateStore();
    await expect(
      createOAuthState(
        ownerId,
        "//malicious.example/path",
        options(store),
      ),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it("rejects a malformed sealed envelope", async () => {
    await expect(
      consumeOAuthState("not-an-envelope", state, ownerId, {
        key,
        nowMs,
        store: new DurableStateStore(),
      }),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it.each([
    ["padded", (value: string) => `${value}=`],
    ["leading whitespace", (value: string) => ` ${value}`],
    ["trailing whitespace", (value: string) => `${value}\n`],
  ])("rejects a %s sealed base64url variant", async (_name, mutate) => {
    const store = new DurableStateStore();
    const created = await createFixedState(store);

    await expect(
      consumeOAuthState(mutate(created.sealedState), state, ownerId, {
        key,
        nowMs,
        store,
      }),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it("rejects replay from a second store and fresh module instance", async () => {
    const sharedRows = new Map<string, StateRow>();
    const created = await createFixedState(new DurableStateStore(sharedRows), {
      state: `${state}-cross-process`,
    });
    await expect(
      consumeOAuthState(
        created.sealedState,
        `${state}-cross-process`,
        ownerId,
        { key, nowMs, store: new DurableStateStore(sharedRows) },
      ),
    ).resolves.toEqual({ verifier, returnTo });

    vi.resetModules();
    const freshModule = await import("../oauthState");
    await expect(
      freshModule.consumeOAuthState(
        created.sealedState,
        `${state}-cross-process`,
        ownerId,
        { key, nowMs, store: new DurableStateStore(sharedRows) },
      ),
    ).rejects.toThrow("Google authorization state is invalid.");
  });

  it("allows only one of two concurrent claims", async () => {
    const sharedRows = new Map<string, StateRow>();
    const created = await createFixedState(new DurableStateStore(sharedRows), {
      state: `${state}-concurrent`,
    });
    const consume = (store: DurableStateStore) =>
      consumeOAuthState(
        created.sealedState,
        `${state}-concurrent`,
        ownerId,
        { key, nowMs, store },
      );

    const results = await Promise.allSettled([
      consume(new DurableStateStore(sharedRows)),
      consume(new DurableStateStore(sharedRows)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });
});
