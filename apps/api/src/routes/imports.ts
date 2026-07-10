import { aiImportRecordSchema } from "@shared-ledger/shared";
import type { Context, Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository, importJobRetentionDays, type ImportJobStatusFilter } from "../repository";
import { requireMember, requireUser } from "../services/access";
import {
  cancelImportJob,
  deleteStoredOcrText,
  markFailed,
  retryImportJob,
  sha256Hex,
  submitOcrJob,
} from "../services/imports";
import { prepareImageForGoogleVision } from "../services/image-conversion";
import {
  assertImageImportFile,
  assertImageOcrQuota,
  imageImportFileType,
  imageOcrLimitForPlan,
  ImportUploadError,
  maximumImageImportBatchFiles,
  maximumImageImportRequestBytes,
  reserveImageOcrQuota,
  shanghaiDateRange,
  shanghaiUsageDate,
} from "../services/import-validation";
import { GoogleVisionOcrError } from "../services/ocr";
import type { ImportJob, MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);
const streamInactiveImportStatuses = new Set([...terminalImportStatuses, "duplicate_review"]);
const deletableImportStatuses = new Set([
  "completed",
  "pending_confirmation",
  "duplicate_review",
  "failed",
  "cancelled",
]);
type ImportRouteContext = Context<{ Bindings: Env }>;
type UploadFileMetadata = {
  originalName?: string;
  originalType?: string;
  converted?: boolean;
};
type PreparedImportUpload = {
  index?: number;
  displayFileName: string;
  displayFileType: string;
  fileHash: string;
  ocrInput: Awaited<ReturnType<typeof prepareImageForGoogleVision>>;
  duplicateJob: ImportJob | null;
  autoConfirm?: boolean;
};

