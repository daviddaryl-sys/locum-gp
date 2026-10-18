import Link from "next/link";
import type { ReactNode } from "react";

import { PublicLegalLinks } from "./PublicLegalLinks";

export function PublicLegalPage({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link className="legal-back" href="/">
          ← Locum Manager
        </Link>
        <header className="legal-header">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>Effective 5 August 2026</p>
        </header>
        <div className="legal-content">{children}</div>
        <PublicLegalLinks />
      </article>
    </main>
  );
}
