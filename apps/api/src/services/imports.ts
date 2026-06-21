import { normalizeFile, structureForConfirmation } from "@shared-ledger/import";
import { PaddleOcrContainerAdapter } from "../ocr";
import { D1LedgerRepository } from "../repository";
import { runtimeAiProvider } from "./ai";
import type { Env } from "../types";

export type ImportQueueMessage = { jobId: string };

export async function processImportJob(env: Env, jobId: string) {
  if (!env.DB || !env.FILES) throw new Error("导入任务缺少 D1 或 R2 绑定");
  const repository = new D1LedgerRepository(env.DB);
  const job = await repository.getImportJob(jobId);
  if (!job) throw new Error("导入任务不存在");
  await repository.updateImportJob(job.id, "parsing");
  const object = await env.FILES.get(job.r2Key);
  if (!object) {
    await repository.updateImportJob(job.id, "failed", "导入原文件不存在");
    throw new Error("导入原文件不存在");
  }
  try {
    const bytes = await object.arrayBuffer();
    const needsOcr = job.fileType.startsWith("image/") || job.fileType === "application/pdf";
    if (needsOcr) await repository.updateImportJob(job.id, "ocr_processing");
    const normalized = await normalizeFile(
      { mimeType: job.fileType, bytes },
      new PaddleOcrContainerAdapter(env.OCR as any),
    );
    await repository.updateImportJob(job.id, "ai_processing");
    const suggestions = await structureForConfirmation({
      bookId: job.bookId,
      userId: job.userId,
      normalized,
      ai: runtimeAiProvider(env, (await repository.ensureAiProviderConfig(job.userId)) ?? undefined),
    });
    const records = await repository.createImportedRecords(job.id, suggestions);
    await repository.updateImportJob(job.id, records.length ? "pending_confirmation" : "completed");
    return records;
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入处理失败";
    await repository.updateImportJob(job.id, "failed", message);
    throw error;
  }
}
