import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuidedHome } from "../GuidedHome";

const globalStyles = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

const primaryRoutes = [
  ["Work sessions", "/sessions", "Add the work you did."],
  ["Expenses", "/expenses", "Keep what you spent for work."],
  ["Invoices", "/invoices", "Ask a practice to pay you."],
] as const;

afterEach(cleanup);

describe("GuidedHome", () => {
  it("shows exactly three primary links for the main work areas", () => {
    render(<GuidedHome />);

    const mainTasks = screen.getByRole("region", { name: "Main tasks" });
    const links = within(mainTasks).getAllByRole("link");
    expect(links).toHaveLength(3);

    for (const [name, href] of primaryRoutes) {
      expect(within(mainTasks).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("uses one accessible link per primary card with short explanations", () => {
    render(<GuidedHome />);

    for (const [name, href, description] of primaryRoutes) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(within(link).getByText(description)).toBeVisible();
      expect(link.querySelectorAll("a")).toHaveLength(0);
      expect(link.querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("keeps a smaller My account route for settings and existing account tools", () => {
    render(<GuidedHome />);

    const accountLink = screen.getByRole("link", { name: "My account" });
    expect(accountLink).toHaveAttribute("href", "/more");
    expect(
      within(accountLink).getByText("Your details and app settings."),
    ).toBeVisible();
    expect(
      within(accountLink).getByText(
        "Profile, practices, Google Calendar, backup, privacy and sign out.",
      ),
    ).toBeVisible();
  });

  it("keeps every dashboard icon inside its compact tile at desktop sizes", () => {
    expect(globalStyles).toMatch(
      /\.guided-home__icon-tile\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?\}/,
    );
    expect(globalStyles).toMatch(
      /\.guided-home__icon\s*\{[\s\S]*?display:\s*block;[\s\S]*?inline-size:\s*24px;[\s\S]*?block-size:\s*24px;[\s\S]*?max-inline-size:\s*24px;[\s\S]*?max-block-size:\s*24px;[\s\S]*?\}/,
    );
  });
});
