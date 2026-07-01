import type { AiProvider } from "@shared-ledger/ai";
import { aiImportRecordSchema, supportedFileTypes } from "@shared-ledger/shared";
import { z } from "zod";

export { supportedFileTypes } from "@shared-ledger/shared";

export type NormalizedImport = { rawText: string; warnings: string[] };

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
    page: "图片识别",
  });
  return records.map((record) =>
    aiImportRecordSchema.parse({ ...record, warnings: [...record.warnings, ...input.normalized.warnings] }),
  );
}

export const importPayloadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(supportedFileTypes),
});
