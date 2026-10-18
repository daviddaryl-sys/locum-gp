import { expect, it, vi } from "vitest";

import { openExpenseReceipt } from "../receiptViewer";

it("opens an owner-authenticated receipt without caching its signed URL", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ url: "https://receipts.invalid/fictional-signed-url" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const opener = vi.fn();

  await openExpenseReceipt("expense-1", { fetcher, opener });

  expect(fetcher).toHaveBeenCalledWith("/api/expenses/expense-1/receipt", {
    cache: "no-store",
    credentials: "include",
  });
  expect(opener).toHaveBeenCalledWith(
    "https://receipts.invalid/fictional-signed-url",
    "_blank",
    "noopener,noreferrer",
  );
});

it.each([
  "https://receipts.invalid/fictional-signed-url",
  "http://localhost:3000/fictional-signed-url",
  "http://127.0.0.1:3000/fictional-signed-url",
  "http://[::1]:3000/fictional-signed-url",
])("opens a permitted absolute receipt URL: %s", async (url) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ url }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const opener = vi.fn();

  await openExpenseReceipt("expense-1", { fetcher, opener });

  expect(opener).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
});

it.each([
  ["empty", ""],
  ["relative", "/private/receipt.pdf"],
  ["malformed", "https://"],
  ["username trick", "https://receipts.invalid@attacker.invalid/private.pdf"],
  ["javascript protocol", "javascript:alert(1)"],
  ["data protocol", "data:text/plain,private"],
  ["unsupported protocol", "ftp://receipts.invalid/private.pdf"],
  ["non-loopback HTTP", "http://receipts.invalid/private.pdf"],
])("rejects a %s receipt URL before calling the opener", async (_case, url) => {
  const opener = vi.fn();

  await expect(openExpenseReceipt("expense-1", {
    fetcher: vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ url }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )),
    opener,
  })).rejects.toThrow("Receipt is temporarily unavailable.");

  expect(opener).not.toHaveBeenCalled();
});

it.each([
  new Response("denied", { status: 401 }),
  new Response("{", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
  new Response(JSON.stringify({ url: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
])("fails closed without opening for an unusable receipt response", async (response) => {
  const opener = vi.fn();

  await expect(openExpenseReceipt("expense-1", {
    fetcher: vi.fn().mockResolvedValue(response),
    opener,
  })).rejects.toThrow("Receipt is temporarily unavailable.");

  expect(opener).not.toHaveBeenCalled();
});
