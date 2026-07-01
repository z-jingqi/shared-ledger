import { AlephAIError } from "@shared-ledger/ai";
import { structureForConfirmation } from "@shared-ledger/import";
import type { NormalizedImport } from "@shared-ledger/import";
import { D1LedgerRepository } from "../repository";
import { runtimeAiProvider } from "./ai";
import { AlephToolsError, ocrConfidence, runtimeOcrClient } from "./ocr";
import type { AlephErrorPayload, AlephOcrJob } from "./ocr";
import type { ImportedRecord, ImportJob } from "../store";
import type { Env } from "../types";

const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);
type AlephPhase = "ocr";
type FailureStage = AlephPhase | "ai";

export function isOcrImportFileType(fileType: string) {
  return fileType.startsWith("image/");
}

export function isImageImportFileType(fileType: string) {
  return fileType.startsWith("image/");
}

export async function submitAlephOcrJob(
  env: Env,
  repository: D1LedgerRepository,
  job: ImportJob,
  bytes?: ArrayBuffer,
  requestOrigin?: string,
) {
  if (!isImageImportFileType(job.fileType)) throw new Error("当前只支持图片识别");
  const sourceBytes = bytes ?? (await readStoredFile(env, repository, job));
  const callbackUrl = `${apiPublicOrigin(env, requestOrigin)}/imports/aleph-webhook`;
  const alephJob = await runtimeOcrClient(env).createOcrJob(
    { bytes: sourceBytes, filename: job.fileName, mimeType: job.fileType },
    {
      callbackUrl,
      metadata: { importJobId: job.id, phase: "ocr" },
      idempotencyKey: `ocr:${job.id}:${job.retryCount ?? 0}`,
    },
  );
  const attached = await repository.attachOcrJob(job.id, alephJob.jobId, "ocr");
  if (attached) await updateAlephSnapshot(repository, attached.id, alephJob);
  return (await repository.getImportJob(job.id)) ?? attached;
}

export async function finalizeAlephOcrJob(env: Env, repository: D1LedgerRepository, importJobId: string) {
  const job = await repository.getImportJob(importJobId);
  if (!job) throw new Error("导入任务不存在");
  if (!job.ocrJobId) throw new Error("导入任务未关联 Aleph 任务");
  if (terminalImportStatuses.has(job.status)) return repository.listImportedRecords(job.id);

  const existing = await repository.listImportedRecords(job.id);
  if (existing.length) {
    if (job.status !== "completed" && job.status !== "pending_confirmation") {
      await repository.updateImportJob(job.id, job.autoConfirm ? "completed" : "pending_confirmation");
    }
    if (isImageImportFileType(job.fileType)) await repository.recordImageOcrUsage(job.id, job.userId, shanghaiUsageDate());
    return existing;
  }

  const snapshot = await runtimeOcrClient(env).getJob(job.ocrJobId);
  if (!snapshot.resultAvailable) {
    throw new AlephToolsError({
      code: "JOB_NOT_READY",
      message: "Job result is not ready",
      jobId: job.ocrJobId,
      jobStatus: snapshot.status,
      stage: snapshot.stage ?? "ocr",
      retryable: true,
      terminal: false,
    });
  }
  const result = await runtimeOcrClient(env).getResult(job.ocrJobId);
  const rawText = result.plainText?.trim() || result.markdown?.trim();
  if (!rawText) {
    await repository.markImportJobFailed(job.id, {
      message: "Aleph Tools 未返回可识别文本",
      code: "EMPTY_OCR_RESULT",
      stage: "ocr",
      retryable: false,
      terminal: true,
      externalJobId: job.ocrJobId,
    });
    throw new Error("Aleph Tools 未返回可识别文本");
  }
  await repository.updateOcrProgress(job.id, {
    progress: 100,
    stage: "ready",
    completedAt: new Date().toISOString(),
  });
  const confidence = ocrConfidence(result);
  return finalizeImportJob(env, repository, job, {
    rawText,
    warnings: confidence < 0.8 ? ["OCR 置信度较低"] : [],
  });
}

