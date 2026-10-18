import { notFound } from "next/navigation";

import { ReceiptOcrSmokeHarness } from "@/features/expenses/ReceiptOcrSmokeHarness";

export const dynamic = "force-dynamic";

export default function ReceiptOcrSmokePage() {
  if (process.env.LOCUM_E2E_OCR_SMOKE !== "true") notFound();

  return <ReceiptOcrSmokeHarness />;
}
