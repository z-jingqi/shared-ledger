import { supportedFileTypes } from "@shared-ledger/import";
import { aiImportRecordSchema, supportedFileExtensions } from "@shared-ledger/shared";
import type { Context, Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import {
  cancelAlephOcrJob,
  cancelImportJob,
  failAlephOcrJob,
  finalizeAlephConvertJob,
  finalizeAlephOcrJob,
  isOcrImportFileType,
  markFailed,
  requiresImageConversion,
  retryImportJob,
  submitAlephConvertJob,
  submitAlephOcrJob,
  updateAlephSnapshot,
} from "../services/imports";
import type { ImportQueueMessage } from "../services/imports";
import type { AlephErrorPayload, AlephOcrJob } from "../services/ocr";
import type { ImportJob, MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const maximumFileBytes = 20 * 1024 * 1024;
const maximumBatchFiles = 5;
const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);
const isSupportedFile = (type: string): type is (typeof supportedFileTypes)[number] =>
  (supportedFileTypes as readonly string[]).includes(type);
const hasSupportedExtension = (name: string) =>
  supportedFileExtensions.some((extension) => name.toLowerCase().endsWith(extension));
const fileType = (file: File) => {
  if (isSupportedFile(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  return file.type;
};
type ImportRouteContext = Context<{ Bindings: Env }>;

export function registerImportRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  const createJob = async (
    context: ImportRouteContext,
    input: { bookId: string; userId: string; file: File; repository: D1LedgerRepository; autoConfirm?: boolean },
  ) => {
    const files = context.env.FILES;
    const queue = context.env.IMPORT_QUEUE;
    if (!files) throw new Error("导入功能需要 R2 绑定");
    const resolvedFileType = fileType(input.file);
    const needsOcr = isOcrImportFileType(resolvedFileType);
    if (!needsOcr && !queue) throw new Error("CSV/Excel 导入功能需要 Queue 绑定");
    const suffix = input.file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
    const job = await input.repository.createImportJob({
      bookId: input.bookId,
      userId: input.userId,
      fileName: input.file.name,
      fileType: resolvedFileType,
      r2Key: `imports/${input.bookId}/${crypto.randomUUID()}-${suffix}`,
      autoConfirm: input.autoConfirm,
    });
    try {
      const bytes = await input.file.arrayBuffer();
      await files.put(job.r2Key, bytes, {
        httpMetadata: { contentType: resolvedFileType },
        customMetadata: { importJobId: job.id, bookId: input.bookId, uploadedBy: input.userId },
      });
      if (needsOcr) {
        if (requiresImageConversion(resolvedFileType)) {
          return await submitAlephConvertJob(
            context.env,
            input.repository,
            job,
            bytes,
            new URL(context.req.url).origin,
          );
        }
        return await submitAlephOcrJob(
          context.env,
          input.repository,
          job,
          bytes,
          new URL(context.req.url).origin,
        );
      }
      await queue?.send({ jobId: job.id } satisfies ImportQueueMessage);
      return (await input.repository.getImportJob(job.id)) ?? job;
    } catch (error) {
      if (needsOcr) {
        await markFailed(input.repository, job.id, error, requiresImageConversion(resolvedFileType) ? "convert" : "ocr");
      } else {
        await files.delete(job.r2Key);
        await input.repository.updateImportJob(job.id, "failed", error instanceof Error ? error.message : "上传失败");
      }
      throw error;
    }
  };

  const validateFile = (file: FormDataEntryValue): file is File =>
    file instanceof File &&
    Boolean(file.name) &&
    (isSupportedFile(file.type) || hasSupportedExtension(file.name)) &&
    file.size > 0 &&
    file.size <= maximumFileBytes;

  app.post("/books/:bookId/imports", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    if (!context.env.DB || !context.env.FILES) return jsonError(context, "导入功能需要 D1 与 R2 绑定", 503);
    const form = await context.req.formData();
    const file = form.get("file");
    const autoConfirm = form.get("autoConfirm") === "true";
    if (!(file instanceof File) || !file.name || (!isSupportedFile(file.type) && !hasSupportedExtension(file.name)))
      return jsonError(context, "请选择 CSV、Excel、PDF 或支持的图片文件");
    if (file.size <= 0 || file.size > maximumFileBytes)
      return jsonError(context, "文件大小必须在 1 B 到 20 MB 之间");
    const repository = new D1LedgerRepository(context.env.DB);
    try {
      const job = await createJob(context, { bookId, userId: user.id, file, repository, autoConfirm });
      return context.json({ job }, 202);
    } catch {
      return jsonError(context, "文件上传或任务提交失败", 502);
    }
  });

  app.post("/books/:bookId/imports/batch", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    if (!context.env.DB || !context.env.FILES) return jsonError(context, "导入功能需要 D1 与 R2 绑定", 503);

    const form = await context.req.formData();
    const autoConfirm = form.get("autoConfirm") === "true";
    const entries = [...form.getAll("files"), ...form.getAll("file")];
    const files = entries.filter((entry): entry is File => entry instanceof File && Boolean(entry.name));
    if (!files.length) return jsonError(context, "请选择要导入的文件");
    if (files.length > maximumBatchFiles) return jsonError(context, `一次最多上传 ${maximumBatchFiles} 个文件`);
    const invalid = files.find((file) => !validateFile(file));
    if (invalid) return jsonError(context, "文件必须是 CSV、Excel、PDF 或支持的图片，且大小在 1 B 到 20 MB 之间");

    const repository = new D1LedgerRepository(context.env.DB);
    try {
      const jobs = [];
      for (const file of files) {
        jobs.push(await createJob(context, { bookId, userId: user.id, file, repository, autoConfirm }));
      }
      return context.json({ jobs }, 202);
    } catch {
      return jsonError(context, "文件上传或任务提交失败", 502);
    }
  });

  app.get("/books/:bookId/imports", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    return context.json({ imports: await new D1LedgerRepository(context.env.DB).listImportJobs(bookId) });
  });

  app.post("/imports/aleph-webhook", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const secret = context.env.ALEPH_OCR_WEBHOOK_SECRET;
    if (!secret) return jsonError(context, "ALEPH_OCR_WEBHOOK_SECRET 未配置", 503);

    const rawBody = await context.req.text();
    const timestamp = context.req.header("X-Aleph-Tools-Timestamp") ?? context.req.header("X-Aleph-OCR-Timestamp");
    const signature = context.req.header("X-Aleph-Tools-Signature") ?? context.req.header("X-Aleph-OCR-Signature");
    if (!(await verifyAlephWebhookSignature(secret, timestamp, signature, rawBody))) {
      return jsonError(context, "Aleph-OCR webhook 签名无效", 401);
    }

    const payload = safeJson(rawBody) as AlephWebhookPayload | null;
    const importJobId = payload?.metadata?.importJobId;
    if (!payload?.jobId || !importJobId) return jsonError(context, "Aleph-OCR webhook metadata 缺失", 400);

    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(importJobId);
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const phase = resolveAlephPhase(job, payload);
    if (!phase) return jsonError(context, "Aleph Tools jobId 与导入任务不匹配", 400);

    const sequence = sequenceFromEventId(payload.eventId);
    if (payload.job) await updateAlephSnapshot(repository, job.id, phase, payload.job, sequence);
    if (payload.event?.endsWith(".cancelled") || payload.job?.status === "cancelled") {
      await cancelAlephOcrJob(repository, job.id, sequence);
      return context.json({ ok: true });
    }
    if (payload.event?.endsWith(".failed") || payload.job?.status === "failed") {
      await failAlephOcrJob(repository, job.id, payload.error ?? payload.job?.error ?? "Aleph Tools 处理失败", sequence, phase);
      return context.json({ ok: true });
    }
    if (!payload.event?.endsWith(".ready") && payload.job?.status !== "ready") {
      return context.json({ ok: true });
    }

    const finalize = (phase === "convert"
      ? finalizeAlephConvertJob(context.env, repository, job.id)
      : finalizeAlephOcrJob(context.env, repository, job.id)
    ).catch(async (error) => {
      await repository.markImportJobFailed(job.id, {
        message: error instanceof Error ? error.message : "导入处理失败",
        code: "INTERNAL_ERROR",
        stage: phase,
        retryable: true,
        terminal: false,
      });
    });
    context.executionCtx?.waitUntil(finalize);
    if (!context.executionCtx) await finalize;
    return context.json({ ok: true });
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
    const jobs = await Promise.all(ids.map((id) => repository.getImportJob(id)));
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
            const activeAlephJobs = jobs.filter((job): job is ImportJob => {
              if (!job) return false;
              return (
                ((Boolean(job.convertJobId) && job.status === "converting") ||
                  (Boolean(job.ocrJobId) && job.status === "ocr_processing")) &&
                !terminalImportStatuses.has(job.status)
              );
            });
            if (!activeAlephJobs.length) {
              close();
              return;
            }
            await Promise.all(
              activeAlephJobs.map((job) =>
                proxyAlephEvents(context.env, repository, job, async (nextJob) => {
                  if (stopped) return;
                  sendJob(nextJob);
                }),
              ),
            );
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

  app.get("/imports/:id", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    return denied ?? context.json({ job });
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
    try {
      await cancelImportJob(context.env, repository, job);
      return context.json({ ok: true });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "取消导入失败", 502);
    }
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
    if (job.status !== "failed" || !job.errorRetryable) return jsonError(context, "该导入任务当前不可重试", 409);
    try {
      const result = await retryImportJob(context.env, repository, job, new URL(context.req.url).origin);
      const nextJob = Array.isArray(result) ? await repository.getImportJob(job.id) : result;
      return context.json({ job: nextJob ?? (await repository.getImportJob(job.id)) });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "重试导入失败", 502);
    }
  });

  app.get("/imports/:id/records", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    return denied ?? context.json({ records: await repository.listImportedRecords(job.id) });
  });

  app.patch("/imported-records/:id", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(context.req.param("id"));
    if (!record) return jsonError(context, "待确认记录不存在", 404);
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    if (denied) return denied;
    const candidate = aiImportRecordSchema.safeParse({
      ...record.suggestedTransaction,
      ...(await context.req.json()),
    });
    if (!candidate.success) return jsonError(context, "待确认记录数据不合法");
    return context.json({ record: await repository.updateImportedRecord(record.id, candidate.data) });
  });

  const confirm = async (context: any, recordId: string) => {
    if (!context.env.DB) return { error: "D1 运行时不可用", status: 503 };
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(recordId);
    if (!record || record.status !== "pending") return { error: "记录不可确认", status: 400 };
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return { error: "导入任务不存在", status: 404 };
    const denied = await requireMember(context, store, job.bookId);
    if (denied) return { response: denied };
    const suggested = aiImportRecordSchema.parse(record.suggestedTransaction);
    const [category, member] = await Promise.all([
      repository.findCategoryByName(job.bookId, suggested.categoryName),
      repository.findMember(job.bookId, job.userId),
    ]);
    const transaction = await repository.createTransaction(job.bookId, job.userId, {
      type: suggested.type,
      amount: suggested.amount,
      categoryId: category?.id,
      memberId: member?.id,
      note: suggested.note,
      occurredAt: suggested.occurredAt,
      tagIds: [],
      items: [],
    } as any);
    const updated = await repository.updateImportedRecord(
      record.id,
      record.suggestedTransaction,
      "confirmed",
    );
    return { record: updated, transaction };
  };

  app.post("/imported-records/:id/confirm", async (context) => {
    const result = await confirm(context, context.req.param("id"));
    if ("response" in result) return result.response;
    return "error" in result
      ? jsonError(context, result.error ?? "记录不可确认", result.status ?? 400)
      : context.json(result);
  });

  app.post("/imported-records/:id/ignore", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const record = await repository.getImportedRecord(context.req.param("id"));
    if (!record || record.status !== "pending") return jsonError(context, "记录不可忽略", 400);
    const job = await repository.getImportJob(record.importJobId);
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    if (denied) return denied;
    const updated = await repository.updateImportedRecord(record.id, record.suggestedTransaction, "ignored");
    return context.json({ record: updated });
  });

  app.post("/imports/:id/confirm-all", async (context) => {
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const repository = new D1LedgerRepository(context.env.DB);
    const job = await repository.getImportJob(context.req.param("id"));
    if (!job) return jsonError(context, "导入任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId);
    if (denied) return denied;
    const records = await repository.listImportedRecords(job.id);
    let confirmed = 0;
    for (const record of records.filter((item) => item.status === "pending")) {
      const result = await confirm(context, record.id);
      if (!("error" in result) && !("response" in result)) confirmed += 1;
    }
    const stillPending = (await repository.listImportedRecords(job.id)).some(
      (record) => record.status === "pending",
    );
    if (!stillPending) await repository.updateImportJob(job.id, "completed");
    return context.json({ confirmed });
  });
}

