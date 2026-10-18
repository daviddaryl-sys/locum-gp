const TRUSTED_ORIGIN = "https://locum-manager.invalid";
const FALLBACK_PATH = "/dashboard";

export function safeReturnPath(value?: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%5c/i.test(value)
  ) {
    return FALLBACK_PATH;
  }

  try {
    const parsed = new URL(value, TRUSTED_ORIGIN);
    if (parsed.origin !== TRUSTED_ORIGIN) return FALLBACK_PATH;

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return FALLBACK_PATH;
  }
}