export async function failAlephOcrJob(
  repository: D1LedgerRepository,
  importJobId: string,
  error: string | AlephErrorPayload = "Aleph 处理失败",
  sequence?: number,
  phase: AlephPhase = "ocr",
) {
  await repository.updateOcrProgress(importJobId, {
    stage: "failed",
    progress: 0,
    eventSequence: sequence,
  });
  const payload = normalizeAlephError(error, phase);
  return repository.markImportJobFailed(importJobId, {
    message: payload.message,
    code: payload.code,
    stage: payload.stage ?? phase,
    requestId: payload.requestId,
    retryable: payload.retryable,
    terminal: payload.terminal,
    externalJobId: payload.jobId,
  });
}

export async function cancelImportJob(env: Env, repository: D1LedgerRepository, job: ImportJob) {
  if (job.status === "completed" || job.status === "pending_confirmation") {
    throw new Error("该导入任务已经生成记录，不能取消");
  }
  if (job.status === "cancelled") return job;
  if (job.ocrJobId && job.status === "ocr_processing") await runtimeOcrClient(env).cancelJob(job.ocrJobId);
  await env.FILES?.delete(job.r2Key).catch(() => undefined);
  return repository.updateImportJob(job.id, "cancelled");
}

export async function cancelAlephOcrJob(repository: D1LedgerRepository, importJobId: string, sequence?: number) {
  await repository.updateOcrProgress(importJobId, {
    progress: 100,
    stage: "cancelled",
    eventSequence: sequence,
  });
  return repository.updateImportJob(importJobId, "cancelled");
}

export async function updateOcrSnapshot(
  repository: D1LedgerRepository,
  importJobId: string,
  alephJob: Partial<AlephOcrJob>,
  sequence?: number,
) {
  return updateAlephSnapshot(repository, importJobId, alephJob, sequence);
}

export async function updateAlephSnapshot(
  repository: D1LedgerRepository,
  importJobId: string,
  alephJob: Partial<AlephOcrJob>,
  sequence?: number,
) {
  return repository.updateOcrProgress(importJobId, {
    progress: typeof alephJob.progress === "number" ? alephJob.progress : undefined,
    stage: alephJob.stage ?? alephJob.status,
    currentPage: alephJob.currentPage,
    totalPages: alephJob.totalPages,
    completedAt: alephJob.completedAt,
    eventSequence: sequence,
  }).then(async () =>
    repository.updateAlephState(importJobId, {
      progress: typeof alephJob.progress === "number" ? alephJob.progress : undefined,
      stage: alephJob.stage ?? alephJob.status,
      currentPage: alephJob.currentPage,
      totalPages: alephJob.totalPages,
      completedAt: alephJob.completedAt,
      eventSequence: sequence,
      cancelable: alephJob.cancelable,
      retryable: alephJob.retryable,
    }),
  );
}

export async function retryImportJob(env: Env, repository: D1LedgerRepository, job: ImportJob, requestOrigin?: string) {
  if (job.status !== "failed" || !job.errorRetryable) throw new Error("该导入任务当前不可重试");
  if (job.errorStage === "ai") {
    const prepared = await repository.prepareImportJobAiRetry(job.id);
    if (!prepared?.ocrJobId) throw new Error("导入任务缺少 OCR 结果，不能重试 AI");
    await finalizeAlephOcrJob(env, repository, prepared.id);
    return (await repository.getImportJob(prepared.id)) ?? prepared;
  }
  const prepared = await repository.prepareImportJobRetry(job.id);
  if (!prepared) throw new Error("导入任务不存在");
  return submitAlephOcrJob(env, repository, prepared, undefined, requestOrigin);
}

