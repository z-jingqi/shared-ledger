import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeFile, parseCsv, parseExcel } from "../src/index";
import { MockOcrAdapter } from "./fixtures";
describe("import pipeline", () => {
  it("normalizes CSV before AI", () =>
    expect(parseCsv("日期,金额\n2026-01-01,12.50").rawText).toContain("12.50"));
  it("normalizes Excel as JSONL with sheet, row, and column coordinates", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["交易时间", "金额"],
      ["2026-01-01 12:00", "-18.50"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "微信账单");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const lines = parseExcel(bytes)
      .rawText.split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toEqual([
      { sheet: "微信账单", row: 1, cells: { A: "交易时间", B: "金额" } },
      { sheet: "微信账单", row: 2, cells: { A: "2026-01-01 12:00", B: "-18.50" } },
    ]);
  });
  it("marks low confidence OCR results", async () => {
    const result = await normalizeFile(
      { mimeType: "image/png", bytes: new ArrayBuffer(0) },
      new MockOcrAdapter(),
    );
    expect(result.rawText).toContain("38.50");
  });
});
