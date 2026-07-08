import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerAIError, type LedgerAiTestClient } from "@shared-ledger/ai";
import type { D1LedgerRepository } from "../../src/repository";
import { finalizeSavedOcrResult, markFailed, processImportPipelineMessage } from "../../src/services/imports";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

type TestObjectRequest = Parameters<LedgerAiTestClient["generateObject"]>[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

function aiClientWithImportedRecord(record: Record<string, unknown> = {}): LedgerAiTestClient {
  return {
    async generateObject<TOutput = unknown>(request: TestObjectRequest) {
      const output =
        request.schemaName === "import_items_chunk"
          ? {
              items: Array.isArray(record.items) ? record.items : [],
              confidence: typeof record.confidence === "number" ? record.confidence : 0.95,
              warnings: Array.isArray(record.warnings) ? record.warnings : [],
            }
          : {
              type: "expense",
              amount: 12,
              occurredAt: "2026-06-28",
              note: "早餐",
              confidence: 0.95,
              warnings: [],
              ...record,
            };
      return output as TOutput;
    },
    async *streamText() {
      yield "";
    },
    async generateText() {
      return "";
    },
  };
}

function stubGoogleVision(text = "早餐 12 元") {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const normalized = request instanceof Request ? request : new Request(request, init);
      requests.push(normalized);
      if (normalized.url.includes("vision.googleapis.com")) {
        return Response.json({
          responses: [
            {
              fullTextAnnotation: {
                text,
                pages: [{ confidence: 0.95 }],
              },
            },
          ],
        });
      }
      return new Response("converted-image", { headers: { "Content-Type": "image/jpeg" } });
    }),
  );
  return requests;
}

async function drainImportQueue(context: ReturnType<typeof createD1TestApp>, env = context.env) {
  while (context.importQueue.messages.length) {
    const message = context.importQueue.messages.shift();
    if (message) await processImportPipelineMessage(env, context.repository, message);
  }
}

