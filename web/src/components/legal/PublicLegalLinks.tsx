import Link from "next/link";

export function PublicLegalLinks() {
  return (
    <nav aria-label="Legal" className="public-legal-links">
      <Link href="/privacy">Privacy Policy</Link>
      <span aria-hidden="true">·</span>
      <Link href="/terms">Terms of Service</Link>
    </nav>
  );
}
