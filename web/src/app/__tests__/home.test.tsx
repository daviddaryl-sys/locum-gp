import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import Home from "../page";

describe("Home", () => {
  it("sends visitors straight to sign-in instead of showing a public welcome page", () => {
    Home();

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
