import Tesseract from "tesseract.js";

export const LOCAL_OCR_ASSET_PATHS = {
  workerPath: "/ocr/worker.min.js",
  corePath: "/ocr",
  langPath: "/ocr",
} as const;

export type ReceiptOcrProgress = {
  status: string;
  progress: number;
};

export type ReceiptRecognitionWorker = {
  recognize(file: File): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

export type ReceiptOcrWorkerFactory = (
  onProgress: (progress: ReceiptOcrProgress) => void,
) => Promise<ReceiptRecognitionWorker>;

export const createLocalReceiptOcrWorker: ReceiptOcrWorkerFactory = async (
  onProgress,
) => {
  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
    ...LOCAL_OCR_ASSET_PATHS,
    workerBlobURL: false,
    logger(message) {
      onProgress({ status: message.status, progress: message.progress });
    },
  });
  return worker;
};
