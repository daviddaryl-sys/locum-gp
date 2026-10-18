import {
  suggestCategory,
} from "@/domain/expenseCategoryCatalog";
import { isExpenseDate, type PredefinedExpenseCategoryKey } from "@/domain/expense";
import type { Profession } from "@/domain/profession";

export type ReceiptSuggestionConfidence = "low" | "medium" | "high";

export type ReceiptFieldSuggestion<T> = {
  value: T;
  confidence: ReceiptSuggestionConfidence;
};

export type ReceiptCategorySuggestion = ReceiptFieldSuggestion<
  PredefinedExpenseCategoryKey
> & {
  label: string;
};

export type ReceiptSuggestions = {
  supplier: ReceiptFieldSuggestion<string> | null;
  expenseDate: ReceiptFieldSuggestion<string> | null;
  amountPence: ReceiptFieldSuggestion<number> | null;
  category: ReceiptCategorySuggestion | null;
};

const NON_SUPPLIER_LINE = /\b(?:receipt|invoice|date|subtotal|total|vat|tax)\b/i;
const UK_DATE = /(?:^|\D)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\D|$)/;
const MONEY = /(?:£\s*|\bGBP\s*)?([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})\b/i;

function normalizedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractSupplier(lines: readonly string[]): ReceiptFieldSuggestion<string> | null {
  const candidate = lines.find((line) => {
    if (line.length < 3 || line.length > 160 || NON_SUPPLIER_LINE.test(line)) return false;
    if (UK_DATE.test(line) || MONEY.test(line)) return false;
    const words = line.match(/[\p{L}]+/gu) ?? [];
    const substantialWords = words.filter((word) => word.length >= 3);
    return (line.match(/[\p{L}]/gu)?.length ?? 0) >= 3
      && /[\p{L}].*\s+.*[\p{L}]/u.test(line)
      && substantialWords.length >= 2
      && substantialWords.length * 2 >= words.length;
  });
  return candidate ? { value: candidate, confidence: "high" } : null;
}

function extractDate(lines: readonly string[]): ReceiptFieldSuggestion<string> | null {
  for (const line of lines) {
    const match = line.match(UK_DATE);
    if (!match) continue;
    const [, dayValue, monthValue, yearValue] = match;
    const iso = `${yearValue}-${monthValue.padStart(2, "0")}-${dayValue.padStart(2, "0")}`;
    if (isExpenseDate(iso)) return { value: iso, confidence: "high" };
  }
  return null;
}

function penceFromLine(line: string): number | null {
  const match = line.match(MONEY);
  if (!match) return null;
  const pounds = Number(match[1].replaceAll(",", ""));
  const pence = Number(match[2]);
  const amount = pounds * 100 + pence;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function extractAmount(lines: readonly string[]): ReceiptFieldSuggestion<number> | null {
  const labelledTotals = lines.flatMap((line, index) => {
    if (!/^\s*(?:grand\s+)?total\b/i.test(line)) return [];
    const value = penceFromLine(line);
    return value === null ? [] : [{ value, index }];
  });
  const finalTotal = labelledTotals.at(-1);
  if (finalTotal) return { value: finalTotal.value, confidence: "high" };

  const amounts = lines.flatMap((line) => {
    const value = penceFromLine(line);
    return value === null ? [] : [value];
  });
  const fallback = amounts.at(-1);
  return fallback === undefined ? null : { value: fallback, confidence: "medium" };
}

export function parseReceiptSuggestions(
  rawText: string,
  profession: Profession,
): ReceiptSuggestions {
  const lines = normalizedLines(rawText);
  if (lines.length === 0) {
    return { supplier: null, expenseDate: null, amountPence: null, category: null };
  }

  const categoryMatch = suggestCategory(profession, rawText);
  return {
    supplier: extractSupplier(lines),
    expenseDate: extractDate(lines),
    amountPence: extractAmount(lines),
    category: categoryMatch
      ? {
          value: categoryMatch.key,
          label: categoryMatch.label,
          confidence: "high",
        }
      : null,
  };
}
