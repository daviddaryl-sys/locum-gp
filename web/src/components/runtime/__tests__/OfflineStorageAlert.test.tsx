import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineStorageAlert } from "../OfflineStorageAlert";

afterEach(cleanup);

describe("OfflineStorageAlert", () => {
  it("renders nothing when offline storage initialized successfully", () => {
    const { container } = render(<OfflineStorageAlert initializationError={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders an alert when offline storage is unavailable", () => {
    render(<OfflineStorageAlert initializationError />);

    expect(screen.getByRole("alert")).toHaveTextContent("Offline storage is unavailable.");
  });
});
