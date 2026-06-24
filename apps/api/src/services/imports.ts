import { normalizeFile, structureForConfirmation } from "@shared-ledger/import";
import type { NormalizedImport, OcrAdapter } from "@shared-ledger/import";
import { D1LedgerRepository } from "../repository";
import { runtimeAiProvider } from "./ai";
import { ocrConfidence, runtimeOcrClient } from "./ocr";
import type { ImportedRecord, ImportJob } from "../store";
import type { Env } from "../types";

export type ImportQueueMessage = { jobId: string };
const unusedOcrAdapter: OcrAdapter = {
  async recognize() {
    throw new Error("图片和 PDF 必须通过 Aleph-OCR 处理");
  },
};

export async function processImportJob(env: Env, jobId: string) {
  if (!env.DB || !env.FILES) throw new Error("导入任务缺少 D1 或 R2 绑定");
  const repository = new D1LedgerRepository(env.DB);
  const job = await repository.getImportJob(jobId);
  if (!job) throw new Error("导入任务不存在");
  try {
    const needsOcr = job.fileType.startsWith("image/") || job.fileType === "application/pdf";
    const normalized = needsOcr
      ? await resolveAlephOcrImport(env, repository, job)
      : await normalizeStoredFile(env, repository, job);
    if (!normalized) return [];
    await repository.updateImportJob(job.id, "ai_processing");
    const suggestions = await structureForConfirmation({
      bookId: job.bookId,
      userId: job.userId,
      normalized,
      ai: runtimeAiProvider(env, (await repository.ensureAiProviderConfig(job.userId)) ?? undefined),
    });
    const records = await repository.createImportedRecords(job.id, suggestions);
    if (job.autoConfirm && records.length) {
      await confirmImportedRecords(repository, job, records);
      await repository.updateImportJob(job.id, "completed");
      return records;
    }
    await repository.updateImportJob(job.id, records.length ? "pending_confirmation" : "completed");
    return records;
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入处理失败";
    await repository.updateImportJob(job.id, "failed", message);
    throw error;
  }
}

async function confirmImportedRecords(
  repository: D1LedgerRepository,
  job: ImportJob,
  records: ImportedRecord[],
) {
  for (const record of records) {
    const suggested = record.suggestedTransaction as {
      type: "expense" | "income";
      amount: number;
      categoryName?: string;
      note?: string;
      occurredAt: string;
    };
    const [category, member] = await Promise.all([
      repository.findCategoryByName(job.bookId, suggested.categoryName),
      repository.findMember(job.bookId, job.userId),
    ]);
    await repository.createTransaction(job.bookId, job.userId, {
      type: suggested.type,
      amount: suggested.amount,
      categoryId: category?.id,
      memberId: member?.id,
      note: suggested.note,
      occurredAt: suggested.occurredAt,
      tagIds: [],
      items: [],
    });
    await repository.updateImportedRecord(record.id, record.suggestedTransaction, "confirmed");
  }
}

async function normalizeStoredFile(
  env: Env,
  repository: D1LedgerRepository,
  job: Awaited<ReturnType<D1LedgerRepository["getImportJob"]>>,
) {
  if (!job) throw new Error("导入任务不存在");
  await repository.updateImportJob(job.id, "parsing");
  const object = await env.FILES?.get(job.r2Key);
  if (!object) {
    await repository.updateImportJob(job.id, "failed", "导入原文件不存在");
    throw new Error("导入原文件不存在");
  }
  return normalizeFile({ mimeType: job.fileType, bytes: await object.arrayBuffer() }, unusedOcrAdapter);
}

async function resolveAlephOcrImport(
  env: Env,
  repository: D1LedgerRepository,
  job: NonNullable<Awaited<ReturnType<D1LedgerRepository["getImportJob"]>>>,
): Promise<NormalizedImport | null> {
  await repository.updateImportJob(job.id, "ocr_processing");
  const client = runtimeOcrClient(env);
  if (!job.ocrJobId) {
    const object = await env.FILES?.get(job.r2Key);
    if (!object) {
      await repository.updateImportJob(job.id, "failed", "导入原文件不存在");
      throw new Error("导入原文件不存在");
    }
    const alephJob = await client.createJob({
      bytes: await object.arrayBuffer(),
      filename: job.fileName,
      mimeType: job.fileType,
    });
    await repository.attachOcrJob(job.id, alephJob.jobId);
    await requeueOcrPoll(env, job.id);
    return null;
  }

  if (isOcrTimedOut(env, job.ocrSubmittedAt)) {
    await repository.updateImportJob(job.id, "failed", "OCR 处理超时");
    throw new Error("OCR 处理超时");
  }

  const alephJob = await client.getJob(job.ocrJobId);
  if (alephJob.status === "queued" || alephJob.status === "processing") {
    await repository.incrementOcrPoll(job.id);
    await requeueOcrPoll(env, job.id);
    return null;
  }
  if (alephJob.status === "failed" || alephJob.status === "deleted") {
    const message = alephJob.error ?? `Aleph-OCR 任务状态为 ${alephJob.status}`;
    await repository.updateImportJob(job.id, "failed", message);
    throw new Error(message);
  }

  const result = await client.getResult(job.ocrJobId);
  const rawText = result.plainText?.trim() || result.markdown?.trim();
  if (!rawText) {
    await repository.updateImportJob(job.id, "failed", "Aleph-OCR 未返回可识别文本");
    throw new Error("Aleph-OCR 未返回可识别文本");
  }
  const confidence = ocrConfidence(result);
  return { rawText, warnings: confidence < 0.8 ? ["OCR 置信度较低"] : [] };
}

async function requeueOcrPoll(env: Env, jobId: string) {
  if (!env.IMPORT_QUEUE) throw new Error("导入队列未配置，无法继续轮询 OCR");
  await env.IMPORT_QUEUE.send({ jobId }, { delaySeconds: pollDelaySeconds(env) });
}

function pollDelaySeconds(env: Env) {
  const value = Number(env.OCR_POLL_DELAY_SECONDS ?? 20);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

function isOcrTimedOut(env: Env, submittedAt?: string) {
  if (!submittedAt) return false;
  const maxMinutes = Number(env.OCR_MAX_WAIT_MINUTES ?? 30);
  const timeoutMs = (Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 30) * 60_000;
  return Date.now() - new Date(submittedAt).getTime() > timeoutMs;
}
