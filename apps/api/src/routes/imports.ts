import { createAiProvider } from "@shared-ledger/ai";
import { MockOcrAdapter, normalizeFile, structureForConfirmation } from "@shared-ledger/import";
import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { currentUser, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerImportRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.post("/books/:bookId/imports", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    if (denied) return denied;

    const body = await context.req.json<{ fileName?: string; fileType?: string; content?: string }>();
    if (!body.fileName || !body.fileType) return jsonError(context, "文件信息不完整");

    const user = currentUser(context, store);
    const job = {
      id: crypto.randomUUID(),
      bookId,
      userId: user.id,
      fileName: body.fileName,
      fileType: body.fileType,
      r2Key: `${bookId}/${crypto.randomUUID()}-${body.fileName}`,
      status: "ai_processing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.imports.unshift(job);

    const normalized = await normalizeFile(
      {
        mimeType: body.fileType,
        bytes: new TextEncoder().encode(body.content ?? "超市购物 ¥38.50").buffer,
        text: body.content,
      },
      new MockOcrAdapter(),
    );
    const suggestions = await structureForConfirmation({
      bookId,
      userId: user.id,
      normalized,
      ai: createAiProvider(context.env.AI_PROVIDER),
    });
    const records = suggestions.map((suggestion) => ({
      id: crypto.randomUUID(),
      importJobId: job.id,
      suggestedTransaction: suggestion,
      status: "pending" as const,
      confidence: suggestion.confidence,
      warnings: suggestion.warnings,
    }));
    store.records.push(...records);
    job.status = "pending_confirmation";
    return context.json({ job, records }, 201);
  });

  app.get("/books/:bookId/imports", (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    return denied ?? context.json({ imports: store.imports.filter((item) => item.bookId === bookId) });
  });

  app.get("/imports/:id", (context) => {
    const job = store.imports.find((item) => item.id === context.req.param("id"));
    return job ? context.json({ job }) : jsonError(context, "导入任务不存在", 404);
  });

  app.get("/imports/:id/records", (context) => {
    return context.json({
      records: store.records.filter((item) => item.importJobId === context.req.param("id")),
    });
  });

  app.patch("/imported-records/:id", async (context) => {
    const record = store.records.find((item) => item.id === context.req.param("id"));
    if (!record) return jsonError(context, "待确认记录不存在", 404);

    Object.assign(record.suggestedTransaction, await context.req.json());
    return context.json({ record });
  });

  const confirmRecord = (recordId: string) => {
    const record = store.records.find((item) => item.id === recordId);
    if (!record || record.status !== "pending") return { error: "记录不可确认" as const };

    const job = store.imports.find((item) => item.id === record.importJobId);
    if (!job) return { error: "导入任务不存在" as const };

    const candidate = record.suggestedTransaction as any;
    const transaction = store.createTransaction(job.bookId, job.userId, {
      type: candidate.type,
      amount: candidate.amount,
      categoryId: undefined,
      accountId: undefined,
      memberId: store.members.find((member) => member.userId === job.userId && member.bookId === job.bookId)
        ?.id,
      note: candidate.note,
      occurredAt: candidate.occurredAt,
      tagIds: [],
      items: [],
    });
    record.status = "confirmed";
    return { record, transaction };
  };

  app.post("/imported-records/:id/confirm", (context) => {
    const recordId = context.req.param("id");
    if (!recordId) return jsonError(context, "待确认记录不存在", 404);

    const result = confirmRecord(recordId);
    return "error" in result ? jsonError(context, result.error ?? "记录不可确认", 400) : context.json(result);
  });

  app.post("/imports/:id/confirm-all", (context) => {
    const pending = store.records.filter(
      (record) => record.importJobId === context.req.param("id") && record.status === "pending",
    );
    const results = pending.map((record) => confirmRecord(record.id));
    return context.json({ confirmed: results.filter((result) => !("error" in result)).length });
  });
}
