import { LedgerAIError } from "@shared-ledger/ai";
import { structureForConfirmation } from "@shared-ledger/import";
import type { NormalizedImport } from "@shared-ledger/import";
import { D1LedgerRepository } from "../repository";
import type { ImportedRecord, ImportJob } from "../store";
import type { Env, ImportPipelineMessage, ImportPipelineStep } from "../types";
import { runtimeAiProvider } from "./ai";
import { prepareImageForGoogleVision } from "./image-conversion";
import { reserveImageOcrQuota } from "./import-validation";
import { GoogleVisionOcrError, ocrConfidence, runtimeOcrClient, type GoogleVisionOcrResult } from "./ocr";

const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);
const blockedFinalizeStatuses = new Set(["duplicate_review", "cancel_requested", ...terminalImportStatuses]);
type FailureStage = "ocr" | "ai";
type ImportOcrTextPayload = { rawText: string; warnings: string[] };

const maximumStoredOcrTextBytes = 512 * 1024;

class ImportPipelineHandoffError extends Error {
  readonly stage = "ai" as const;
}

class ImportPipelineStorageError extends Error {
  readonly stage = "ocr" as const;
}

export function isImageImportFileType(fileType: string) {
  return fileType.startsWith("image/");
}

export async function submitOcrJob(env: Env, repository: D1LedgerRepository, job: ImportJob) {
  if (!isImageImportFileType(job.fileType)) throw new Error("当前只支持图片识别");
  runtimeOcrClient(env);
  await enqueueImportPipelineStep(env, job.id, "ocr");
  return (await repository.getImportJob(job.id)) ?? job;
}

export async function enqueueImportPipelineStep(env: Env, jobId: string, step: ImportPipelineStep) {
  if (!env.IMPORT_PIPELINE_QUEUE) throw new Error("IMPORT_PIPELINE_QUEUE 未配置，无法处理导入任务");
  await env.IMPORT_PIPELINE_QUEUE.send({ jobId, step });
}

export async function processImportPipelineBatch(env: Env, batch: MessageBatch<ImportPipelineMessage>) {
  if (!env.DB) throw new Error("导入队列需要 D1 绑定");
  const repository = new D1LedgerRepository(env.DB);
  for (const message of batch.messages) {
    await processImportPipelineMessage(env, repository, message.body, {
      attempts: queueMessageAttempts(message),
    });
  }
}

export async function processImportPipelineMessage(
  env: Env,
  repository: D1LedgerRepository,
  message: ImportPipelineMessage,
  options: { attempts?: number } = {},
) {
  try {
    switch (message.step) {
      case "ocr":
        await processImportOcrStep(env, repository, message.jobId);
        break;
      case "ai":
        await processImportAiStep(env, repository, message.jobId);
        break;
      default:
        message.step satisfies never;
    }
  } catch (error) {
    const failureStage: FailureStage =
      error instanceof ImportPipelineHandoffError || error instanceof ImportPipelineStorageError
        ? error.stage
        : message.step === "ai"
          ? "ai"
          : "ocr";
    const attempts = options.attempts ?? 1;
    if (shouldRetryQueueMessage(error, message.step, attempts)) throw error;
    await markFailed(repository, message.jobId, error, failureStage);
  }
}