type AlephWebhookPayload = {
  event?: string;
  eventId?: string;
  jobId?: string;
  job?: Partial<AlephOcrJob>;
  resultUrl?: string;
  outputUrl?: string;
  error?: string | AlephErrorPayload;
  metadata?: { importJobId?: string; phase?: "convert" | "ocr" };
  createdAt?: string;
};

type AlephSseMessage = {
  id?: string;
  event?: string;
  data?: string;
};

function resolveAlephPhase(job: ImportJob, payload: AlephWebhookPayload): "convert" | "ocr" | undefined {
  if (payload.metadata?.phase === "convert" && job.convertJobId === payload.jobId) return "convert";
  if (payload.metadata?.phase === "ocr" && job.ocrJobId === payload.jobId) return "ocr";
  if (job.convertJobId === payload.jobId) return "convert";
  if (job.ocrJobId === payload.jobId) return "ocr";
  return undefined;
}

export async function verifyAlephWebhookSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
) {
  if (!timestamp || !signature) return false;
  const numericTimestamp = Number(timestamp);
  const createdAt = Number.isFinite(numericTimestamp) ? numericTimestamp : Date.parse(timestamp);
  if (!Number.isFinite(createdAt) || Math.abs(Date.now() - createdAt) > 5 * 60_000) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  const provided = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : "";
  return timingSafeEqualHex(expected, provided);
}

