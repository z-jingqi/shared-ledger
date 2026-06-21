import type { AiProvider } from "@shared-ledger/ai";
import { aiImportRecordSchema } from "@shared-ledger/shared";
import Papa from "papaparse";
import { z } from "zod";

export const supportedFileTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"] as const;
export type OcrResult = { text: string; confidence: number; pages?: number };
export interface OcrAdapter { recognize(input: { bytes: ArrayBuffer; mimeType: string }): Promise<OcrResult> }
export class UnavailablePaddleOcrAdapter implements OcrAdapter { async recognize(_input: { bytes: ArrayBuffer; mimeType: string }): Promise<OcrResult> { throw new Error("PaddleOCR Container 尚未启用；请配置 OCR_ADAPTER_ENDPOINT。") } }
export class MockOcrAdapter implements OcrAdapter { async recognize() { return { text: "超市购物 ¥38.50", confidence: 0.94 } } }
export type NormalizedImport = { rawText: string; warnings: string[] };
export function parseCsv(content: string): NormalizedImport {
  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  return { rawText: parsed.data.map((row) => row.join(" | ")).join("\n"), warnings: [] };
}
export async function normalizeFile(file: { mimeType: string; bytes: ArrayBuffer; text?: string }, ocr: OcrAdapter): Promise<NormalizedImport> {
  if (file.mimeType === "text/csv") return parseCsv(file.text ?? new TextDecoder().decode(file.bytes));
  if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") { const result = await ocr.recognize(file); return { rawText: result.text, warnings: result.confidence < 0.8 ? ["OCR 置信度较低"] : [] }; }
  if (file.mimeType.includes("sheet") || file.mimeType.includes("excel")) return { rawText: "Excel 文件等待解析 adapter", warnings: ["当前开发环境使用 Excel adapter 占位实现"] };
  throw new Error("不支持的文件类型");
}
export async function structureForConfirmation(input: { bookId: string; userId: string; normalized: NormalizedImport; ai: AiProvider }) {
  const records = await input.ai.structureImport({ bookId: input.bookId, userId: input.userId, text: input.normalized.rawText, page: "导入" });
  return records.map((record) => aiImportRecordSchema.parse({ ...record, warnings: [...record.warnings, ...input.normalized.warnings] }));
}
export const importPayloadSchema = z.object({ fileName: z.string().min(1), fileType: z.enum(supportedFileTypes) });