export function registerImportRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  const prepareImportUpload = async (
    context: ImportRouteContext,
    input: {
      bookId: string;
      userId: string;
      file: File;
      metadata?: UploadFileMetadata;
      repository: D1LedgerRepository;
      index?: number;
      autoConfirm?: boolean;
    },
  ): Promise<PreparedImportUpload> => {
    assertImageImportFile(input.file);
    const uploadFileType = imageImportFileType(input.file);
    const bytes = await input.file.arrayBuffer();
    const ocrInput = await prepareImageForGoogleVision({ fileType: uploadFileType }, bytes);
    const displayFileName = input.metadata?.originalName?.trim() || input.file.name;
    const displayFileType = input.metadata?.originalType?.trim().toLowerCase() || uploadFileType;
    const fileHash = await sha256Hex(ocrInput.bytes);
    const duplicateJob = await input.repository.findDuplicateImportByFileHash({
      bookId: input.bookId,
      fileHash,
    });
    return {
      ...(typeof input.index === "number" ? { index: input.index } : {}),
      displayFileName,
      displayFileType,
      fileHash,
      ocrInput,
      duplicateJob,
      autoConfirm: input.autoConfirm,
    };
  };

  const createPreparedJob = async (
    context: ImportRouteContext,
    input: {
      bookId: string;
      userId: string;
      prepared: PreparedImportUpload;
      repository: D1LedgerRepository;
      autoConfirm?: boolean;
    },
  ) => {
    const files = context.env.FILES;
    if (!files) throw new Error("导入功能需要 R2 绑定");
    const suffix = input.prepared.displayFileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
    const job = await input.repository.createImportJob({
      bookId: input.bookId,
      userId: input.userId,
      fileName: input.prepared.displayFileName,
      fileType: input.prepared.displayFileType,
      r2Key: `imports/${input.bookId}/${crypto.randomUUID()}-${suffix}`,
      fileHash: input.prepared.fileHash,
      duplicateOfImportJobId: input.prepared.duplicateJob?.id,
      autoConfirm: input.autoConfirm ?? input.prepared.autoConfirm,
    });
    let quotaReserved = false;
    if (!input.prepared.duplicateJob) {
      try {
        await reserveImageOcrQuota(input.repository, input.userId, job.id);
        quotaReserved = true;
      } catch (error) {
        await input.repository.hardDeleteImportJob(job.id);
        throw error;
      }
    }
    try {
      await files.put(job.r2Key, input.prepared.ocrInput.bytes, {
        httpMetadata: { contentType: input.prepared.ocrInput.fileType },
        customMetadata: { importJobId: job.id, bookId: input.bookId, uploadedBy: input.userId },
      });
      await input.repository.setImportJobOcrInput(job.id, {
        r2Key: job.r2Key,
        fileType: input.prepared.ocrInput.fileType,
        converted: input.prepared.displayFileType !== input.prepared.ocrInput.fileType,
      });
      if (input.prepared.duplicateJob) {
        const reviewJob = await input.repository.markImportJobDuplicateReview(
          job.id,
          input.prepared.duplicateJob.id,
        );
        if (!reviewJob) throw new Error("重复任务创建失败");
        return reviewJob;
      }
      const submitted = await submitOcrJob(context.env, input.repository, job);
      if (!submitted) throw new Error("导入任务创建失败");
      return submitted;
    } catch (error) {
      if (quotaReserved) await input.repository.releaseImageOcrUsage(job.id);
      await markFailed(input.repository, job.id, error, "ocr");
      throw error;
    }
  };

  const createJob = async (
    context: ImportRouteContext,
    input: {
      bookId: string;
      userId: string;
      file: File;
      metadata?: UploadFileMetadata;
      repository: D1LedgerRepository;
      autoConfirm?: boolean;
    },
  ) => {
    const prepared = await prepareImportUpload(context, input);
    return createPreparedJob(context, {
      bookId: input.bookId,
      userId: input.userId,
      prepared,
      repository: input.repository,
      autoConfirm: input.autoConfirm,
    });
  };

  app.get("/me/import-usage", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const date = shanghaiUsageDate();
    const [used, active] = await Promise.all([
      repository.countDailyImageOcrUsage(user.id, date),
      repository.countActiveImageOcrJobs(user.id, shanghaiDateRange(date)),
    ]);
    const limit = imageOcrLimitForPlan(user.plan);
    return context.json({
      date,
      imageOcr: {
        used,
        active,
        limit,
        remaining: Math.max(0, limit - used - active),
      },
    });
  });

  app.post("/books/:bookId/imports", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    if (!context.env.DB || !context.env.FILES) return jsonError(context, "导入功能需要 D1 与 R2 绑定", 503);
    if (requestContentLength(context) > maximumImageImportRequestBytes)
      return jsonError(context, "图片过大，请压缩后上传", 413);
    const form = await context.req.formData();
    const file = form.get("file");
    const metadata = parseSingleFileMetadata(form);
    const autoConfirm = form.get("autoConfirm") === "true";
    const repository = new D1LedgerRepository(context.env.DB);
    try {
      assertImageImportFile(file);
      const job = await createJob(context, {
        bookId,
        userId: user.id,
        file,
        metadata,
        repository,
        autoConfirm,
      });
      return context.json({ job: importJobStatusPayload(job) }, 202);
    } catch (error) {
      if (error instanceof ImportUploadError) return jsonError(context, error.message, error.status);
      if (error instanceof GoogleVisionOcrError) return jsonError(context, error.message, 400);
      return jsonError(context, error instanceof Error ? error.message : "文件上传或任务提交失败", 502);
    }
  });

  app.post("/books/:bookId/imports/batch", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    if (!context.env.DB || !context.env.FILES) return jsonError(context, "导入功能需要 D1 与 R2 绑定", 503);
    if (requestContentLength(context) > maximumImageImportRequestBytes)
      return jsonError(context, "批量图片总大小过大，请分批上传", 413);

    const form = await context.req.formData();
    const autoConfirm = form.get("autoConfirm") === "true";
    const entries = [...form.getAll("files"), ...form.getAll("file")];
    const files = entries.filter((entry): entry is File => entry instanceof File && Boolean(entry.name));
    if (!files.length) return jsonError(context, "请选择要导入的文件");
    if (files.length > maximumImageImportBatchFiles)
      return jsonError(context, `一次最多上传 ${maximumImageImportBatchFiles} 个文件`);
    if (files.reduce((total, file) => total + file.size, 0) > maximumImageImportRequestBytes)
      return jsonError(context, "批量图片总大小过大，请分批上传", 413);

    const repository = new D1LedgerRepository(context.env.DB);
    try {
      const fileMetadata = parseBatchFileMetadata(form, files.length);
      for (const file of files) assertImageImportFile(file);
      const preparedUploads: PreparedImportUpload[] = [];
      const duplicatePreparedUploads: Array<{
        prepared: PreparedImportUpload;
        duplicateOfPrepared: PreparedImportUpload;
      }> = [];
      const firstPreparedByHash = new Map<string, PreparedImportUpload>();
      for (const [index, file] of files.entries()) {
        const prepared = await prepareImportUpload(context, {
          bookId,
          userId: user.id,
          file,
          metadata: fileMetadata[index],
          repository,
          autoConfirm,
          index,
        });
        if (prepared.duplicateJob) {
          duplicatePreparedUploads.push({ prepared, duplicateOfPrepared: prepared });
        } else if (firstPreparedByHash.has(prepared.fileHash)) {
          duplicatePreparedUploads.push({
            prepared,
            duplicateOfPrepared: firstPreparedByHash.get(prepared.fileHash)!,
          });
        } else {
          firstPreparedByHash.set(prepared.fileHash, prepared);
          preparedUploads.push(prepared);
        }
      }
      if (preparedUploads.length) await assertImageOcrQuota(repository, user.id, preparedUploads.length);
      const jobs = [];
      const createdJobByPrepared = new Map<PreparedImportUpload, ImportJob>();
      for (const prepared of preparedUploads) {
        const job = await createPreparedJob(context, {
          bookId,
          userId: user.id,
          prepared,
          repository,
          autoConfirm,
        });
        createdJobByPrepared.set(prepared, job);
        jobs.push({
          index: prepared.index,
          job,
        });
      }
      for (const duplicate of duplicatePreparedUploads) {
        const duplicateJob =
          duplicate.prepared.duplicateJob ?? createdJobByPrepared.get(duplicate.duplicateOfPrepared);
        if (!duplicateJob) continue;
        const reviewJob = await createPreparedJob(context, {
          bookId,
          userId: user.id,
          prepared: { ...duplicate.prepared, duplicateJob },
          repository,
          autoConfirm,
        });
        jobs.push({ index: duplicate.prepared.index, job: reviewJob });
      }
      return context.json(
        {
          jobs: jobs.map((item) => ({
            ...importJobStatusPayload(item.job),
            ...(typeof item.index === "number" ? { index: item.index } : {}),
          })),
        },
        202,
      );
    } catch (error) {
      if (error instanceof ImportUploadError) return jsonError(context, error.message, error.status);
      if (error instanceof GoogleVisionOcrError) return jsonError(context, error.message, 400);
      return jsonError(context, error instanceof Error ? error.message : "文件上传或任务提交失败", 502);
    }
  });

  app.get("/books/:bookId/imports", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const jobs = await normalizeImportJobsForResponse(
      await repository.listImportJobs(bookId, {
        status: parseImportStatusFilter(context.req.query("status")),
      }),
    );
    return context.json({
      retentionDays: importJobRetentionDays,
      imports: jobs.filter((job): job is ImportJob => job !== null).map(importJobStatusPayload),
    });
  });

  app.get("/imports/status-stream", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const ids = [
      ...new Set(
        (context.req.query("ids") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, 20),
      ),
    ];
    if (!ids.length) return jsonError(context, "请选择要监听的导入任务");

    const repository = new D1LedgerRepository(context.env.DB);
    const jobs = await normalizeImportJobsForResponse(
      await Promise.all(ids.map((id) => repository.getImportJob(id))),
    );
    if (jobs.some((job) => !job)) return jsonError(context, "导入任务不存在", 404);
    for (const job of jobs) {
      if (!job) continue;
      const denied = await requireMember(context, store, job.bookId, user);
      if (denied) return denied;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let stopped = false;
        const sendEvent = (event: string, data: unknown) => {
          if (stopped) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const sendJob = (job: ImportJob) => sendEvent("job", importJobStatusPayload(job));
        const close = () => {
          if (stopped) return;
          stopped = true;
          controller.close();
        };
        context.req.raw.signal.addEventListener("abort", close);

        const run = async () => {
          try {
            jobs.forEach((job) => job && sendJob(job));
            const activeJobs = jobs.filter(
              (job): job is ImportJob => job !== null && !streamInactiveImportStatuses.has(job.status),
            );
            const hasActiveJobs = activeJobs.length
              ? await watchLocalImportJobs(context.env, repository, activeJobs, async (nextJob) => {
                  if (stopped) return;
                  sendJob(nextJob);
                })
              : false;
            if (hasActiveJobs && !stopped) {
              sendEvent("stream-idle", {
                reason: "local_processing",
                retryAfterMs: localImportReconnectDelayMs(context.env),
              });
            }
            close();
          } catch (error) {
            if (!stopped) {
              sendEvent("stream-error", {
                message: error instanceof Error ? error.message : "进度连接已断开，可刷新恢复",
              });
              close();
            }
          }
        };
        void run();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  });

  app.get("/imports/:id/file", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB || !context.env.FILES) return jsonError(context, "导入预览需要 D1 与 R2 绑定", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在或已过期", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (!job.fileType.startsWith("image/")) return jsonError(context, "该文件类型没有图片预览", 415);
    const object = await context.env.FILES.get(job.r2Key);
    if (!object?.body) return jsonError(context, "导入原文件不存在", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? job.fileType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(job.fileName)}"`,
      },
    });
  });

  app.get("/imports/:id", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    return denied ?? context.json({ job: importJobStatusPayload(job) });
  });

  app.post("/imports/:id/cancel", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (job.status === "completed" || job.status === "pending_confirmation") {
      return jsonError(context, "该导入任务已经生成记录，不能取消", 409);
    }
    if (job.status === "failed") return jsonError(context, "该导入任务已结束，不能取消", 409);
    try {
      const nextJob = await cancelImportJob(context.env, repository, job);
      const responseJob = nextJob ?? (await repository.getImportJob(job.id));
      return context.json({ job: responseJob ? importJobStatusPayload(responseJob) : null });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "取消导入失败", 502);
    }
  });

  app.post("/imports/:id/continue-duplicate", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (job.status !== "duplicate_review") return jsonError(context, "该任务不需要重复确认", 409);

    const claimed = await repository.claimDuplicateImportForOcr(job.id, user.id);
    if (!claimed) return jsonError(context, "任务状态已更新，请刷新后重试", 409);
    try {
      await reserveImageOcrQuota(repository, user.id, job.id);
      const submitted = await submitOcrJob(context.env, repository, job);
      return context.json({ job: importJobStatusPayload(submitted) });
    } catch (error) {
      await repository.releaseImageOcrUsage(job.id);
      await repository.restoreDuplicateImportReview(job.id, user.id);
      if (error instanceof ImportUploadError) return jsonError(context, error.message, error.status);
      return jsonError(context, error instanceof Error ? error.message : "继续识别失败", 502);
    }
  });

  app.delete("/imports/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (!deletableImportStatuses.has(job.status)) {
      return jsonError(context, "请先取消或等待任务完成后再删除", 409);
    }
    await repository.softDeleteImportedRecordsForJob(job.id, user.id);
    await repository.softDeleteImportJob(job.id, user.id);
    await Promise.all([
      context.env.FILES?.delete(job.r2Key).catch(() => undefined),
      job.ocrInputR2Key && job.ocrInputR2Key !== job.r2Key
        ? context.env.FILES?.delete(job.ocrInputR2Key).catch(() => undefined)
        : Promise.resolve(),
      deleteStoredOcrText(context.env, job),
    ]);
    return new Response(null, { status: 204 });
  });

  app.post("/imports/:id/retry", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (job.status !== "failed" || !job.errorRetryable)
      return jsonError(context, "该导入任务当前不可重试", 409);
    try {
      const result = await retryImportJob(context.env, repository, job);
      const nextJob = Array.isArray(result) ? await repository.getImportJob(job.id) : result;
      const responseJob = nextJob ?? (await repository.getImportJob(job.id));
      return context.json({ job: responseJob ? importJobStatusPayload(responseJob) : null });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "重试导入失败", 502);
    }
  });

  app.get("/imports/:id/records", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, job.bookId, user);
    return denied ?? context.json({ records: await repository.listImportedRecords(job.id) });
  });

  app.patch("/imported-records/:id", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(context.req.param("id"));
    if (!record) return jsonError(context, "待确认记录不存在", 404);
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    const book = await repository.getBook(job.bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    const candidate = aiImportRecordSchema.safeParse({
      ...record.suggestedTransaction,
      ...(await context.req.json()),
    });
    if (!candidate.success) return jsonError(context, "待确认记录数据不合法");
    const suggested = book.incomeEnabled ? candidate.data : { ...candidate.data, type: "expense" as const };
    return context.json({
      record: await repository.updateImportedRecord(record.id, suggested, undefined, user.id),
    });
  });

  const confirm = async (context: any, recordId: string, allowDuplicate = false) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return { response: user };
    if (!context.env.DB) return { error: "D1 运行时不可用", status: 503 };
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(recordId);
    if (!record || record.status !== "pending") return { error: "记录不可确认", status: 400 };
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return { error: "导入任务不存在", status: 404 };
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return { response: denied };
    if (job.duplicateOfImportJobId && !allowDuplicate) {
      return {
        error: "这张小票可能已经入账，请确认后再保存",
        status: 409,
        code: "DUPLICATE_CONFIRMATION_REQUIRED",
        details: { duplicateOfJobId: job.duplicateOfImportJobId },
      };
    }
    const book = await repository.getBook(job.bookId);
    if (!book) return { error: "账本不存在", status: 404 };
    const parsedSuggestion = aiImportRecordSchema.parse(record.suggestedTransaction);
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
    const transaction = await repository.createTransaction(job.bookId, job.userId, {
      type: suggested.type,
      amount: suggested.amount,
      categoryId: category?.id,
      memberId: member?.id,
      note: suggested.note,
      occurredAt: suggested.occurredAt,
      items,
    } as any);
    const updated = await repository.updateImportedRecord(record.id, suggested, "confirmed", user.id);
    const updatedJob = await completeImportJobIfNoPending(repository, job);
    return { record: updated, transaction, job: importJobStatusPayload(updatedJob) };
  };

  app.post("/imported-records/:id/confirm", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const allowDuplicate = Boolean((body as { allowDuplicate?: unknown }).allowDuplicate);
    const result = await confirm(context, context.req.param("id"), allowDuplicate);
    if ("response" in result) return result.response;
    if ("error" in result) {
      if (result.code === "DUPLICATE_CONFIRMATION_REQUIRED") {
        return context.json(
          {
            error: result.error ?? "记录不可确认",
            code: result.code,
            ...(result.details ? { details: result.details } : {}),
          },
          409,
        );
      }
      return jsonError(context, result.error ?? "记录不可确认", result.status ?? 400);
    }
    return context.json(result);
  });

  app.post("/imported-records/:id/ignore", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(context.req.param("id"));
    if (!record || record.status !== "pending") return jsonError(context, "记录不可忽略", 400);
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    const updated = await repository.updateImportedRecord(
      record.id,
      record.suggestedTransaction,
      "ignored",
      user.id,
    );
    const updatedJob = await completeImportJobIfNoPending(repository, job);
    return context.json({ record: updated, job: importJobStatusPayload(updatedJob) });
  });

  app.post("/imports/:id/confirm-all", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    const body = await context.req.json().catch(() => ({}));
    const allowDuplicate = Boolean((body as { allowDuplicate?: unknown }).allowDuplicate);
    if (job.duplicateOfImportJobId && !allowDuplicate) {
      return context.json(
        {
          error: "这张小票可能已经入账，请确认后再保存",
          code: "DUPLICATE_CONFIRMATION_REQUIRED",
          details: { duplicateOfJobId: job.duplicateOfImportJobId },
        },
        409,
      );
    }
    const records = await repository.listImportedRecords(job.id);
    let confirmed = 0;
    for (const record of records.filter((item) => item.status === "pending")) {
      const result = await confirm(context, record.id, allowDuplicate);
      if (!("error" in result) && !("response" in result)) confirmed += 1;
    }
    const stillPending = (await repository.listImportedRecords(job.id)).some(
      (record) => record.status === "pending",
    );
    if (!stillPending) await repository.updateImportJob(job.id, "completed");
    const updatedJob = await repository.getImportJob(job.id);
    return context.json({ confirmed, job: updatedJob ? importJobStatusPayload(updatedJob) : null });
  });
}

