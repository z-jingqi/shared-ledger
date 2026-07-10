import { describe, expect, it } from "vitest";
import { evaluateReceiptFixture, normalizeReceiptName } from "./receipt-eval";

const runLiveEval = process.env.RUN_RECEIPT_AI_EVAL === "1";

describe.skipIf(!runLiveEval)("IMG_4706 live AI receipt evaluation", () => {
  it(
    "extracts the verified receipt fields and line items",
    async () => {
      const { record, expected, score } = await evaluateReceiptFixture("IMG_4706");

      expect(record.type).toBe(expected.type);
      expect(record.amount).toBeCloseTo(expected.amount, 2);
      expect(record.occurredAt.startsWith(expected.occurredAt.slice(0, 10))).toBe(true);
      expect(normalizeReceiptName(record.note ?? "")).toContain(
        normalizeReceiptName(expected.merchantIncludes),
      );
      expect(score.recall).toBeGreaterThanOrEqual(0.8);
      expect(score.precision).toBeGreaterThanOrEqual(0.8);
      expect(score.duplicateCount).toBe(0);
    },
    10 * 60_000,
  );
});
