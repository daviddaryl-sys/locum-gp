"use client";

import { useState } from "react";

import { analyzeReceiptLocally } from "./receiptOcr";

async function fictionalReceiptFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1_200;
  canvas.height = 520;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Local image creation is unavailable.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  context.font = "700 64px Arial, sans-serif";
  context.fillText("FICTIONAL MEDICAL SUPPLIES", 60, 110);
  context.font = "52px Arial, sans-serif";
  context.fillText("DATE 08/08/2026", 60, 245);
  context.font = "700 72px Arial, sans-serif";
  context.fillText("TOTAL GBP 42.99", 60, 405);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Local image creation failed."));
    }, "image/png");
  });

  return new File([blob], "fictional-receipt.png", { type: "image/png" });
}

export function ReceiptOcrSmokeHarness() {
  const [status, setStatus] = useState("Ready");

  const runSmoke = async () => {
    setStatus("Starting local OCR");
    try {
      const file = await fictionalReceiptFile();
      const result = await analyzeReceiptLocally(file, "gp", {
        onProgress: ({ status: nextStatus }) => setStatus(nextStatus),
      });
      if (result.status !== "suggestions") {
        throw new Error("Local OCR did not return suggestions.");
      }
      setStatus("Local OCR complete");
    } catch {
      setStatus("Local OCR failed");
    }
  };

  return (
    <main>
      <h1>Local OCR browser smoke</h1>
      <button type="button" onClick={() => void runSmoke()}>
        Run fictional receipt OCR
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