async function completeImportJobIfNoPending(repository: D1LedgerRepository, job: ImportJob) {
  const stillPending = (await repository.listImportedRecords(job.id)).some(
    (record) => record.status === "pending",
  );
  if (!stillPending && job.status === "pending_confirmation") {
    await repository.updateImportJob(job.id, "completed");
  }
  return (await repository.getImportJob(job.id)) ?? job;
}

async function watchLocalImportJobs(
  env: Env,
  repository: D1LedgerRepository,
  jobs: ImportJob[],
  onJob: (job: ImportJob) => Promise<void> | void,
) {
  const ids = [...new Set(jobs.map((job) => job.id))];
  const deadline = Date.now() + localImportWatchDurationMs(env);
  const lastSignatures = new Map(jobs.map((job) => [job.id, importJobWatchSignature(job)]));
  let hasActiveJobs = false;
  while (Date.now() < deadline) {
    let active = false;
    for (const id of ids) {
      const job = normalizeImportJobForResponse(await repository.getImportJob(id));
      if (!job) continue;
      const signature = importJobWatchSignature(job);
      if (lastSignatures.get(id) !== signature) {
        lastSignatures.set(id, signature);
        await onJob(job);
      }
      if (!streamInactiveImportStatuses.has(job.status)) active = true;
    }
    hasActiveJobs = active;
    if (!active) return false;
    await sleep(env.APP_ENV === "test" ? 20 : 1200);
  }
  return hasActiveJobs;
}