async function proxyAlephEvents(
  env: Env,
  repository: D1LedgerRepository,
  job: ImportJob,
  onJob: (job: ImportJob) => Promise<void> | void,
) {
  const phase: "convert" | "ocr" = job.status === "converting" ? "convert" : "ocr";
  const externalJobId = phase === "convert" ? job.convertJobId : job.ocrJobId;
  if (!externalJobId) return;
  if (!env.ALEPH_OCR_BASE_URL) throw new Error("ALEPH_OCR_BASE_URL 未配置，无法订阅 OCR 进度");
  if (!env.ALEPH_OCR_API_KEY) throw new Error("ALEPH_OCR_API_KEY 未配置，无法订阅 OCR 进度");

  const url = `${env.ALEPH_OCR_BASE_URL.replace(/\/+$/, "")}/v1/jobs/${encodeURIComponent(externalJobId)}/events`;
  const headers: Record<string, string> = {
    accept: "text/event-stream",
    authorization: `Bearer ${env.ALEPH_OCR_API_KEY}`,
  };
  const lastEventId = phase === "convert" ? job.convertEventSequence : job.ocrEventSequence;
  if (lastEventId && lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) throw new Error(`Aleph-OCR 进度订阅失败 (${response.status})`);

  for await (const message of parseSseStream(response.body)) {
    if (message.event === "ping" || !message.data) continue;
    const payload = safeJson(message.data) as (Partial<AlephOcrJob> & { job?: Partial<AlephOcrJob> }) | null;
    if (!payload) continue;
    const alephJob = payload.job ?? payload;
    const sequence = sequenceFromEventId(message.id);
    const isCancelled =
      message.event === "job.cancel_requested" ||
      message.event === "job.cancelled" ||
      alephJob.status === "cancel_requested" ||
      alephJob.status === "cancelled";
    const isFailed = message.event === "job.failed" || alephJob.status === "failed";
    const isReady = message.event === "job.ready" || alephJob.status === "ready";

    if (alephJob) {
      const updated = await updateAlephSnapshot(repository, job.id, phase, alephJob, sequence);
      if (updated) await onJob(updated);
    }
    if (isCancelled) {
      const cancelled = await cancelAlephOcrJob(repository, job.id, sequence);
      if (cancelled) await onJob(cancelled);
      return;
    }
    if (isFailed) {
      const failed = await failAlephOcrJob(
        repository,
        job.id,
        alephJob.error ?? "Aleph Tools 处理失败",
        sequence,
        phase,
      );
      if (failed) await onJob(failed);
      return;
    }
    if (isReady) {
      const current = await repository.getImportJob(job.id);
      if (current && terminalImportStatuses.has(current.status)) {
        await onJob(current);
        return;
      }
      if (phase === "ocr") {
        const processing = await repository.updateImportJob(job.id, "ai_processing");
        if (processing) await onJob(processing);
      }
      try {
        if (phase === "convert") {
          await finalizeAlephConvertJob(env, repository, job.id);
          const next = await repository.getImportJob(job.id);
          if (next) {
            await onJob(next);
            if (next.ocrJobId && next.status === "ocr_processing") {
              await proxyAlephEvents(env, repository, next, onJob);
            }
          }
        } else {
          await finalizeAlephOcrJob(env, repository, job.id);
        }
      } catch (error) {
        await repository.markImportJobFailed(job.id, {
          message: error instanceof Error ? error.message : "导入处理失败",
          code: "INTERNAL_ERROR",
          stage: phase,
          retryable: true,
          terminal: false,
        });
      }
      const finished = await repository.getImportJob(job.id);
      if (finished) await onJob(finished);
      return;
    }
  }
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AlephSseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseMessage(raw);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseMessage(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

function parseSseMessage(raw: string): AlephSseMessage | null {
  if (!raw.trim()) return null;
  const data: string[] = [];
  const message: AlephSseMessage = {};
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, "") : "";
    if (field === "id") message.id = value;
    if (field === "event") message.event = value;
    if (field === "data") data.push(value);
  }
  if (data.length) message.data = data.join("\n");
  return message;
}

function importJobStatusPayload(job: ImportJob) {
  return {
    id: job.id,
    fileName: job.fileName,
    status: job.status,
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorRequestId ? { errorRequestId: job.errorRequestId } : {}),
    ...(job.errorStage ? { errorStage: job.errorStage } : {}),
    retryable: Boolean(job.errorRetryable || job.retryable),
    cancelable: Boolean(job.cancelable),
    ...(typeof job.ocrProgress === "number" ? { progress: job.ocrProgress } : {}),
    ...(job.ocrStage ? { stage: job.ocrStage } : {}),
    ...(typeof job.ocrCurrentPage === "number" ? { currentPage: job.ocrCurrentPage } : {}),
    ...(typeof job.ocrTotalPages === "number" ? { totalPages: job.ocrTotalPages } : {}),
  };
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sequenceFromEventId(eventId: string | undefined) {
  if (!eventId) return undefined;
  const value = Number(eventId);
  return Number.isFinite(value) ? value : undefined;
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
