import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppNavigation } from "../AppNavigation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const destinations = [
  ["Home", "/dashboard", "house"],
  ["Sessions", "/sessions", "calendar"],
  ["Invoices", "/invoices", "document"],
  ["More", "/more", "ellipsis-circle"],
] as const;

describe("AppNavigation", () => {
  it.each([
    ["/expenses/new", "Expenses"],
    ["/practices/practice-1", "Practices"],
    ["/tax-mtd", "Tax & MTD"],
    ["/settings/profile", "Settings"],
  ])("makes desktop destinations directly accessible and highlights %s correctly", (currentPath, activeLabel) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<AppNavigation currentPath={currentPath} />);
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: activeLabel })).toHaveAttribute("aria-current", "page");
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(navigation).getByRole("link", { name: "Expenses" })).toHaveAttribute("href", "/expenses");
    expect(within(navigation).getByRole("link", { name: "Practices" })).toHaveAttribute("href", "/practices");
  });

  it("returns to four mobile destinations and the correct active parent when resized", () => {
    let desktop = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return desktop; },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));
    render(<AppNavigation currentPath="/expenses" />);
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute("aria-current", "page");
    act(() => {
      desktop = false;
      listeners.forEach((listener) => listener());
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "Expenses" })).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
  it("keeps mobile navigation and page content above the safe area", () => {
    const tokensCss = readFileSync(
      path.resolve("src/styles/tokens.css"),
      "utf8",
    );
    const globalsCss = readFileSync(
      path.resolve("src/app/globals.css"),
      "utf8",
    );

    expect(tokensCss).toMatch(
      /--mobile-navigation-bottom-space:\s*max\(env\(safe-area-inset-bottom\),\s*4dvh\);/,
    );
    expect(globalsCss).toMatch(
      /\.app-navigation\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-navigation-bottom-space\);/,
    );
    expect(globalsCss).toMatch(
      /\.app-shell__content\s*\{[\s\S]*?padding-bottom:\s*calc\(72px \+ var\(--mobile-navigation-bottom-space\)\);/,
    );
  });

  it("provides exactly four labelled primary destinations with inline vector icons", () => {
    render(<AppNavigation currentPath="/dashboard" />);

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const items = within(navigation).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    for (const [name, href, icon] of destinations) {
      const link = within(navigation).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link.querySelector("img")).toBeNull();
      expect(link.querySelector(`svg[data-icon="${icon}"]`)).not.toBeNull();
    }
  });

  it("announces the active destination and exposes active and inactive visual states", () => {
    render(<AppNavigation currentPath="/sessions/session-1" />);

    const sessions = screen.getByRole("link", { name: "Sessions" });
    const home = screen.getByRole("link", { name: "Home" });
    expect(sessions).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(sessions).toHaveAttribute("data-state", "active");
    expect(home).not.toHaveAttribute("aria-current");
    expect(home).toHaveAttribute("data-state", "inactive");
    expect(
      sessions.querySelector('.app-navigation__icon-tile[data-state="active"]'),
    ).not.toBeNull();
    expect(
      home.querySelector('.app-navigation__icon-tile[data-state="inactive"]'),
    ).not.toBeNull();
  });

  it.each([
    "/more",
    "/practices",
    "/practices/practice-1",
    "/settings/profile",
  ])("keeps More active for moved destination %s", (currentPath) => {
    render(<AppNavigation currentPath={currentPath} />);

    const more = screen.getByRole("link", { name: "More" });
    expect(more).toHaveAttribute("aria-current", "page");
    expect(more).toHaveAttribute("data-state", "active");

    for (const label of ["Home", "Sessions", "Invoices"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).not.toHaveAttribute("aria-current");
      expect(link).toHaveAttribute("data-state", "inactive");
    }
  });

  it.each([
    "/expenses",
    "/expenses/categories",
    "/tax-mtd",
  ])("keeps Home active for Dashboard work tool %s", (currentPath) => {
    render(<AppNavigation currentPath={currentPath} />);

    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveAttribute("data-state", "active");

    for (const label of ["Sessions", "Invoices", "More"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).not.toHaveAttribute("aria-current");
      expect(link).toHaveAttribute("data-state", "inactive");
    }
  });

  it("declares bottom mobile navigation and an expanded desktop sidebar", () => {
    render(<AppNavigation currentPath="/dashboard" />);

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(navigation).toHaveAttribute("data-mobile-layout", "bottom");
    expect(navigation).toHaveAttribute("data-desktop-layout", "sidebar");
    expect(
      within(navigation).getByText("Locum Manager", { selector: "span" }),
    ).toBeInTheDocument();
  });
});
