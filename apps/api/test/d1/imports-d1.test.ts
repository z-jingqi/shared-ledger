import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerAIError, type LedgerAiTestClient } from "@shared-ledger/ai";
import {
  cleanupExpiredImportArtifacts,
  finalizeSavedOcrResult,
  importOcrTextR2Key,
  markFailed,
  processImportPipelineMessage,
  sha256Hex,
} from "../../src/services/imports";
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

  it("uploads, runs Google Vision OCR, and removes temporary OCR text after AI completes", async () => {
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
    expect(context.importQueue.messages).toEqual([{ jobId: job!.id, step: "ocr" }]);
    expect(context.db.rows.image_ocr_usage).toHaveLength(1);
    const ocrMessage = context.importQueue.messages.shift();
    expect(ocrMessage).toEqual({ jobId: job!.id, step: "ocr" });
    await processImportPipelineMessage(env, context.repository, ocrMessage!);
    expect(context.files.objects.has(importOcrTextR2Key(job!))).toBe(true);
    await processImportPipelineMessage(env, context.repository, { jobId: job!.id, step: "ocr" });
    expect(requests.filter((request) => request.url.includes("vision.googleapis.com"))).toHaveLength(1);
    await drainImportQueue(context, env);

    const finalized = await context.repository.getImportJob(job!.id);
    expect(finalized?.status).toBe("pending_confirmation");
    expect(context.files.objects.has(importOcrTextR2Key(job!))).toBe(false);
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(1);
    expect(context.db.rows.image_ocr_usage).toHaveLength(1);
    expect(requests.some((request) => request.url.includes("vision.googleapis.com"))).toBe(true);
  });

  it("creates a duplicate review without OCR and only continues once after confirmation", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const firstForm = new FormData();
    firstForm.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));
    const first = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: firstForm },
      context.env,
    );
    const firstBody = await first.json<any>();
    const secondForm = new FormData();
    secondForm.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));

    const second = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: secondForm },
      context.env,
    );
    const secondBody = await second.json<any>();

    expect(first.status).toBe(202);
    expect(firstBody.jobs).toHaveLength(1);
    expect(second.status).toBe(202);
    expect(secondBody.jobs).toHaveLength(1);
    expect(secondBody.jobs[0]).toMatchObject({
      status: "duplicate_review",
      duplicateOfJobId: firstBody.jobs[0].id,
      fileName: "receipt.jpg",
    });
    expect(context.db.rows.import_jobs).toHaveLength(2);
    expect(context.importQueue.messages).toHaveLength(1);

    const continued = await context.app.request(
      `/imports/${secondBody.jobs[0].id}/continue-duplicate`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    const repeated = await context.app.request(
      `/imports/${secondBody.jobs[0].id}/continue-duplicate`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );

    expect(continued.status).toBe(200);
    expect(repeated.status).toBe(409);
    expect(context.importQueue.messages).toHaveLength(2);
    expect(context.db.rows.image_ocr_usage).toHaveLength(2);
  });

  it("deduplicates repeated files inside the same upload batch", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.append("files", new File(["same-image"], "receipt-a.jpg", { type: "image/jpeg" }));
    form.append("files", new File(["same-image"], "receipt-b.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(202);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[1]).toMatchObject({
      index: 1,
      duplicateOfJobId: body.jobs[0].id,
      fileName: "receipt-b.jpg",
      status: "duplicate_review",
    });
    expect(context.db.rows.import_jobs).toHaveLength(2);
    expect(context.importQueue.messages).toHaveLength(1);
  });

  it("detects the same receipt uploaded by another member of the book", async () => {
    const context = createD1TestApp();
    const owner = seedUser(context.db, { id: "user_owner", name: "Owner", plan: "pro" });
    const member = seedUser(context.db, { id: "user_member", name: "Member", plan: "pro" });
    const book = seedBook(context.db, owner, { id: "book_shared" });
    await context.repository.addMember(book.id, member.id, "member", owner.id);
    const ownerForm = new FormData();
    ownerForm.set("file", new File(["shared-receipt"], "owner.jpg", { type: "image/jpeg" }));
    const ownerUpload = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(owner), body: ownerForm },
      context.env,
    );
    const ownerBody = await ownerUpload.json<any>();
    const memberForm = new FormData();
    memberForm.set("file", new File(["shared-receipt"], "member.jpg", { type: "image/jpeg" }));

    const memberUpload = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(member), body: memberForm },
      context.env,
    );
    const memberBody = await memberUpload.json<any>();

    expect(memberUpload.status).toBe(202);
    expect(memberBody.job).toMatchObject({
      status: "duplicate_review",
      duplicateOfJobId: ownerBody.job.id,
    });
    expect(context.importQueue.messages).toHaveLength(1);
  });

  it("allows a fresh upload after the previous job failed", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const firstForm = new FormData();
    firstForm.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));
    const first = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: firstForm },
      context.env,
    );
    const firstBody = await first.json<any>();
    await context.repository.updateImportJob(firstBody.jobs[0].id, "failed", "AI 分析失败");
    const secondForm = new FormData();
    secondForm.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));

    const second = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: secondForm },
      context.env,
    );
    const secondBody = await second.json<any>();

    expect(second.status).toBe(202);
    expect(secondBody.jobs).toHaveLength(1);
    expect(secondBody.jobs[0]).toMatchObject({
      fileName: "receipt.jpg",
      status: "uploaded",
    });
    expect(secondBody.jobs[0].duplicateOfJobId).toBeUndefined();
    expect(context.db.rows.import_jobs).toHaveLength(2);
    expect(context.importQueue.messages).toHaveLength(2);
  });

  it("allows a fresh upload after all recognized records were ignored", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const original = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/original.jpg",
      fileHash: await sha256Hex("same-image"),
    });
    const [record] = await context.repository.createImportedRecords(original.id, [
      {
        type: "expense",
        amount: 12,
        occurredAt: "2026-07-10",
        note: "早餐",
        items: [],
        confidence: 0.9,
        warnings: [],
      },
    ]);
    await context.repository.updateImportedRecord(record.id, record.suggestedTransaction, "ignored", user.id);
    await context.repository.updateImportJob(original.id, "completed");
    const form = new FormData();
    form.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(202);
    expect(body.jobs[0]).toMatchObject({ status: "uploaded", fileName: "receipt.jpg" });
    expect(body.jobs[0].duplicateOfJobId).toBeUndefined();
    expect(context.importQueue.messages).toEqual([{ jobId: body.jobs[0].id, step: "ocr" }]);
  });

  it("still warns when the previous recognized record was confirmed", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const original = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/confirmed.jpg",
      fileHash: await sha256Hex("same-image"),
    });
    const [record] = await context.repository.createImportedRecords(original.id, [
      {
        type: "expense",
        amount: 12,
        occurredAt: "2026-07-10",
        note: "早餐",
        items: [],
        confidence: 0.9,
        warnings: [],
      },
    ]);
    await context.repository.updateImportedRecord(
      record.id,
      record.suggestedTransaction,
      "confirmed",
      user.id,
    );
    await context.repository.updateImportJob(original.id, "completed");
    const form = new FormData();
    form.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(202);
    expect(body.jobs[0]).toMatchObject({
      status: "duplicate_review",
      duplicateOfJobId: original.id,
    });
    expect(context.importQueue.messages).toHaveLength(0);
  });

  it("allows a fresh upload after the previous task was deleted", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const original = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/deleted.jpg",
      fileHash: await sha256Hex("same-image"),
    });
    await context.repository.updateImportJob(original.id, "failed", "识别失败");
    await context.repository.softDeleteImportJob(original.id, user.id);
    const form = new FormData();
    form.append("files", new File(["same-image"], "receipt.jpg", { type: "image/jpeg" }));

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(202);
    expect(body.jobs[0]).toMatchObject({ status: "uploaded", fileName: "receipt.jpg" });
    expect(body.jobs[0].duplicateOfJobId).toBeUndefined();
    expect(context.importQueue.messages).toEqual([{ jobId: body.jobs[0].id, step: "ocr" }]);
  });

  it("does not expose persisted OCR results", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    stubGoogleVision("早餐 12 元\n合计 12 元");
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = { ...context.env, AI_TEST_CLIENT: aiClientWithImportedRecord(), APP_ENV: "preview" };
    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    await drainImportQueue(context, env);

    const response = await context.app.request(
      `/imports/${uploadedBody.job.id}/ocr-result`,
      { headers: authHeaders(user) },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("warns but continues to AI when OCR text matches an existing recognized receipt", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const first = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "first.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/first.jpg",
    });
    await context.repository.setImportJobOcrTextHash(first.id, await sha256Hex("早餐12元"));
    await context.repository.updateImportJob(first.id, "pending_confirmation");
    const second = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "second.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/second.jpg",
    });
    await context.files.put(second.r2Key, "different-image", {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { importJobId: second.id, bookId: book.id, uploadedBy: user.id },
    });
    stubGoogleVision("早餐 12 元");

    await processImportPipelineMessage(context.env, context.repository, { jobId: second.id, step: "ocr" });
    const duplicate = await context.repository.getImportJob(second.id);

    expect(duplicate).toMatchObject({
      status: "ai_processing",
      duplicateOfImportJobId: first.id,
    });
    expect(await context.repository.listImportedRecords(second.id)).toHaveLength(0);
    expect(context.importQueue.messages).toEqual([{ jobId: second.id, step: "ai" }]);
  });

  it("requires an explicit override before confirming a duplicate receipt", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const original = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "original.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/original.jpg",
    });
    await context.repository.updateImportJob(original.id, "completed");
    const duplicate = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "duplicate.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/duplicate.jpg",
      duplicateOfImportJobId: original.id,
    });
    const [record] = await context.repository.createImportedRecords(duplicate.id, [
      {
        type: "expense",
        amount: 12,
        occurredAt: "2026-07-10",
        note: "早餐",
        items: [],
        confidence: 0.9,
        warnings: ["可能与已识别的小票重复，请确认后再入账"],
      },
    ]);
    await context.repository.updateImportJob(duplicate.id, "pending_confirmation");

    const blocked = await context.app.request(
      `/imported-records/${record.id}/confirm`,
      { method: "POST", headers: authHeaders(user), body: JSON.stringify({}) },
      context.env,
    );
    const confirmed = await context.app.request(
      `/imported-records/${record.id}/confirm`,
      {
        method: "POST",
        headers: authHeaders(user),
        body: JSON.stringify({ allowDuplicate: true }),
      },
      context.env,
    );

    expect(blocked.status).toBe(409);
    expect(await blocked.json<any>()).toMatchObject({ code: "DUPLICATE_CONFIRMATION_REQUIRED" });
    expect(confirmed.status).toBe(200);
    expect(context.db.rows.transactions).toHaveLength(1);
  });

  it("uses temporary OCR text for AI retry without calling Google Vision again", async () => {
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
    await context.files.put(
      importOcrTextR2Key(job),
      JSON.stringify({
        rawText: "已保存 OCR 文本",
        warnings: [],
      }),
      {
        httpMetadata: { contentType: "application/json" },
      },
    );
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

  it("keeps original HEIC display metadata while uploading OCR-ready JPEG bytes", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.append(
      "files",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "IMG_4706.jpg", { type: "image/jpeg" }),
    );
    form.set(
      "fileMetadata",
      JSON.stringify([{ originalName: "IMG_4706.HEIC", originalType: "image/heic", converted: true }]),
    );

    const response = await context.app.request(
      `/books/${book.id}/imports/batch`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const body = await response.json<any>();
    const job = await context.repository.getImportJob(body.jobs[0].id);

    expect(response.status).toBe(202);
    expect(job?.fileName).toBe("IMG_4706.HEIC");
    expect(job?.fileType).toBe("image/heic");
    expect(job?.ocrInputR2Key).toBe(job?.r2Key);
    expect(job?.ocrInputFileType).toBe("image/jpeg");
    expect(context.importQueue.messages).toEqual([{ jobId: job!.id, step: "ocr" }]);
  });

  it("rejects unconverted OCR-unsupported image uploads without creating a job", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["heic"], "IMG_4706.HEIC", { type: "image/heic" }));

    const response = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );

    expect(response.status).toBe(400);
    expect((await response.json<any>()).error).toBe("图片未完成转换，请重新选择文件");
    expect(context.db.rows.import_jobs).toHaveLength(0);
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
    await context.files.put(
      importOcrTextR2Key(job),
      JSON.stringify({
        rawText: "早餐 12 元",
        warnings: [],
      }),
      {
        httpMetadata: { contentType: "application/json" },
      },
    );
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

  it("keeps stale AI processing jobs active when reading import lists", async () => {
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
      status: "ai_processing",
      stage: "ai_items",
    });
    expect(body.imports[0].errorStage).toBeUndefined();
    expect((await context.repository.getImportJob(job.id))?.status).toBe("ai_processing");
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

  it("removes expired source and temporary OCR objects during scheduled cleanup", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "old.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/test/old.jpg",
    });
    context.db.rows.import_jobs.find((row) => row.id === job.id)!.created_at = "2020-01-01T00:00:00.000Z";
    await context.files.put(job.r2Key, "image");
    await context.files.put(importOcrTextR2Key(job), JSON.stringify({ rawText: "old", warnings: [] }));

    await cleanupExpiredImportArtifacts(context.env, context.repository);

    expect(await context.files.get(job.r2Key)).toBeNull();
    expect(await context.files.get(importOcrTextR2Key(job))).toBeNull();
    expect(await context.repository.getImportJob(job.id)).toBeNull();
  });
});
