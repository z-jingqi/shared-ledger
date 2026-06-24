import type { AiProvider } from "@shared-ledger/ai";
import { aiImportRecordSchema, supportedFileTypes } from "@shared-ledger/shared";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";

export { supportedFileTypes } from "@shared-ledger/shared";
export type OcrResult = { text: string; confidence: number; pages?: number };
export interface OcrAdapter {
  recognize(input: { bytes: ArrayBuffer; mimeType: string }): Promise<OcrResult>;
}
export type NormalizedImport = { rawText: string; warnings: string[] };
export function parseCsv(content: string): NormalizedImport {
  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  return { rawText: parsed.data.map((row) => row.join(" | ")).join("\n"), warnings: [] };
}
export function parseExcel(bytes: ArrayBuffer): NormalizedImport {
  const workbook = XLSX.read(bytes, { type: "array", cellText: true, cellDates: true });
  const lines: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
      raw: false,
    });
    rows.forEach((row, index) => {
      const cells = rowToCells(row);
      if (Object.keys(cells).length === 0) return;
      lines.push(JSON.stringify({ sheet: sheetName, row: index + 1, cells }));
    });
  }
  if (!lines.length) throw new Error("Excel 文件中没有可导入的数据");
  return { rawText: lines.join("\n"), warnings: [] };
}
export async function normalizeFile(
  file: { mimeType: string; bytes: ArrayBuffer; text?: string },
  ocr: OcrAdapter,
): Promise<NormalizedImport> {
  if (file.mimeType === "text/csv") return parseCsv(file.text ?? new TextDecoder().decode(file.bytes));
  if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") {
    const result = await ocr.recognize(file);
    return { rawText: result.text, warnings: result.confidence < 0.8 ? ["OCR 置信度较低"] : [] };
  }
  if (file.mimeType.includes("sheet") || file.mimeType.includes("excel")) {
    return parseExcel(file.bytes);
  }
  throw new Error("不支持的文件类型");
}
export async function structureForConfirmation(input: {
  bookId: string;
  userId: string;
  normalized: NormalizedImport;
  ai: AiProvider;
}) {
  const records = await input.ai.structureImport({
    bookId: input.bookId,
    userId: input.userId,
    text: input.normalized.rawText,
    page: "导入",
  });
  return records.map((record) =>
    aiImportRecordSchema.parse({ ...record, warnings: [...record.warnings, ...input.normalized.warnings] }),
  );
}
export const importPayloadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(supportedFileTypes),
});

function rowToCells(row: unknown[]): Record<string, string> {
  return row.reduce<Record<string, string>>((cells, value, index) => {
    const normalized = normalizeCellValue(value);
    if (!normalized) return cells;
    cells[columnName(index)] = normalized;
    return cells;
  }, {});
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function columnName(index: number): string {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}