async function processImportOcrStep(env: Env, repository: D1LedgerRepository, importJobId: string) {
  let job = await repository.getImportJob(importJobId);
  if (!job || blockedFinalizeStatuses.has(job.status)) return;
  if (job.status === "ai_processing") return;
  const ocrInputR2Key = job.ocrInputR2Key ?? job.r2Key;
  const ocrInputFileType = job.ocrInputFileType ?? job.fileType;
  if (job.status !== "ocr_processing") {
    job = (await repository.markImportJobOcrProcessing(job.id, ocrJobIdFor(job), "google-vision")) ?? job;
  }

  const savedPayload = await readStoredOcrText(env, job, { optional: true });
  if (savedPayload) {
    await handOffImportToAi(env, repository, job.id);
    return;
  }

  const bytes = await readR2Object(env, ocrInputR2Key, {
    message: "OCR 输入文件不存在",
    code: "OCR_INPUT_NOT_FOUND",
  });
  const preparedInput = await prepareImageForGoogleVision({ fileType: ocrInputFileType }, bytes);
  const latestBeforeOcr = await repository.getImportJob(job.id);
  if (!latestBeforeOcr || blockedFinalizeStatuses.has(latestBeforeOcr.status)) return;

  await repository.updateOcrProgress(job.id, { progress: 65, stage: "ocr_analyzing" });
  const result = await runtimeOcrClient(env).recognizeImage({
    bytes: preparedInput.bytes,
    sourceMimeType: job.fileType,
    processedMimeType: preparedInput.fileType,
    converted: ocrInputR2Key !== job.r2Key || preparedInput.fileType !== job.fileType,
  });

  const latestAfterOcr = await repository.getImportJob(job.id);
  if (!latestAfterOcr || blockedFinalizeStatuses.has(latestAfterOcr.status)) return;

  const rawText = normalizeGoogleVisionOcrText(result);
  if (!rawText) {
    throw new GoogleVisionOcrError({
      code: "EMPTY_OCR_RESULT",
      message: "Google Vision 未返回可识别文本",
      stage: "ocr",
      retryable: false,
      terminal: true,
    });
  }
  const ocrTextHash = await sha256Hex(normalizeOcrTextForHash(rawText));

  await repository.setImportJobOcrTextHash(job.id, ocrTextHash);
  const duplicate = await repository.findDuplicateImportByOcrTextHash({
    bookId: job.bookId,
    ocrTextHash,
    excludeJobId: job.id,
  });
  if (duplicate) {
    await repository.markImportJobDuplicateWarning(job.id, duplicate.id);
  }
  const duplicateWarning =
    duplicate || job.duplicateOfImportJobId ? ["可能与已识别的小票重复，请确认后再入账"] : [];
  await writeStoredOcrText(env, job, {
    rawText,
    warnings: [...(ocrConfidence(result) < 0.8 ? ["OCR 置信度较低"] : []), ...duplicateWarning],
  });
  await handOffImportToAi(env, repository, job.id);
}

export async function sha256Hex(input: ArrayBuffer | string) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOcrTextForHash(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。；：、,.，;:]/g, "")
    .toLowerCase();
}

async function processImportAiStep(env: Env, repository: D1LedgerRepository, importJobId: string) {
  const job = await repository.getImportJob(importJobId);
  if (!job || blockedFinalizeStatuses.has(job.status)) return;
  const result = await readStoredOcrText(env, job, { optional: true });
  if (!result?.rawText) {
    await repository.markImportJobFailed(job.id, {
      message: "导入任务缺少 OCR 结果，不能分析",
      code: "MISSING_OCR_RESULT",
      stage: "ai",
      retryable: false,
      terminal: true,
    });
    return;
  }
  await finalizeImportJob(env, repository, job, result);
}

export async function finalizeSavedOcrResult(env: Env, repository: D1LedgerRepository, importJobId: string) {
  const job = await repository.getImportJob(importJobId);
  if (job?.status === "failed" && job.errorStage === "ai" && job.errorRetryable) {
    await repository.prepareImportJobAiRetry(importJobId);
  }
  await processImportPipelineMessage(env, repository, { jobId: importJobId, step: "ai" });
  return repository.listImportedRecords(importJobId);
}

export async function cancelImportJob(env: Env, repository: D1LedgerRepository, job: ImportJob) {
  if (job.status === "completed" || job.status === "pending_confirmation") {
    throw new Error("该导入任务已经生成记录，不能取消");
  }
  if (job.status === "cancel_requested") return job;
  if (job.status === "cancelled") return job;
  if (terminalImportStatuses.has(job.status)) throw new Error("该导入任务已结束，不能取消");
  const updated = await repository.updateImportJob(job.id, "cancelled");
  if (job.status === "uploaded") await repository.releaseImageOcrUsage(job.id);
  await Promise.all([
    env.FILES?.delete(job.r2Key).catch(() => undefined),
    job.ocrInputR2Key && job.ocrInputR2Key !== job.r2Key
      ? env.FILES?.delete(job.ocrInputR2Key).catch(() => undefined)
      : Promise.resolve(),
    deleteStoredOcrText(env, job),
  ]);
  return updated;
}

