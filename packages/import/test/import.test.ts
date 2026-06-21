import { describe, expect, it } from "vitest";
import { normalizeFile, parseCsv } from "../src/index";
import { MockOcrAdapter } from "./fixtures";
describe("import pipeline", () => {
  it("normalizes CSV before AI", () =>
    expect(parseCsv("日期,金额\n2026-01-01,12.50").rawText).toContain("12.50"));
  it("marks low confidence OCR results", async () => {
    const result = await normalizeFile(
      { mimeType: "image/png", bytes: new ArrayBuffer(0) },
      new MockOcrAdapter(),
    );
    expect(result.rawText).toContain("38.50");
  });
});