function importJobWatchSignature(job: ImportJob) {
  return [
    job.status,
    job.ocrStage ?? "",
    job.ocrProgress ?? "",
    job.ocrCurrentPage ?? "",
    job.ocrTotalPages ?? "",
    job.updatedAt,
    job.errorMessage ?? "",
    job.errorCode ?? "",
  ].join(":");
}

function localImportWatchDurationMs(env: Env) {
  return env.APP_ENV === "test" ? 60 : 25_000;
}

function localImportReconnectDelayMs(env: Env) {
  return env.APP_ENV === "test" ? 40 : 10_000;
}

async function normalizeImportJobsForResponse(jobs: Array<ImportJob | null>) {
  return Promise.all(jobs.map((job) => normalizeImportJobForResponse(job)));
}

function normalizeImportJobForResponse(job: ImportJob | null) {
  return job;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function importJobStatusPayload(job: ImportJob) {
  const progressText = importProgressText(job);
  return {
    id: job.id,
    bookId: job.bookId,
    fileName: job.fileName,
    fileType: job.fileType,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorRequestId ? { errorRequestId: job.errorRequestId } : {}),
    ...(job.errorStage ? { errorStage: job.errorStage } : {}),
    retryable: Boolean(job.errorRetryable || job.retryable),
    cancelable: isImportJobCancelable(job),
    ...(progressText ? { progressText } : {}),
    ...(typeof job.ocrProgress === "number" ? { progress: job.ocrProgress } : {}),
    ...(job.ocrStage ? { stage: job.ocrStage } : {}),
    ...(typeof job.ocrCurrentPage === "number" ? { currentPage: job.ocrCurrentPage } : {}),
    ...(typeof job.ocrTotalPages === "number" ? { totalPages: job.ocrTotalPages } : {}),
    ...(job.duplicateOfImportJobId ? { duplicateOfJobId: job.duplicateOfImportJobId } : {}),
  };
}

