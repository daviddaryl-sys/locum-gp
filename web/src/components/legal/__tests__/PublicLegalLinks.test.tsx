import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PublicLegalLinks } from "../PublicLegalLinks";

it("exposes the two public legal destinations in a labelled landmark", () => {
  render(<PublicLegalLinks />);

  expect(screen.getByRole("navigation", { name: "Legal" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  expect(
    screen.getByRole("link", { name: "Terms of Service" }),
  ).toHaveAttribute("href", "/terms");
});
