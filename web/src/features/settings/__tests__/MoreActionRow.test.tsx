import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { MoreActionRow } from "../MoreActionRow";

afterEach(cleanup);

it("renders a labelled link with a decorative vector icon", () => {
  render(
    <MoreActionRow
      description="Manage places you work"
      href="/practices"
      icon="practices"
      title="Practices"
      tone="primary"
      variant="link"
    />,
  );

  const link = screen.getByRole("link", { name: /Practices/ });
  expect(link).toHaveAttribute("href", "/practices");
  expect(link).toHaveAttribute("data-tone", "primary");
  const icon = link.querySelector('svg[data-icon="practices"]');
  expect(icon).toHaveAttribute("aria-hidden", "true");
  expect(icon).toHaveAttribute("focusable", "false");
  expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
});

it("renders the Connected services calendar-grid vector icon", () => {
  render(
    <MoreActionRow
      description="Google Calendar connection and sync"
      href="/settings/connected-services"
      icon="calendar"
      title="Connected services"
      variant="link"
    />,
  );
  const link = screen.getByRole("link", { name: "Connected services" });
  const icon = link.querySelector('svg[data-icon="calendar"]');
  expect(icon).toBeVisible();
  expect(icon?.querySelectorAll("path")).toHaveLength(3);
});

it("announces and toggles an inline disclosure", async () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <MoreActionRow
      controls="demo-controls"
      description="Load fictional examples"
      expanded={false}
      icon="demo"
      onToggle={onToggle}
      title="Demo data"
      variant="disclosure"
    >
      <p>Demo controls</p>
    </MoreActionRow>,
  );

  const button = screen.getByRole("button", { name: /Demo data/ });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveAttribute("aria-controls", "demo-controls");
  expect(screen.getByText("Demo controls").parentElement).toHaveAttribute("hidden");
  await userEvent.click(button);
  expect(onToggle).toHaveBeenCalledOnce();

  rerender(
    <MoreActionRow
      controls="demo-controls"
      description="Load fictional examples"
      expanded
      icon="demo"
      onToggle={onToggle}
      title="Demo data"
      variant="disclosure"
    >
      <p>Demo controls</p>
    </MoreActionRow>,
  );
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Demo controls").parentElement).not.toHaveAttribute("hidden");
});

it("renders a distinct action button", async () => {
  const onAction = vi.fn();
  render(
    <MoreActionRow
      description="Leave this account"
      icon="sign-out"
      onAction={onAction}
      title="Sign out"
      tone="danger"
      variant="action"
    />,
  );

  const button = screen.getByRole("button", { name: /Sign out/ });
  expect(button).toHaveAttribute("data-tone", "danger");
  await userEvent.click(button);
  expect(onAction).toHaveBeenCalledOnce();
});
