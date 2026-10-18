export type ReceiptViewerDependencies = {
  fetcher?: typeof fetch;
  opener?: (url?: string | URL, target?: string, features?: string) => unknown;
};

export async function openExpenseReceipt(
  expenseId: string,
  { fetcher = fetch, opener = window.open }: ReceiptViewerDependencies = {},
) {
  try {
    const response = await fetcher(`/api/expenses/${expenseId}/receipt`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) throw new Error();

    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || typeof (body as { url?: unknown }).url !== "string") {
      throw new Error();
    }
    const url = (body as { url: string }).url;
    if (!url || url !== url.trim()) throw new Error();

    const parsed = new URL(url);
    const loopbackHttp = parsed.protocol === "http:" && [
      "localhost",
      "127.0.0.1",
      "[::1]",
    ].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" && !loopbackHttp) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error();
    }

    opener(url, "_blank", "noopener,noreferrer");
  } catch {
    throw new Error("Receipt is temporarily unavailable.");
  }
}