function requestContentLength(context: ImportRouteContext) {
  const value = Number(context.req.header("content-length") ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function importProgressText(job: ImportJob) {
  if (job.status === "converting") {
    switch (job.ocrStage) {
      case "conversion_reading":
        return "读取原图";
      case "conversion_processing":
        return "转换图片格式";
      case "conversion_converted":
        return "图片已转为可识别格式";
      case "conversion_skipped":
        return "图片格式可直接识别";
      default:
        return "准备图片识别";
    }
  }
  if (job.status !== "ai_processing") return "";
  switch (job.ocrStage) {
    case "ai_summary":
      return "分析票据信息";
    case "ai_items":
      if (typeof job.ocrCurrentPage === "number" && typeof job.ocrTotalPages === "number") {
        return `提取明细 ${job.ocrCurrentPage}/${job.ocrTotalPages}`;
      }
      return "提取明细";
    case "ai_merging":
      return "合并识别结果";
    case "ai_text_ready":
      return "整理识别文本";
    case "ai_structuring":
      return "AI 分析明细";
    case "ai_saving":
      return "生成待确认记录";
    default:
      return "AI 分析中";
  }
}

function parseSingleFileMetadata(form: FormData) {
  const metadata = parseFileMetadataValue(form.get("fileMetadata"));
  return metadata[0];
}

function parseBatchFileMetadata(form: FormData, fileCount: number) {
  const metadata = parseFileMetadataValue(form.get("fileMetadata"));
  if (!metadata.length) return [];
  if (metadata.length !== fileCount) {
    throw new ImportUploadError("文件元数据数量不匹配", 400);
  }
  return metadata;
}

function parseFileMetadataValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ImportUploadError("文件元数据格式不正确", 400);
  }
  if (!Array.isArray(parsed)) throw new ImportUploadError("文件元数据格式不正确", 400);
  return parsed.map(normalizeUploadFileMetadata);
}

function normalizeUploadFileMetadata(value: unknown): UploadFileMetadata {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  return {
    originalName: sanitizeMetadataString(input.originalName),
    originalType: sanitizeMetadataMimeType(input.originalType),
    converted: input.converted === true,
  };
}

function sanitizeMetadataString(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : undefined;
}

function sanitizeMetadataMimeType(value: unknown) {
  const normalized = sanitizeMetadataString(value)?.toLowerCase();
  return normalized?.startsWith("image/") ? normalized : undefined;
}

function isImportJobCancelable(job: ImportJob) {
  return !terminalImportStatuses.has(job.status) && job.status !== "cancel_requested";
}

function parseImportStatusFilter(value: string | undefined): ImportJobStatusFilter {
  return value === "processing" || value === "success" || value === "failed" ? value : "all";
}
