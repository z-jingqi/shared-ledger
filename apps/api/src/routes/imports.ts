import { aiImportRecordSchema } from "@shared-ledger/shared";
import { supportedFileTypes } from "@shared-ledger/import";
import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import type { ImportQueueMessage } from "../services/imports";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const maximumFileBytes = 20 * 1024 * 1024;
const isSupportedFile = (type: string): type is (typeof supportedFileTypes)[number] =>
  (supportedFileTypes as readonly string[]).includes(type);

export function registerImportRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
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
    if (!(file instanceof File) || !file.name || !isSupportedFile(file.type))
      return jsonError(context, "请选择 CSV、Excel、PDF 或支持的图片文件");
    if (file.size <= 0 || file.size > maximumFileBytes)
      return jsonError(context, "文件大小必须在 1 B 到 20 MB 之间");
    const repository = new D1LedgerRepository(context.env.DB);
    const suffix = file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
    const job = await repository.createImportJob({
      bookId,
      userId: user.id,
      fileName: file.name,
      fileType: file.type,
      r2Key: `imports/${bookId}/${crypto.randomUUID()}-${suffix}`,
    });
    try {
      await context.env.FILES.put(job.r2Key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { importJobId: job.id, bookId, uploadedBy: user.id },
      });
      await context.env.IMPORT_QUEUE.send({ jobId: job.id } satisfies ImportQueueMessage);
      return context.json({ job }, 202);
    } catch (error) {
      await context.env.FILES.delete(job.r2Key);
      await repository.updateImportJob(job.id, "failed", error instanceof Error ? error.message : "上传失败");
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
