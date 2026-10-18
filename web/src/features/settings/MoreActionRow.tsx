import Link from "next/link";
import type { ReactNode } from "react";

export type MoreActionIconName =
  | "practices"
  | "expenses"
  | "tax-mtd"
  | "calendar"
  | "demo"
  | "profile"
  | "backup"
  | "privacy"
  | "sign-out";

type SharedProps = {
  description: string;
  icon: MoreActionIconName;
  title: string;
  tone?: "neutral" | "primary" | "danger";
};

type MoreActionRowProps = SharedProps &
  (
    | { variant: "link"; href: string }
    | {
        variant: "disclosure";
        children: ReactNode;
        controls: string;
        expanded: boolean;
        onToggle: () => void;
      }
    | { variant: "action"; onAction: () => void }
  );

function MoreActionIcon({ name }: { name: MoreActionIconName }) {
  const paths: Record<MoreActionIconName, ReactNode> = {
    practices: (
      <>
        <path d="M4 21V8l8-4 8 4v13" />
        <path d="M8 21v-6h8v6M9 10h.01M15 10h.01" />
      </>
    ),
    expenses: (
      <>
        <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3" />
        <path d="m14.5 16.5 1.5 1.5 3-3" />
      </>
    ),
    "tax-mtd": (
      <>
        <path d="M5 3h14v18H5zM8 7h8M8 11h3M8 15h3" />
        <path d="M15 11v6M13 13h4" />
      </>
    ),
    calendar: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M8 2v4M16 2v4M5 9h14" />
        <path d="M8 12h2M12 12h2M16 12h1M8 16h2M12 16h2" />
      </>
    ),
    demo: (
      <>
        <path d="M12 3v18M3 12h18" />
        <path d="m5.6 5.6 12.8 12.8M18.4 5.6 5.6 18.4" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1-5 4-7 8-7s7 2 8 7" />
      </>
    ),
    backup: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
        <path d="M17 6.5V5a5 5 0 0 0-10 0v1.5" />
      </>
    ),
    privacy: <path d="M12 3 4 6v6c0 5 3 8 8 9 5-1 8-4 8-9V6z" />,
    "sign-out": (
      <>
        <path d="m10 17 5-5-5-5M15 12H3" />
        <path d="M15 4h5v16h-5" />
      </>
    ),
  };

  return (
    <span aria-hidden="true" className="more-action__icon-tile">
      <svg
        aria-hidden="true"
        data-icon={name}
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        {paths[name]}
      </svg>
    </span>
  );
}

function RowContents({
  description,
  icon,
  title,
  trailing,
}: SharedProps & { trailing: ReactNode }) {
  return (
    <>
      <MoreActionIcon name={icon} />
      <span className="more-action__copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span aria-hidden="true" className="more-action__trailing">
        {trailing}
      </span>
    </>
  );
}

export function MoreActionRow(props: MoreActionRowProps) {
  const tone = props.tone ?? "neutral";
  if (props.variant === "link") {
    return (
      <article className="more-action">
        <Link
          aria-label={props.title}
          className="more-action__trigger"
          data-tone={tone}
          href={props.href}
        >
          <RowContents {...props} trailing="›" />
        </Link>
      </article>
    );
  }
  if (props.variant === "action") {
    return (
      <article className="more-action">
        <button
          aria-label={props.title}
          className="more-action__trigger"
          data-tone={tone}
          onClick={props.onAction}
          type="button"
        >
          <RowContents {...props} trailing="›" />
        </button>
      </article>
    );
  }
  return (
    <article className="more-action">
      <button
        aria-controls={props.controls}
        aria-expanded={props.expanded}
        aria-label={props.title}
        className="more-action__trigger"
        data-tone={tone}
        onClick={props.onToggle}
        type="button"
      >
        <RowContents {...props} trailing={props.expanded ? "⌃" : "⌄"} />
      </button>
      <div className="more-action__panel" hidden={!props.expanded} id={props.controls}>
        {props.children}
      </div>
    </article>
  );
}