export async function retryImportJob(env: Env, repository: D1LedgerRepository, job: ImportJob) {
  if (job.status !== "failed" || !job.errorRetryable) throw new Error("该导入任务当前不可重试");
  if (job.errorStage === "ai") {
    const prepared = await repository.prepareImportJobAiRetry(job.id);
    if (!prepared) throw new Error("导入任务不存在");
    await enqueueImportPipelineStep(env, prepared.id, "ai");
    return prepared;
  }
  const prepared = await repository.prepareImportJobRetry(job.id);
  if (!prepared) throw new Error("导入任务不存在");
  await reserveImageOcrQuota(repository, prepared.userId, prepared.id);
  await enqueueImportPipelineStep(env, prepared.id, "ocr");
  return prepared;
}

export async function markFailed(
  repository: D1LedgerRepository,
  importJobId: string,
  error: unknown,
  stage: FailureStage,
) {
  const current = await repository.getImportJob(importJobId);
  if (current && blockedFinalizeStatuses.has(current.status)) return current;
  if (error instanceof GoogleVisionOcrError) {
    return repository.markImportJobFailed(importJobId, {
      message: error.message,
      code: error.code,
      stage: error.stage ?? stage,
      requestId: error.requestId,
      retryable: error.retryable,
      terminal: error.terminal,
      externalJobId: current?.ocrJobId,
    });
  }
  const aiError = error instanceof LedgerAIError ? error : undefined;
  const storageError = error instanceof ImportPipelineStorageError;
  return repository.markImportJobFailed(importJobId, {
    message: error instanceof Error ? error.message : "导入处理失败",
    code: aiError?.code ?? (stage === "ai" ? "AI_PROCESSING_FAILED" : "INTERNAL_ERROR"),
    stage,
    requestId: aiError?.requestId,
    retryable: storageError || (stage === "ai" && aiError?.code !== "quota_exceeded"),
    terminal: !storageError && (stage !== "ai" || aiError?.code === "quota_exceeded"),
    externalJobId: current?.ocrJobId,
  });
}

async function finalizeImportJob(
  env: Env,
  repository: D1LedgerRepository,
  job: ImportJob,
  normalized: NormalizedImport,
) {
  const latest = await repository.getImportJob(job.id);
  if (!latest) throw new Error("导入任务不存在");
  if (blockedFinalizeStatuses.has(latest.status)) return repository.listImportedRecords(job.id);
  const existing = await repository.listImportedRecords(job.id);
  if (existing.length) {
    if (latest.status !== "completed" && latest.status !== "pending_confirmation") {
      await repository.updateImportJob(job.id, latest.autoConfirm ? "completed" : "pending_confirmation");
    }
    return existing;
  }
  await repository.markImportJobAiProcessing(job.id, "ai_text_ready");
  const book = await repository.getBook(latest.bookId);
  if (!book) throw new Error("账本不存在");
  let suggestions;
  try {
    await repository.updateOcrProgress(job.id, { stage: "ai_structuring", progress: 100 });
    suggestions = await structureForConfirmation({
      bookId: latest.bookId,
      userId: latest.userId,
      normalized,
      incomeEnabled: book.incomeEnabled,
      categories: (await repository.listCategories(latest.userId))
        .map((category) => ({
          name: category.name,
          type: category.type,
        }))
        .filter(
          (category): category is { name: string; type: "income" | "expense" } =>
            (category.type === "income" && book.incomeEnabled) || category.type === "expense",
        ),
      ai: runtimeAiProvider(env, { id: latest.userId, plan: await repository.getUserPlan(latest.userId) }),
      onProgress: async (progress) => {
        const current = await repository.getImportJob(job.id);
        if (!current || blockedFinalizeStatuses.has(current.status)) {
          throw new LedgerAIError("provider_unavailable", "导入任务已取消");
        }
        await repository.updateOcrProgress(job.id, {
          stage: progress.stage,
          progress: 100,
          currentPage: progress.chunkIndex ?? null,
          totalPages: progress.chunkTotal ?? null,
        });
      },
    });
  } catch (error) {
    await markFailed(repository, job.id, error, "ai");
    throw error;
  }
  const beforeCreate = await repository.getImportJob(job.id);
  if (!beforeCreate || blockedFinalizeStatuses.has(beforeCreate.status))
    return repository.listImportedRecords(job.id);
  await repository.updateOcrProgress(job.id, { stage: "ai_saving", progress: 100 });
  const records = await repository.createImportedRecords(job.id, suggestions);
  if (latest.autoConfirm && !beforeCreate.duplicateOfImportJobId && records.length) {
    await confirmImportedRecords(repository, latest, records);
    await repository.updateImportJob(job.id, "completed");
    await deleteStoredOcrText(env, latest);
    return records;
  }
  await repository.updateImportJob(job.id, records.length ? "pending_confirmation" : "completed");
  await deleteStoredOcrText(env, latest);
  return records;
}

