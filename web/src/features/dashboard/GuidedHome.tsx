import Link from "next/link";

const primaryRoutes = [
  {
    description: "Add the work you did.",
    href: "/sessions",
    icon: "sessions",
    title: "Work sessions",
  },
  {
    description: "Keep what you spent for work.",
    href: "/expenses",
    icon: "expenses",
    title: "Expenses",
  },
  {
    description: "Ask a practice to pay you.",
    href: "/invoices",
    icon: "invoices",
    title: "Invoices",
  },
] as const;

type GuidedHomeIconName = (typeof primaryRoutes)[number]["icon"] | "account";

function GuidedHomeIcon({ name }: { name: GuidedHomeIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="guided-home__icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      {name === "sessions" ? (
        <>
          <rect height="16" rx="3" width="16" x="4" y="5" />
          <path d="M8 3v4M16 3v4M4 10h16M9 14h6M9 17h4" />
        </>
      ) : name === "expenses" ? (
        <>
          <path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h2" />
          <path d="m5 16 2 2 4-4" />
        </>
      ) : name === "invoices" ? (
        <>
          <path d="M7 3h8l4 4v14H7z" />
          <path d="M15 3v5h5M10 12h6M10 16h6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.4-4 4.2-6 8-6s6.6 2 8 6" />
        </>
      )}
    </svg>
  );
}

function GuidedHomeCard({
  description,
  href,
  icon,
  title,
}: {
  description: string;
  href: string;
  icon: GuidedHomeIconName;
  title: string;
}) {
  return (
    <Link aria-label={title} className="guided-home__card" href={href}>
      <span aria-hidden="true" className="guided-home__icon-tile">
        <GuidedHomeIcon name={icon} />
      </span>
      <span className="guided-home__card-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span aria-hidden="true" className="guided-home__trailing">
        ›
      </span>
    </Link>
  );
}

export function GuidedHome() {
  return (
    <div className="guided-home">
      <header className="guided-home__header">
        <p className="eyebrow">Home</p>
        <h1 id="dashboard-title">Choose what you want to do</h1>
        <p className="guided-home__intro">
          Start with the part of your locum work you want to open.
        </p>
      </header>

      <section
        aria-labelledby="guided-home-main-title"
        className="guided-home__section"
      >
        <div className="guided-home__section-copy">
          <h2 id="guided-home-main-title">Main tasks</h2>
          <p>These are the main places you will use most often.</p>
        </div>
        <div className="guided-home__grid">
          {primaryRoutes.map((route) => (
            <GuidedHomeCard key={route.href} {...route} />
          ))}
        </div>
      </section>

      <section
        aria-labelledby="guided-home-account-title"
        className="guided-home__section guided-home__section--compact"
      >
        <div className="guided-home__section-copy">
          <h2 id="guided-home-account-title">My account</h2>
          <p>Your profile, practices, calendar and safety tools stay here.</p>
        </div>
        <Link
          aria-label="My account"
          className="guided-home__card guided-home__card--compact"
          href="/more"
        >
          <span aria-hidden="true" className="guided-home__icon-tile">
            <GuidedHomeIcon name="account" />
          </span>
          <span className="guided-home__card-copy">
            <strong>My account</strong>
            <span>Your details and app settings.</span>
            <small>
              Profile, practices, Google Calendar, backup, privacy and sign out.
            </small>
          </span>
          <span aria-hidden="true" className="guided-home__trailing">
            ›
          </span>
        </Link>
      </section>
    </div>
  );
}
