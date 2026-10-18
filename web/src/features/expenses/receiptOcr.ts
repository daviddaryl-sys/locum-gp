import { validateReceiptFile } from "@/domain/expense";
import type { Profession } from "@/domain/profession";

import {
  parseReceiptSuggestions,
  type ReceiptSuggestions,
} from "./receiptSuggestions";
import type {
  ReceiptOcrProgress,
  ReceiptOcrWorkerFactory,
  ReceiptRecognitionWorker,
} from "./receiptOcr.worker";

export type { ReceiptOcrProgress, ReceiptOcrWorkerFactory } from "./receiptOcr.worker";

export type ReceiptOcrResult =
  | {
      status: "suggestions";
      suggestions: ReceiptSuggestions;
    }
  | {
      status: "manual-fallback";
      reason: "unsupported-local-preview";
      message: string;
    };

type ReceiptOcrOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ReceiptOcrProgress) => void;
  workerFactory?: ReceiptOcrWorkerFactory;
};

function abortError(): DOMException {
  return new DOMException("Receipt recognition was cancelled.", "AbortError");
}

async function defaultWorkerFactory(
  onProgress: (progress: ReceiptOcrProgress) => void,
): Promise<ReceiptRecognitionWorker> {
  const { createLocalReceiptOcrWorker } = await import("./receiptOcr.worker");
  return createLocalReceiptOcrWorker(onProgress);
}

export async function analyzeReceiptLocally(
  file: File,
  profession: Profession,
  options: ReceiptOcrOptions = {},
): Promise<ReceiptOcrResult> {
  const validationMessage = validateReceiptFile(file);
  if (validationMessage) throw new Error(validationMessage);

  if (file.type === "image/heic" || file.type === "application/pdf") {
    return {
      status: "manual-fallback",
      reason: "unsupported-local-preview",
      message:
        "This receipt can be attached, but its details need to be entered manually on this device.",
    };
  }

  const { signal, onProgress = () => undefined } = options;
  if (signal?.aborted) throw abortError();

  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  let worker: ReceiptRecognitionWorker | null = null;
  let terminatingWorker: ReceiptRecognitionWorker | null = null;
  let termination: Promise<unknown> | null = null;
  const terminateOnce = (
    candidate = worker,
  ): Promise<unknown> => {
    if (!candidate) return Promise.resolve();
    if (terminatingWorker !== candidate) {
      terminatingWorker = candidate;
      termination = Promise.resolve().then(() => candidate.terminate());
    }
    return termination!;
  };
  let rejectForAbort: ((error: DOMException) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const onAbort = () => {
    void terminateOnce().catch(() => undefined);
    rejectForAbort?.(abortError());
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const pendingWorker = Promise.resolve()
      .then(() => workerFactory(onProgress))
      .then((createdWorker) => {
        if (signal?.aborted) {
          void terminateOnce(createdWorker).catch(() => undefined);
        }
        return createdWorker;
      });
    worker = signal
      ? await Promise.race([pendingWorker, aborted])
      : await pendingWorker;
    if (signal?.aborted) throw abortError();

    const recognition = worker.recognize(file);
    const { data } = signal
      ? await Promise.race([recognition, aborted])
      : await recognition;

    return {
      status: "suggestions",
      suggestions: parseReceiptSuggestions(data.text, profession),
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await terminateOnce();
  }
}