async function confirmImportedRecords(
  repository: D1LedgerRepository,
  job: ImportJob,
  records: ImportedRecord[],
) {
  const book = await repository.getBook(job.bookId);
  if (!book) throw new Error("账本不存在");
  for (const record of records) {
    const parsedSuggestion = record.suggestedTransaction as {
      type: "expense" | "income";
      amount: number;
      categoryName?: string;
      note?: string;
      occurredAt: string;
      items?: Array<{ name: string; amount: number; categoryName?: string; note?: string }>;
    };
    const suggested = book.incomeEnabled
      ? parsedSuggestion
      : { ...parsedSuggestion, type: "expense" as const };
    const categoryCache = new Map<string, Awaited<ReturnType<D1LedgerRepository["findOrCreateCategory"]>>>();
    const resolveCategory = async (name?: string) => {
      const normalized = name?.trim();
      if (!normalized) return null;
      const cacheKey = `${suggested.type}:${normalized}`;
      const cached = categoryCache.get(cacheKey);
      if (cached) return cached;
      const category = await repository.findOrCreateCategory(job.userId, normalized, suggested.type);
      categoryCache.set(cacheKey, category);
      return category;
    };
    const category = await resolveCategory(suggested.categoryName);
    const member = await repository.findMember(job.bookId, job.userId);
    const items = [];
    for (const item of suggested.items ?? []) {
      const itemCategory = await resolveCategory(item.categoryName);
      items.push({
        name: item.name,
        amount: item.amount,
        categoryId: itemCategory?.id,
        note: item.note,
      });
    }
    await repository.createTransaction(job.bookId, job.userId, {
      type: suggested.type,
      amount: suggested.amount,
      categoryId: category?.id,
      memberId: member?.id,
      note: suggested.note,
      occurredAt: suggested.occurredAt,
      items,
    } as any);
    await repository.updateImportedRecord(record.id, record.suggestedTransaction, "confirmed");
  }
}

async function readR2Object(env: Env, r2Key: string, error: { message: string; code: string }) {
  let object: R2ObjectBody | null | undefined;
  try {
    object = await env.FILES?.get(r2Key);
  } catch (cause) {
    throw new GoogleVisionOcrError({
      message: cause instanceof Error ? `读取 OCR 输入失败：${cause.message}` : "读取 OCR 输入失败",
      code: "OCR_INPUT_READ_FAILED",
      stage: "ocr",
      retryable: true,
      terminal: false,
    });
  }
  if (!object) {
    throw new GoogleVisionOcrError({
      message: error.message,
      code: error.code,
      stage: "ocr",
      retryable: false,
      terminal: true,
    });
  }
  return object.arrayBuffer();
}

