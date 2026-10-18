import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import PrivacyPage from "../page";

it("publishes the controller, rights and exact Google Calendar data boundary", () => {
  render(<PrivacyPage />);

  expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  expect(
    screen.getByText(/David Despres is the operator and data controller/i),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ai@daviddespres.co.uk" }),
  ).toHaveAttribute("href", "mailto:ai@daviddespres.co.uk");
  expect(
    screen.getByText(
      /must not enter patient-identifiable or clinical information/i,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "https://www.googleapis.com/auth/calendar.app.created",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(/does not inspect Gmail or list or import other calendars/i),
  ).toBeVisible();
  expect(screen.getByText(/including the Limited Use requirements/i)).toBeVisible();
  expect(
    screen.getByText(/removes the encrypted refresh token/i),
  ).toBeVisible();
  expect(
    screen.getByText(
      /retains owner-scoped opaque calendar and event identifiers, connection status and sync timestamps/i,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/removes the stored connection/i)).toBeNull();
  expect(
    screen.getByText(/request access, correction, export or deletion/i),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "← Locum Manager" })).toHaveAttribute(
    "href",
    "/",
  );
});
