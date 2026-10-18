"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const destinations = [
  { href: "/dashboard", icon: "house", label: "Home" },
  { href: "/sessions", icon: "calendar", label: "Sessions" },
  { href: "/invoices", icon: "document", label: "Invoices" },
  { href: "/more", icon: "ellipsis-circle", label: "More" },
] as const;

const desktopDestinations = [
  { href: "/dashboard", icon: "house", label: "Home" },
  { href: "/sessions", icon: "calendar", label: "Sessions" },
  { href: "/invoices", icon: "document", label: "Invoices" },
  { href: "/expenses", icon: "receipt", label: "Expenses" },
  { href: "/practices", icon: "building", label: "Practices" },
  { href: "/tax-mtd", icon: "chart", label: "Tax & MTD" },
  { href: "/more", icon: "settings", label: "Settings" },
] as const;

const desktopQuery = "(min-width: 900px)";

function subscribeToLayout(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function desktopSnapshot() {
  return typeof window.matchMedia === "function" && window.matchMedia(desktopQuery).matches;
}

function mobileServerSnapshot() {
  return false;
}

const dashboardDestinationRoots = ["/dashboard", "/expenses", "/tax-mtd"];
const moreDestinationRoots = ["/more", "/practices", "/settings"];

type NavigationIconName = (typeof destinations | typeof desktopDestinations)[number]["icon"];

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const paths: Record<NavigationIconName, React.ReactNode> = {
    house: (
      <>
        <path d="m3 10 9-7 9 7v11h-6v-6H9v6H3z" />
      </>
    ),
    calendar: (
      <>
        <rect height="17" rx="2" width="18" x="3" y="4" />
        <path d="M8 2v4M16 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
      </>
    ),
    document: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5M9 12h6M9 16h6" />
      </>
    ),
    "ellipsis-circle": (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-5h6v5M8 7h2M14 7h2M8 11h2M14 11h2" /></>,
    chart: <><path d="M4 3v18h17M8 16v-4M13 16V8M18 16V5" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="var(--color-surface)" /><circle cx="16" cy="12" r="2" fill="var(--color-surface)" /><circle cx="10" cy="18" r="2" fill="var(--color-surface)" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="app-navigation__icon"
      data-icon={name}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function isActiveDestination(currentPath: string, href: string, desktop: boolean) {
  if (desktop) {
    const roots = href === "/more" ? ["/more", "/settings"] : [href];
    return roots.some((root) => currentPath === root || currentPath.startsWith(`${root}/`));
  }
  if (href === "/dashboard") {
    return dashboardDestinationRoots.some(
      (root) => currentPath === root || currentPath.startsWith(`${root}/`),
    );
  }

  if (href === "/more") {
    return moreDestinationRoots.some(
      (root) => currentPath === root || currentPath.startsWith(`${root}/`),
    );
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function AppNavigation({ currentPath }: { currentPath: string }) {
  const desktop = useSyncExternalStore(subscribeToLayout, desktopSnapshot, mobileServerSnapshot);
  const visibleDestinations = desktop ? desktopDestinations : destinations;
  return (
    <nav
      aria-label="Primary navigation"
      className="app-navigation"
      data-desktop-layout="sidebar"
      data-mobile-layout="bottom"
    >
      <Link className="app-navigation__brand" href="/dashboard">
        <span aria-hidden="true" className="app-navigation__brand-mark">
          LM
        </span>
        <span>Locum Manager</span>
      </Link>

      <ul className="app-navigation__items">
        {visibleDestinations.map(({ href, icon, label }) => {
          const active = isActiveDestination(currentPath, href, desktop);
          return (
            <li key={href}>
              <Link
                aria-current={active ? "page" : undefined}
                className="app-navigation__link"
                data-state={active ? "active" : "inactive"}
                href={href}
              >
                <span
                  aria-hidden="true"
                  className="app-navigation__icon-tile"
                  data-state={active ? "active" : "inactive"}
                >
                  <NavigationIcon name={icon} />
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