export function normalizeGoogleVisionOcrText(result: GoogleVisionOcrResult) {
  const markdownText = result.markdown?.trim();
  const plainText = result.plainText?.trim();
  return markdownText && plainText && markdownText !== plainText
    ? `OCR markdown:\n${markdownText}\n\nOCR plain text:\n${plainText}`
    : (markdownText ?? plainText ?? "");
}

export function importOcrTextR2Key(job: Pick<ImportJob, "r2Key">) {
  return `${job.r2Key}.ocr.json`;
}

async function handOffImportToAi(env: Env, repository: D1LedgerRepository, importJobId: string) {
  await repository.markImportJobAiProcessing(importJobId, "ai_queued");
  try {
    await enqueueImportPipelineStep(env, importJobId, "ai");
  } catch (error) {
    throw new ImportPipelineHandoffError(
      error instanceof Error ? `AI 任务提交失败：${error.message}` : "AI 任务提交失败",
    );
  }
}

async function writeStoredOcrText(env: Env, job: ImportJob, payload: ImportOcrTextPayload) {
  if (!env.FILES) throw new Error("导入功能需要 R2 绑定");
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.byteLength > maximumStoredOcrTextBytes) {
    throw new LedgerAIError("input_too_large", "OCR 文本过长，请拆分图片后重试");
  }
  try {
    await env.FILES.put(importOcrTextR2Key(job), encoded, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { importJobId: job.id, purpose: "ocr-pipeline" },
    });
  } catch (error) {
    throw new ImportPipelineStorageError(
      error instanceof Error ? `暂存 OCR 文本失败：${error.message}` : "暂存 OCR 文本失败",
    );
  }
}

async function readStoredOcrText(
  env: Env,
  job: ImportJob,
  options: { optional?: boolean } = {},
): Promise<ImportOcrTextPayload | null> {
  const object = await env.FILES?.get(importOcrTextR2Key(job));
  if (!object) {
    if (options.optional) return null;
    throw new Error("导入任务缺少 OCR 文本");
  }
  if (object.size > maximumStoredOcrTextBytes) {
    throw new LedgerAIError("input_too_large", "OCR 文本过长，请拆分图片后重试");
  }
  const parsed = JSON.parse(
    new TextDecoder().decode(await object.arrayBuffer()),
  ) as Partial<ImportOcrTextPayload>;
  if (typeof parsed.rawText !== "string" || !parsed.rawText.trim()) {
    throw new Error("导入任务缺少 OCR 文本");
  }
  return {
    rawText: parsed.rawText,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

export async function deleteStoredOcrText(env: Env, job: Pick<ImportJob, "r2Key">) {
  await env.FILES?.delete(importOcrTextR2Key(job)).catch(() => undefined);
}

export async function cleanupExpiredImportArtifacts(env: Env, repository: D1LedgerRepository) {
  const jobs = await repository.listExpiredImportJobs();
  for (const job of jobs) {
    await Promise.all([
      env.FILES?.delete(job.r2Key).catch(() => undefined),
      job.ocrInputR2Key && job.ocrInputR2Key !== job.r2Key
        ? env.FILES?.delete(job.ocrInputR2Key).catch(() => undefined)
        : Promise.resolve(),
      deleteStoredOcrText(env, job),
    ]);
    await repository.softDeleteImportedRecordsForJob(job.id);
    await repository.softDeleteImportJob(job.id);
  }
}

function ocrJobIdFor(job: ImportJob) {
  return `ocr_${job.id}_${job.retryCount ?? 0}`;
}

function shouldRetryQueueMessage(error: unknown, step: ImportPipelineStep, attempts: number) {
  if (step === "ai") return false;
  if (error instanceof ImportPipelineHandoffError || error instanceof ImportPipelineStorageError)
    return false;
  if (!(error instanceof GoogleVisionOcrError) || !error.retryable) return false;
  return attempts < 3;
}

function queueMessageAttempts(message: Message<ImportPipelineMessage>) {
  return typeof message.attempts === "number" && Number.isFinite(message.attempts) ? message.attempts : 1;
}
