import type { AiProvider } from "@shared-ledger/ai";
import { aiImportRecordSchema, supportedFileTypes, type TransactionType } from "@shared-ledger/shared";
import { z } from "zod";

export { supportedFileTypes } from "@shared-ledger/shared";

export type NormalizedImport = { rawText: string; warnings: string[] };

export async function structureForConfirmation(input: {
  bookId: string;
  userId: string;
  normalized: NormalizedImport;
  ai: AiProvider;
  categories?: Array<{ name: string; type: TransactionType }>;
}) {
  const records = await input.ai.structureImport({
    bookId: input.bookId,
    userId: input.userId,
    text: input.normalized.rawText,
    page: "图片识别",
    categories: input.categories,
  });
  return records.map((record) => {
    const warnings = [...record.warnings, ...input.normalized.warnings];
    if (record.items?.length) {
      const itemSum = record.items.reduce((total, item) => total + item.amount, 0);
      if (Math.abs(itemSum - record.amount) > 0.01) {
        warnings.push("明细金额合计与总金额不一致，请核对");
      }
    }
    return aiImportRecordSchema.parse({ ...record, warnings });
  });
}

export const importPayloadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(supportedFileTypes),
});
