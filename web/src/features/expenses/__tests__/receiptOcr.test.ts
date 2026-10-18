import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { analyzeReceiptLocally, type ReceiptOcrWorkerFactory } from "../receiptOcr";
import {
  LOCAL_OCR_ASSET_PATHS,
  type ReceiptRecognitionWorker,
} from "../receiptOcr.worker";

function imageFile(type: "image/jpeg" | "image/png" = "image/jpeg") {
  return new File(["fictional pixels"], type === "image/png" ? "receipt.png" : "receipt.jpg", { type });
}

function fakeFactory({
  rawText = "Fictional Medical Supplies\nDate 08/08/2026\nTotal £42.99",
  recognize,
  terminate = vi.fn().mockResolvedValue(undefined),
}: {
  rawText?: string;
  recognize?: ReceiptRecognitionWorker["recognize"];
  terminate?: ReceiptRecognitionWorker["terminate"];
} = {}) {
  const factory: ReceiptOcrWorkerFactory = vi.fn(async (onProgress) => {
    onProgress({ status: "recognizing text", progress: 0.5 });
    return {
      recognize: recognize ?? vi.fn().mockResolvedValue({ data: { text: rawText } }),
      terminate,
    };
  });
  return { factory, terminate };
}

describe("local receipt OCR adapter", () => {
  it.each(["image/jpeg", "image/png"] as const)(
    "analyses a supported %s file and returns structured suggestions only",
    async (type) => {
      const { factory, terminate } = fakeFactory();
      const progress = vi.fn();

      const result = await analyzeReceiptLocally(imageFile(type), "gp", {
        onProgress: progress,
        workerFactory: factory,
      });

      expect(result).toMatchObject({
        status: "suggestions",
        suggestions: {
          supplier: { value: "Fictional Medical Supplies" },
          amountPence: { value: 4299 },
        },
      });
      expect(JSON.stringify(result)).not.toContain("Date 08/08/2026");
      expect(progress).toHaveBeenCalledWith({ status: "recognizing text", progress: 0.5 });
      expect(terminate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["receipt.heic", "image/heic"],
    ["receipt.pdf", "application/pdf"],
  ])("keeps valid %s files local and requests manual entry", async (name, type) => {
    const factory = vi.fn();
    const result = await analyzeReceiptLocally(
      new File(["fictional attachment"], name, { type }),
      "gp",
      { workerFactory: factory },
    );

    expect(result).toEqual({
      status: "manual-fallback",
      reason: "unsupported-local-preview",
      message: "This receipt can be attached, but its details need to be entered manually on this device.",
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "receipt.exe", type: "application/octet-stream", size: 12 }, "Choose a JPG, PNG, HEIC, or PDF receipt."],
    [{ name: "receipt.jpg", type: "image/jpeg", size: 0 }, "Receipt must not be empty."],
    [{ name: "receipt.jpg", type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }, "Receipt must be 10 MB or smaller."],
  ])("rejects invalid receipt files without creating a worker", async (file, message) => {
    const factory = vi.fn();
    await expect(
      analyzeReceiptLocally(file as File, "gp", { workerFactory: factory }),
    ).rejects.toThrow(message);
    expect(factory).not.toHaveBeenCalled();
  });

  it("terminates its worker when recognition fails", async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const { factory } = fakeFactory({
      recognize: vi.fn().mockRejectedValue(new Error("Recognition failed.")),
      terminate,
    });

    await expect(
      analyzeReceiptLocally(imageFile(), "gp", { workerFactory: factory }),
    ).rejects.toThrow("Recognition failed.");
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("does not create a worker when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn();

    await expect(
      analyzeReceiptLocally(imageFile(), "gp", {
        signal: controller.signal,
        workerFactory: factory,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects promptly when cancelled while worker creation never resolves", async () => {
    const controller = new AbortController();
    const factory: ReceiptOcrWorkerFactory = vi.fn(
      () => new Promise<ReceiptRecognitionWorker>(() => undefined),
    );

    const analysis = analyzeReceiptLocally(imageFile(), "gp", {
      signal: controller.signal,
      workerFactory: factory,
    });
    controller.abort();

    const settledPromptly = Promise.race([
      analysis,
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 50),
      ),
    ]);
    await expect(settledPromptly).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects promptly then terminates a worker that resolves after cancellation", async () => {
    const controller = new AbortController();
    const terminate = vi.fn().mockResolvedValue(undefined);
    const recognize = vi.fn();
    let finishLoading: ((worker: ReceiptRecognitionWorker) => void) | undefined;
    const factory: ReceiptOcrWorkerFactory = vi.fn(
      () =>
        new Promise<ReceiptRecognitionWorker>((resolve) => {
          finishLoading = resolve;
        }),
    );

    const analysis = analyzeReceiptLocally(imageFile(), "gp", {
      signal: controller.signal,
      workerFactory: factory,
    });
    controller.abort();
    await expect(
      Promise.race([
        analysis,
        new Promise<"timed-out">((resolve) =>
          setTimeout(() => resolve("timed-out"), 50),
        ),
      ]),
    ).rejects.toMatchObject({ name: "AbortError" });

    finishLoading?.({ recognize, terminate });
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
    expect(recognize).not.toHaveBeenCalled();
  });

  it("terminates its worker when cancelled during recognition", async () => {
    const controller = new AbortController();
    const terminate = vi.fn().mockResolvedValue(undefined);
    const { factory } = fakeFactory({
      recognize: vi.fn(
        () => new Promise<{ data: { text: string } }>(() => undefined),
      ),
      terminate,
    });

    const analysis = analyzeReceiptLocally(imageFile(), "gp", {
      signal: controller.signal,
      workerFactory: factory,
    });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates a worker that finishes loading after cancellation", async () => {
    const controller = new AbortController();
    const terminate = vi.fn().mockResolvedValue(undefined);
    let finishLoading: ((worker: ReceiptRecognitionWorker) => void) | undefined;
    const factory: ReceiptOcrWorkerFactory = vi.fn(
      () =>
        new Promise<ReceiptRecognitionWorker>((resolve) => {
          finishLoading = resolve;
        }),
    );

    const analysis = analyzeReceiptLocally(imageFile(), "gp", {
      signal: controller.signal,
      workerFactory: factory,
    });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    controller.abort();
    finishLoading?.({ recognize: vi.fn(), terminate });

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("uses same-origin production asset paths with no remote OCR URL", () => {
    expect(LOCAL_OCR_ASSET_PATHS).toEqual({
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
    });
    for (const path of Object.values(LOCAL_OCR_ASSET_PATHS)) {
      expect(path).toMatch(/^\/ocr(?:\/|$)/);
      expect(path).not.toMatch(/https?:|cdn/i);
    }
  });

  it("ships a generated worker with no remote OCR fallback endpoints", () => {
    const workerSource = readFileSync(
      path.resolve(process.cwd(), "public/ocr/worker.min.js"),
      "utf8",
    );
    const productionConfiguration = JSON.stringify(LOCAL_OCR_ASSET_PATHS);
    const prohibitedRemoteEndpoint =
      /cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com|https?:\/\//i;

    expect(workerSource).not.toMatch(prohibitedRemoteEndpoint);
    expect(productionConfiguration).not.toMatch(prohibitedRemoteEndpoint);
  });

  it("prepares the browser OCR dependency without remote fallback endpoints", () => {
    const dependencySources = [
      "node_modules/tesseract.js/src/worker/browser/defaultOptions.js",
      "node_modules/tesseract.js/src/worker-script/browser/getCore.js",
      "node_modules/tesseract.js/src/worker-script/index.js",
    ].map((relativePath) =>
      readFileSync(path.resolve(process.cwd(), relativePath), "utf8"),
    );
    const prohibitedRemoteEndpoint =
      /cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com|https?:\/\//i;

    for (const source of dependencySources) {
      expect(source).not.toMatch(prohibitedRemoteEndpoint);
    }
  });
});
