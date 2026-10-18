import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { InstallGuide } from "../InstallGuide";

describe("Locum Manager PWA manifest", () => {
  it("describes an installable standalone app with the required icons", () => {
    const appManifest = manifest();

    expect(appManifest.name).toBe("Locum Manager");
    expect(appManifest.short_name).toBe("Locum Manager");
    expect(appManifest.display).toBe("standalone");
    expect(appManifest.start_url).toBe("/");
    expect(
      appManifest.icons?.some(
        (icon) => icon.src === "/icons/icon-192.png" && icon.sizes === "192x192",
      ),
    ).toBe(true);
    expect(
      appManifest.icons?.some(
        (icon) => icon.src === "/icons/icon-512.png" && icon.sizes === "512x512",
      ),
    ).toBe(true);
  });
});

describe("InstallGuide", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the complete iPhone Safari installation path after sign-in", async () => {
    render(<InstallGuide authenticated />);

    const guide = await screen.findByRole("dialog", {
      name: "Install Locum Manager",
    });
    expect(guide).toHaveTextContent("Share");
    expect(guide).toHaveTextContent("Add to Home Screen");
    expect(guide).toHaveTextContent("Open as Web App");
    expect(guide).toHaveTextContent("Add");
  });

  it("does not claim iOS can install the app automatically", async () => {
    render(<InstallGuide authenticated />);

    await screen.findByRole("dialog", { name: "Install Locum Manager" });
    expect(
      screen.queryByRole("button", { name: /install (now|automatically)/i }),
    ).not.toBeInTheDocument();
  });

  it("persists dismissal and stays hidden on the next authenticated visit", async () => {
    const user = userEvent.setup();
    const firstVisit = render(<InstallGuide authenticated />);

    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    firstVisit.unmount();
    render(<InstallGuide authenticated />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can be reopened explicitly from Settings", async () => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");

    render(<InstallGuide authenticated forceOpen />);

    expect(
      await screen.findByRole("dialog", { name: "Install Locum Manager" }),
    ).toBeVisible();
  });

  it("does not appear before authentication", () => {
    render(<InstallGuide authenticated={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