export async function markFailed(
  repository: D1LedgerRepository,
  importJobId: string,
  error: unknown,
  stage: FailureStage,
) {
  if (error instanceof AlephToolsError) {
    return repository.markImportJobFailed(importJobId, {
      message: error.message,
      code: error.code,
      stage: error.stage ?? stage,
      requestId: error.requestId,
      retryable: error.retryable,
      terminal: error.terminal,
      externalJobId: error.jobId,
    });
  }
  const alephError = error instanceof AlephAIError ? error : undefined;
  return repository.markImportJobFailed(importJobId, {
    message: error instanceof Error ? error.message : "导入处理失败",
    code: alephError?.code ?? (stage === "ai" ? "AI_PROCESSING_FAILED" : "INTERNAL_ERROR"),
    stage,
    requestId: alephError?.requestId,
    retryable: stage === "ai" && alephError?.code !== "quota_exceeded",
    terminal: stage !== "ai" || alephError?.code === "quota_exceeded",
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
  if (terminalImportStatuses.has(latest.status)) return repository.listImportedRecords(job.id);
  const existing = await repository.listImportedRecords(job.id);
  if (existing.length) {
    if (latest.status !== "completed" && latest.status !== "pending_confirmation") {
      await repository.updateImportJob(job.id, latest.autoConfirm ? "completed" : "pending_confirmation");
    }
    if (isImageImportFileType(latest.fileType)) await repository.recordImageOcrUsage(job.id, latest.userId, shanghaiUsageDate());
    return existing;
  }
  await repository.updateImportJob(job.id, "ai_processing");
  let suggestions;
  try {
    suggestions = await structureForConfirmation({
      bookId: latest.bookId,
      userId: latest.userId,
      normalized,
      ai: runtimeAiProvider(env, { id: latest.userId, plan: await repository.getUserPlan(latest.userId) }),
    });
  } catch (error) {
    await markFailed(repository, job.id, error, "ai");
    throw error;
  }
  const beforeCreate = await repository.getImportJob(job.id);
  if (!beforeCreate || terminalImportStatuses.has(beforeCreate.status)) return repository.listImportedRecords(job.id);
  const records = await repository.createImportedRecords(job.id, suggestions);
  if (records.length && isImageImportFileType(latest.fileType)) {
    await repository.recordImageOcrUsage(job.id, latest.userId, shanghaiUsageDate());
  }
  if (latest.autoConfirm && records.length) {
    await confirmImportedRecords(repository, latest, records);
    await repository.updateImportJob(job.id, "completed");
    return records;
  }
  await repository.updateImportJob(job.id, records.length ? "pending_confirmation" : "completed");
  return records;
}

async function confirmImportedRecords(repository: D1LedgerRepository, job: ImportJob, records: ImportedRecord[]) {
  for (const record of records) {
    const suggested = record.suggestedTransaction as {
      type: "expense" | "income";
      amount: number;
      categoryName?: string;
      note?: string;
      occurredAt: string;
    };
    const [category, member] = await Promise.all([
      repository.findCategoryByName(job.userId, suggested.categoryName, suggested.type),
      repository.findMember(job.bookId, job.userId),
    ]);
    await repository.createTransaction(job.bookId, job.userId, {
      type: suggested.type,
      amount: suggested.amount,
      categoryId: category?.id,
      memberId: member?.id,
      note: suggested.note,
      occurredAt: suggested.occurredAt,
      items: [],
    });
    await repository.updateImportedRecord(record.id, record.suggestedTransaction, "confirmed");
  }
}

async function readStoredFile(env: Env, repository: D1LedgerRepository, job: ImportJob) {
  const object = await env.FILES?.get(job.r2Key);
  if (!object) {
    await repository.markImportJobFailed(job.id, {
      message: "导入原文件不存在",
      code: "SOURCE_NOT_FOUND",
      stage: "ocr",
      retryable: false,
      terminal: true,
    });
    throw new Error("导入原文件不存在");
  }
  return object.arrayBuffer();
}

function normalizeAlephError(error: string | AlephErrorPayload, stage: AlephPhase): AlephErrorPayload {
  if (typeof error !== "string") return error;
  return {
    code: "JOB_FAILED",
    message: error,
    stage,
    retryable: false,
    terminal: true,
  };
}

function apiPublicOrigin(env: Env, requestOrigin?: string) {
  const origin = env.API_PUBLIC_ORIGIN ?? requestOrigin;
  if (!origin) throw new Error("API_PUBLIC_ORIGIN 未配置，无法创建 OCR webhook 回调");
  return origin.replace(/\/+$/, "");
}

function shanghaiUsageDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
