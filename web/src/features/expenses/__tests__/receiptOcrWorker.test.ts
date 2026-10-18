import { beforeEach, describe, expect, it, vi } from "vitest";

const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));

vi.mock("tesseract.js", () => ({
  default: {
    createWorker,
    OEM: { LSTM_ONLY: 1 },
  },
}));

import {
  createLocalReceiptOcrWorker,
  LOCAL_OCR_ASSET_PATHS,
} from "../receiptOcr.worker";

describe("local Tesseract worker configuration", () => {
  beforeEach(() => {
    createWorker.mockReset();
    createWorker.mockResolvedValue({
      recognize: vi.fn(),
      terminate: vi.fn(),
    });
  });

  it("creates a same-origin worker without a blob URL", async () => {
    await createLocalReceiptOcrWorker(vi.fn());

    expect(createWorker).toHaveBeenCalledWith(
      "eng",
      1,
      expect.objectContaining({
        ...LOCAL_OCR_ASSET_PATHS,
        workerBlobURL: false,
      }),
    );
  });
});
