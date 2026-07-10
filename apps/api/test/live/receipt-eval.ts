import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { structureForConfirmation } from "@shared-ledger/import";
import { runtimeAiProvider } from "../../src/services/ai";
import type { Env } from "../../src/types";

export type ExpectedReceipt = {
  type: "income" | "expense";
  amount: number;
  occurredAt: string;
  merchantIncludes: string;
  items: Array<{ name: string; amount: number }>;
};

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(testDir, "../fixtures/receipts");

export async function evaluateReceiptFixture(fixtureName: string) {
  const vars = parseDevVars(await readFile(resolve(testDir, "../../.dev.vars"), "utf8"));
  const model = process.env.RECEIPT_EVAL_MODEL || vars.OPENROUTER_MODEL;
  if (!vars.OPENROUTER_API_KEY || !model) {
    throw new Error("OPENROUTER_API_KEY and OPENROUTER_MODEL are required in apps/api/.dev.vars");
  }
  const [ocrText, expected] = await Promise.all([
    readFile(resolve(fixtureDir, `${fixtureName}.ocr.txt`), "utf8"),
    readFile(resolve(fixtureDir, `${fixtureName}.expected.json`), "utf8").then(
      (source) => JSON.parse(source) as ExpectedReceipt,
    ),
  ]);
  const progress: string[] = [];
  const startedAt = Date.now();
  const records = await structureForConfirmation({
    bookId: "book_receipt_eval",
    userId: "user_receipt_eval",
    normalized: { rawText: ocrText, warnings: [] },
    categories: [
      { name: "购物", type: "expense" },
      { name: "食品", type: "expense" },
      { name: "日用品", type: "expense" },
    ],
    ai: runtimeAiProvider(
      {
        APP_ENV: "local",
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: vars.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: model,
        OPENROUTER_BASE_URL: vars.OPENROUTER_BASE_URL,
        WEB_ORIGIN: "http://localhost:5175",
      } as Env,
      { id: "user_receipt_eval", plan: "pro" },
    ),
    onProgress(event) {
      progress.push(event.text);
    },
  });
  const record = records[0];
  if (!record) throw new Error("AI returned no receipt record");
  const score = scoreReceipt(record, expected);
  const report = {
    fixtureName,
    model,
    durationMs: Date.now() - startedAt,
    progress,
    score,
    result: record,
  };
  console.log("[receipt-ai-eval]", JSON.stringify(report, null, 2));
  return { record, expected, score, report };
}

function scoreReceipt(
  actual: { items?: Array<{ name: string; amount: number }> },
  expected: ExpectedReceipt,
) {
  const actualItems = actual.items ?? [];
  const available = new Set(actualItems.map((_, index) => index));
  const matches = expected.items.flatMap((expectedItem) => {
    const candidates = [...available]
      .map((index) => ({
        index,
        item: actualItems[index],
        similarity: nameSimilarity(expectedItem.name, actualItems[index]?.name ?? ""),
      }))
      .filter(
        (candidate) =>
          candidate.item &&
          Math.abs(candidate.item.amount - expectedItem.amount) <= 0.01 &&
          candidate.similarity >= 0.2,
      )
      .sort((left, right) => right.similarity - left.similarity);
    const match = candidates[0];
    if (!match) return [];
    available.delete(match.index);
    return [{ expected: expectedItem, actual: match.item, similarity: match.similarity }];
  });
  const normalizedKeys = actualItems.map(
    (item) => `${normalizeReceiptName(item.name)}|${item.amount.toFixed(2)}`,
  );
  return {
    expectedItemCount: expected.items.length,
    actualItemCount: actualItems.length,
    matchedItemCount: matches.length,
    recall: matches.length / expected.items.length,
    precision: actualItems.length ? matches.length / actualItems.length : 0,
    duplicateCount: normalizedKeys.length - new Set(normalizedKeys).size,
    unmatchedExpected: expected.items.filter((item) => !matches.some((match) => match.expected === item)),
    unmatchedActual: [...available].map((index) => actualItems[index]),
  };
}

function nameSimilarity(left: string, right: string) {
  const leftBigrams = bigrams(normalizeReceiptName(left));
  const rightBigrams = bigrams(normalizeReceiptName(right));
  if (!leftBigrams.size || !rightBigrams.size) {
    return normalizeReceiptName(left) === normalizeReceiptName(right) ? 1 : 0;
  }
  let intersection = 0;
  for (const value of leftBigrams) if (rightBigrams.has(value)) intersection += 1;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function bigrams(value: string) {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

export function normalizeReceiptName(value: string) {
  return value
    .toLowerCase()
    .replace(/^\d{8,}/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseDevVars(source: string) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}