describe("D1 image import and OCR quota integrity", () => {
  it("rejects free users before writing R2 or creating OCR jobs", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_free", name: "Free", plan: "free" });
    const book = seedBook(context.db, user, { id: "book_free" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(403);
    expect(body.error).toBe("当前套餐不支持图片识别");
    expect(context.db.rows.import_jobs).toHaveLength(0);
    expect(context.files.objects.size).toBe(0);
  });

  it("preflights batch quota atomically before creating any import jobs", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    for (let index = 0; index < 9; index += 1) {
      context.db.rows.image_ocr_usage.push({
        id: `usage_${index}`,
        user_id: user.id,
        import_job_id: `import_done_${index}`,
        usage_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
        counted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      });
    }
    const form = new FormData();
    form.append("files", new File(["a"], "a.jpg", { type: "image/jpeg" }));
    form.append("files", new File(["b"], "b.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(429);
    expect(body.error).toBe("今日图片识别额度已用完");
    expect(context.db.rows.import_jobs).toHaveLength(0);
  });

  it("uploads, runs Google Vision OCR, saves raw OCR, and creates pending imported records", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const requests = stubGoogleVision("早餐 12 元\n合计 12 元");
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = { ...context.env, AI_TEST_CLIENT: aiClientWithImportedRecord() };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);

    expect(uploaded.status).toBe(202);
    expect(job?.status).toBe("uploaded");
    expect(context.importQueue.messages).toEqual([{ jobId: job!.id, step: "convert" }]);
    await drainImportQueue(context, env);

    const finalized = await context.repository.getImportJob(job!.id);
    const ocrResult = await context.repository.getImportOcrResult(job!.id);
    expect(finalized?.status).toBe("pending_confirmation");
    expect(ocrResult?.provider).toBe("google-vision");
    expect(ocrResult?.rawText).toContain("早餐");
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(1);
    expect(context.db.rows.image_ocr_usage).toHaveLength(1);
    expect(requests.some((request) => request.url.includes("vision.googleapis.com"))).toBe(true);
  });

  it("uses saved OCR raw text for AI retry without calling Google Vision again", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.repository.markImportJobOcrProcessing(job.id, "ocr_test", "google-vision");
    await context.repository.saveImportOcrResult({
      importJobId: job.id,
      provider: "google-vision",
      engineVersion: "v1",
      rawText: "已保存 OCR 文本",
      rawJson: { ok: true },
      converted: false,
      sourceMimeType: "image/jpeg",
      processedMimeType: "image/jpeg",
      actorId: user.id,
    });
    await context.repository.markImportJobFailed(job.id, {
      message: "AI failed once",
      code: "AI_PROCESSING_FAILED",
      stage: "ai",
      retryable: true,
      terminal: false,
    });

    await finalizeSavedOcrResult(
      { ...context.env, AI_TEST_CLIENT: aiClientWithImportedRecord() },
      context.repository,
      job.id,
    );

    expect((await context.repository.getImportJob(job.id))?.status).toBe("pending_confirmation");
    expect(await context.repository.listImportedRecords(job.id)).toHaveLength(1);
  });

  it("confirms AI-imported categories and line items, then completes the import job", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    stubGoogleVision("超市购物 18.50");
    const aiClient = aiClientWithImportedRecord({
      amount: 18.5,
      note: "超市购物",
      categoryName: "餐饮",
      items: [
        { name: "牛奶", amount: 10.5, categoryName: "食品" },
        { name: "面包", amount: 8, categoryName: "食品" },
      ],
    });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = { ...context.env, AI_TEST_CLIENT: aiClient };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    await drainImportQueue(context, env);
    const pending = await context.repository.listImportedRecords(uploadedBody.job.id);

    const confirmed = await context.app.request(
      `/imported-records/${pending[0].id}/confirm`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    const confirmedBody = await confirmed.json<any>();
    const categories = await context.repository.listCategories(user.id);
    const recordCategory = categories.find((category) => category.name === "餐饮");
    const itemCategory = categories.find((category) => category.name === "食品");

    expect(confirmed.status).toBe(200);
    expect(confirmedBody.job).toMatchObject({ id: uploadedBody.job.id, status: "completed" });
    expect(context.db.rows.transactions[0].category_id).toBe(recordCategory?.id);
    expect(confirmedBody.transaction.items.map((item: { name: string }) => item.name)).toEqual([
      "牛奶",
      "面包",
    ]);
    expect(
      confirmedBody.transaction.items.every(
        (item: { categoryId?: string }) => item.categoryId === itemCategory?.id,
      ),
    ).toBe(true);
  });

  it("cancels queued import jobs and removes stored source files", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.heic",
      fileType: "image/heic",
      r2Key: "imports/test/receipt.heic",
    });
    await context.files.put(job.r2Key, "image", {
      httpMetadata: { contentType: "image/heic" },
      customMetadata: { importJobId: job.id, bookId: book.id, uploadedBy: user.id },
    });
    const cancelled = await context.app.request(
      `/imports/${job.id}/cancel`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );

    expect(cancelled.status).toBe(200);
    expect((await context.repository.getImportJob(job.id))?.status).toBe("cancelled");
    expect(await context.files.get(job.r2Key)).toBeNull();
  });

  it("does not write OCR input or enqueue OCR when cancelled during conversion", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.files.put(job.r2Key, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { importJobId: job.id, bookId: book.id, uploadedBy: user.id },
    });

    const repository = Object.create(context.repository) as D1LedgerRepository;
    let reads = 0;
    repository.getImportJob = async (jobId: string) => {
      reads += 1;
      if (reads === 3) await context.repository.updateImportJob(jobId, "cancelled");
      return context.repository.getImportJob(jobId);
    };

    await processImportPipelineMessage(context.env, repository, { jobId: job.id, step: "convert" });

    const cancelled = await context.repository.getImportJob(job.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.ocrInputR2Key).toBeFalsy();
    expect(context.importQueue.messages).toHaveLength(0);
  });

  it("serves import image previews from shared ledger R2", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const uploadedBody = await uploaded.json<any>();
    const preview = await context.app.request(
      `/imports/${uploadedBody.job.id}/file`,
      { headers: authHeaders(user) },
      context.env,
    );

    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/jpeg");
    expect(await preview.text()).toBe("image");
  });

  it("does not create records or count usage when cancelled during AI structuring", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.repository.markImportJobOcrProcessing(job.id, "ocr_test", "google-vision");
    await context.repository.saveImportOcrResult({
      importJobId: job.id,
      provider: "google-vision",
      rawText: "早餐 12 元",
      rawJson: {},
      converted: false,
      actorId: user.id,
    });
    const baseAiClient = aiClientWithImportedRecord();
    const env = {
      ...context.env,
      AI_TEST_CLIENT: {
        ...baseAiClient,
        async generateObject<TOutput = unknown>(request: TestObjectRequest) {
          await context.repository.updateImportJob(job.id, "cancelled");
          return baseAiClient.generateObject<TOutput>(request);
        },
      } satisfies LedgerAiTestClient,
    };

    await finalizeSavedOcrResult(env, context.repository, job.id);

    expect((await context.repository.getImportJob(job.id))?.status).toBe("cancelled");
    expect(await context.repository.listImportedRecords(job.id)).toHaveLength(0);
    expect(context.db.rows.image_ocr_usage).toHaveLength(0);
  });

  it("streams AI processing snapshots without OCR disconnect errors", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.repository.markImportJobAiProcessing(job.id, "ai_structuring");

    const stream = await context.app.request(
      `/imports/status-stream?ids=${job.id}`,
      { headers: authHeaders(user) },
      { ...context.env, APP_ENV: "test" },
    );
    const text = await stream.text();

    expect(stream.status).toBe(200);
    expect(text).toContain('"status":"ai_processing"');
    expect(text).toContain('"progressText":"AI 分析明细"');
    expect(text.match(/event: job/g)).toHaveLength(1);
    expect(text).not.toContain("stream-error");
    expect(text).toContain("stream-idle");
  });

  it("marks stale AI processing jobs as retryable failures in import lists", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.repository.markImportJobAiProcessing(job.id, "ai_items");
    context.db.rows.import_jobs[0].updated_at = new Date(Date.now() - 120_000).toISOString();

    const response = await context.app.request(
      `/books/${book.id}/imports`,
      { headers: authHeaders(user) },
      { ...context.env, APP_ENV: "test" },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.imports[0]).toMatchObject({
      id: job.id,
      status: "failed",
      errorStage: "ai",
      retryable: true,
    });
  });

  it("does not let later OCR failures overwrite cancellation intent", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/receipt.jpg",
    });
    await context.repository.updateImportJob(job.id, "cancelled");

    await markFailed(
      context.repository,
      job.id,
      new LedgerAIError("provider_error", "provider failed"),
      "ocr",
    );

    const afterFailure = await context.repository.getImportJob(job.id);
    expect(afterFailure?.status).toBe("cancelled");
    expect(afterFailure?.errorMessage).toBeFalsy();
  });
});
