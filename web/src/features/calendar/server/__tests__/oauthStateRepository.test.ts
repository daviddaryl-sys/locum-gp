// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { createOAuthStateStore } from "../oauthStateRepository";

const ownerId = "00000000-0000-4000-8000-000000000001";
const stateDigest = "fictional-state-digest";
const expiresAt = Date.UTC(2026, 7, 5, 10, 10, 0);
const nowMs = Date.UTC(2026, 7, 5, 10, 0, 0);

beforeEach(() => {
  createAdminClient.mockReset();
});

describe("Supabase OAuth state store", () => {
  it("registers only the owner, digest, and expiry", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    createAdminClient.mockReturnValue({ from });

    await createOAuthStateStore().register({
      ownerId,
      stateDigest,
      expiresAt,
    });

    expect(from).toHaveBeenCalledWith("google_calendar_oauth_state_claims");
    expect(insert).toHaveBeenCalledWith({
      owner_id: ownerId,
      state_digest: stateDigest,
      expires_at: new Date(expiresAt).toISOString(),
    });
  });

  it("claims with one owner-scoped unexpired delete returning call", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { state_digest: stateDigest },
      error: null,
    }));
    const select = vi.fn(() => ({ maybeSingle }));
    const gt = vi.fn(() => ({ select }));
    const digestEq = vi.fn(() => ({ gt }));
    const ownerEq = vi.fn(() => ({ eq: digestEq }));
    const remove = vi.fn(() => ({ eq: ownerEq }));
    const from = vi.fn(() => ({ delete: remove }));
    createAdminClient.mockReturnValue({ from });

    await expect(
      createOAuthStateStore().claim({
        ownerId,
        stateDigest,
        nowMs,
      }),
    ).resolves.toBe(true);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(ownerEq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(digestEq).toHaveBeenCalledWith("state_digest", stateDigest);
    expect(gt).toHaveBeenCalledWith("expires_at", new Date(nowMs).toISOString());
    expect(select).toHaveBeenCalledWith("state_digest");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns false when no unexpired owner claim is deleted", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const gt = vi.fn(() => ({ select }));
    const digestEq = vi.fn(() => ({ gt }));
    const ownerEq = vi.fn(() => ({ eq: digestEq }));
    const remove = vi.fn(() => ({ eq: ownerEq }));
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ delete: remove })),
    });

    await expect(
      createOAuthStateStore().claim({
        ownerId,
        stateDigest,
        nowMs,
      }),
    ).resolves.toBe(false);
  });
});
