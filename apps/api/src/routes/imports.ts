import { supportedFileTypes } from "@shared-ledger/import";
import { aiImportRecordSchema, supportedFileExtensions } from "@shared-ledger/shared";
import type { Context, Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import type { ImportQueueMessage } from "../services/imports";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const maximumFileBytes = 20 * 1024 * 1024;
const maximumBatchFiles = 5;
const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed"]);
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
    if (!files || !queue) throw new Error("导入功能需要 R2 与 Queue 绑定");
    const suffix = input.file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
    const job = await input.repository.createImportJob({
      bookId: input.bookId,
      userId: input.userId,
      fileName: input.file.name,
      fileType: fileType(input.file),
      r2Key: `imports/${input.bookId}/${crypto.randomUUID()}-${suffix}`,
      autoConfirm: input.autoConfirm,
    });
    try {
      await files.put(job.r2Key, input.file.stream(), {
        httpMetadata: { contentType: fileType(input.file) },
        customMetadata: { importJobId: job.id, bookId: input.bookId, uploadedBy: input.userId },
      });
      await queue.send({ jobId: job.id } satisfies ImportQueueMessage);
      return job;
    } catch (error) {
      await files.delete(job.r2Key);
      await input.repository.updateImportJob(job.id, "failed", error instanceof Error ? error.message : "上传失败");
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
    if (!context.env.DB || !context.env.FILES || !context.env.IMPORT_QUEUE)
      return jsonError(context, "导入功能需要 D1、R2 与 Queue 绑定", 503);
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
    if (!context.env.DB || !context.env.FILES || !context.env.IMPORT_QUEUE)
      return jsonError(context, "导入功能需要 D1、R2 与 Queue 绑定", 503);

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
        const latest = new Map<string, string>();
        let stopped = false;
        const send = (job: NonNullable<(typeof jobs)[number]>) => {
          latest.set(job.id, `${job.status}:${job.errorMessage ?? ""}`);
          controller.enqueue(
            encoder.encode(
              `event: job\ndata: ${JSON.stringify({
                id: job.id,
                fileName: job.fileName,
                status: job.status,
                ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
              })}\n\n`,
            ),
          );
        };
        const tick = async () => {
          if (stopped) return;
          try {
            const current = await Promise.all(ids.map((id) => repository.getImportJob(id)));
            for (const job of current) {
              if (!job) continue;
              const signature = `${job.status}:${job.errorMessage ?? ""}`;
              if (latest.get(job.id) !== signature) send(job);
            }
            if (current.every((job) => job && terminalImportStatuses.has(job.status))) {
              stopped = true;
              clearInterval(timer);
              controller.close();
            }
          } catch (error) {
            stopped = true;
            clearInterval(timer);
            controller.error(error);
          }
        };
        jobs.forEach((job) => job && send(job));
        if (jobs.every((job) => job && terminalImportStatuses.has(job.status))) {
          stopped = true;
          controller.close();
          return;
        }
        const timer = setInterval(() => void tick(), 2000);
        context.req.raw.signal.addEventListener("abort", () => {
          stopped = true;
          clearInterval(timer);
          controller.close();
        });
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
