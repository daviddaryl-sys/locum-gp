import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import TermsPage from "../page";

it("publishes the professional-use, HMRC, Calendar and governing-law boundaries", () => {
  render(<TermsPage />);

  expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  expect(screen.getByText(/at least 18 years old/i)).toBeVisible();
  expect(
    screen.getByText(
      /must not enter patient-identifiable or clinical information/i,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(/does not file or submit information to HMRC/i),
  ).toBeVisible();
  expect(screen.getByText(/optional and one-way/i)).toBeVisible();
  expect(screen.getByText(/laws of England and Wales/i)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ai@daviddespres.co.uk" }),
  ).toHaveAttribute("href", "mailto:ai@daviddespres.co.uk");
});
