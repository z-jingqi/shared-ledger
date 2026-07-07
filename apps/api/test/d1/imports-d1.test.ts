import { describe, expect, it } from "vitest";
import type { AlephAIClient, InvokeRequest } from "@shared-ledger/ai";
import { failAlephOcrJob, finalizeAlephOcrJob } from "../../src/services/imports";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

function aiClientWithImportedRecord(record: Record<string, unknown> = {}): AlephAIClient {
  return {
    async invoke<TOutput = unknown>(_request: InvokeRequest) {
      return {
        requestId: "ai_import_1",
        status: "ok",
        route: "test",
        provider: "test",
        model: "test-model",
        usage: { inputTokens: 1, outputTokens: 1, creditsCharged: 1 },
        output: {
          records: [
            {
              type: "expense",
              amount: 12,
              occurredAt: "2026-06-28",
              note: "早餐",
              items: [],
              confidence: 0.95,
              warnings: [],
              ...record,
            },
          ],
        } as TOutput,
      };
    },
    async *stream() {
      yield { type: "done" as const, requestId: "stream_1" };
    },
    async getUserUsage(params) {
      return {
        project: params.project,
        userId: params.userId,
        plan: params.plan ?? "pro",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        credits: { used: 0, limit: 100, remaining: 100 },
        requests: { used: 0, limit: 100, remaining: 100 },
      };
    },
  };
}

function hangingAiClient(): AlephAIClient {
  return {
    async invoke() {
      return new Promise<never>(() => undefined);
    },
    async *stream() {
      yield { type: "done" as const, requestId: "stream_1" };
    },
    async getUserUsage(params) {
      return {
        project: params.project,
        userId: params.userId,
        plan: params.plan ?? "pro",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        credits: { used: 0, limit: 100, remaining: 100 },
        requests: { used: 0, limit: 100, remaining: 100 },
      };
    },
  };
}

describe("D1 image import and OCR quota integrity", () => {
  it("rejects free users before writing R2 or creating Aleph OCR jobs", async () => {
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
    expect(context.alephTools.requests).toHaveLength(0);
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
    expect(context.alephTools.requests).toHaveLength(0);
  });

  it("exposes orphan uploaded jobs as cancelable payloads and lets users cancel them", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "IMG_4706.HEIC",
      fileType: "image/heic",
      r2Key: "imports/book_pro/stuck-IMG_4706.HEIC",
    });
    await context.files.put(job.r2Key, "image", {
      httpMetadata: { contentType: "image/heic" },
      customMetadata: { importJobId: job.id, bookId: book.id, uploadedBy: user.id },
    });

    const list = await context.app.request(
      `/books/${book.id}/imports`,
      { headers: authHeaders(user) },
      context.env,
    );
    const listBody = await list.json<any>();

    expect(list.status).toBe(200);
    expect(listBody.imports[0]).toMatchObject({
      id: job.id,
      status: "uploaded",
      cancelable: true,
      retryable: false,
    });
    expect(listBody.imports[0]).not.toHaveProperty("r2Key");
    expect(listBody.imports[0]).not.toHaveProperty("userId");

    const cancelled = await context.app.request(
      `/imports/${job.id}/cancel`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    const cancelBody = await cancelled.json<any>();

    expect(cancelled.status).toBe(200);
    expect(cancelBody.job).toMatchObject({ id: job.id, status: "cancelled", cancelable: false });
    expect(context.files.objects.has(job.r2Key)).toBe(false);
  });

  it("counts image OCR usage once only after OCR and AI create imported records", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClientWithImportedRecord() },
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    expect(uploaded.status).toBe(202);
    expect(job?.status).toBe("ocr_processing");

    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };
    await finalizeAlephOcrJob(
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClientWithImportedRecord() },
      context.repository,
      job!.id,
    );
    await finalizeAlephOcrJob(
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClientWithImportedRecord() },
      context.repository,
      job!.id,
    );

    const finalized = await context.repository.getImportJob(job!.id);
    expect(finalized?.status).toBe("pending_confirmation");
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(1);
    expect(context.db.rows.image_ocr_usage).toHaveLength(1);
    expect(context.db.rows.image_ocr_usage[0].import_job_id).toBe(job!.id);
  });

  it("uses structured OCR markdown for import AI when available", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    let aiText = "";
    const aiClient: AlephAIClient = {
      ...aiClientWithImportedRecord({
        items: [{ name: "拿铁", amount: 12, categoryName: "餐饮" }],
      }),
      async invoke<TOutput = unknown>(request: InvokeRequest) {
        const message = (request.input as any).messages?.find((item: any) => item.role === "user") as
          | { content?: string }
          | undefined;
        aiText = JSON.parse(message?.content ?? "{}").text ?? "";
        return aiClientWithImportedRecord({
          items: [{ name: "拿铁", amount: 12, categoryName: "餐饮" }],
        }).invoke<TOutput>(request);
      },
    };
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClient },
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };
    context.alephTools.result[job!.ocrJobId!] = {
      markdown: "| 品名 | 金额 |\n| --- | ---: |\n| 拿铁 | 12.00 |",
      plainText: "合计 12.00",
      pages: [{ text: "拿铁 12.00", confidence: 0.95 }],
    };

    await finalizeAlephOcrJob(
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClient },
      context.repository,
      job!.id,
    );

    expect(aiText).toContain("OCR markdown");
    expect(aiText).toContain("拿铁");
    expect(aiText).toContain("OCR plain text");
  });

  it("confirms AI-imported categories and line items, then completes the import job", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
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

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClient },
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };

    await finalizeAlephOcrJob(
      { ...context.env, ALEPH_AI_TEST_CLIENT: aiClient },
      context.repository,
      job!.id,
    );
    const pending = await context.repository.listImportedRecords(job!.id);

    expect(pending).toHaveLength(1);
    expect((pending[0].suggestedTransaction as any).items).toHaveLength(2);

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
    expect(confirmedBody.job).toMatchObject({ id: job!.id, status: "completed" });
    expect(context.db.rows.transactions).toHaveLength(1);
    expect(context.db.rows.transactions[0].category_id).toBe(recordCategory?.id);
    expect(confirmedBody.transaction.items).toHaveLength(2);
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

  it("creates Aleph OCR sourceRef jobs and serves original source only to the bound Aleph job", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.heic", { type: "image/heic" }));

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      context.env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    const alephRequest = context.alephTools.requests.find((request) => request.url.endsWith("/v1/tools/ocr"));
    const alephBody = (await alephRequest!.json()) as {
      source: { accessToken: string; [key: string]: unknown };
    };

    expect(uploaded.status).toBe(202);
    expect(job?.ocrJobId).toBeTruthy();
    expect(alephBody.source).toMatchObject({
      type: "client_source",
      sourceId: job!.id,
      filename: "receipt.heic",
      mimeType: "image/heic",
      sizeBytes: 5,
    });
    expect(alephBody.source.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(alephBody.source.accessToken).toBeTruthy();
    expect(context.db.rows.import_jobs[0].source_access_token_hash).toBeTruthy();

    const missingAlephJob = await context.app.request(
      `/internal/aleph-tools/import-sources/${job!.id}`,
      { headers: { Authorization: `Bearer ${alephBody.source.accessToken}` } },
      context.env,
    );
    expect(missingAlephJob.status).toBe(401);

    const source = await context.app.request(
      `/internal/aleph-tools/import-sources/${job!.id}`,
      {
        headers: {
          Authorization: `Bearer ${alephBody.source.accessToken}`,
          "X-Aleph-Job-Id": job!.ocrJobId!,
        },
      },
      context.env,
    );
    expect(source.status).toBe(200);
    expect(source.headers.get("Content-Type")).toBe("image/heic");
    expect(await source.text()).toBe("image");

    const cancelled = await context.app.request(
      `/imports/${job!.id}/cancel`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    expect(cancelled.status).toBe(200);
    const revoked = await context.app.request(
      `/internal/aleph-tools/import-sources/${job!.id}`,
      {
        headers: {
          Authorization: `Bearer ${alephBody.source.accessToken}`,
          "X-Aleph-Job-Id": job!.ocrJobId!,
        },
      },
      context.env,
    );
    expect(revoked.status).toBe(410);
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

  it("finalizes a ready OCR job from status stream snapshots when no Aleph events arrive", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = { ...context.env, ALEPH_AI_TEST_CLIENT: aiClientWithImportedRecord() };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    expect(job?.status).toBe("ocr_processing");

    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };

    const stream = await context.app.request(
      `/imports/status-stream?ids=${job!.id}`,
      { headers: authHeaders(user) },
      env,
    );
    const text = await stream.text();
    const finalized = await context.repository.getImportJob(job!.id);

    expect(stream.status).toBe(200);
    expect(text).toContain("event: job");
    expect(text).toContain('"status":"pending_confirmation"');
    expect(finalized?.status).toBe("pending_confirmation");
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(1);
  });

  it("does not create records or count usage when cancelled during AI structuring", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const baseAiClient = aiClientWithImportedRecord();
    const env = {
      ...context.env,
      ALEPH_AI_TEST_CLIENT: {
        async invoke<TOutput = unknown>() {
          await context.repository.updateImportJob(context.db.rows.import_jobs[0].id as string, "cancelled");
          return baseAiClient.invoke<TOutput>({} as InvokeRequest);
        },
        stream: baseAiClient.stream,
        getUserUsage: baseAiClient.getUserUsage,
      } satisfies AlephAIClient,
    };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };

    await finalizeAlephOcrJob(env, context.repository, job!.id);

    expect((await context.repository.getImportJob(job!.id))?.status).toBe("cancelled");
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(0);
    expect(context.db.rows.image_ocr_usage).toHaveLength(0);
  });

  it("marks AI structuring timeouts as retryable AI failures", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = {
      ...context.env,
      ALEPH_AI_IMPORT_TIMEOUT_MS: "5",
      ALEPH_AI_TEST_CLIENT: hangingAiClient(),
    };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };

    await expect(finalizeAlephOcrJob(env, context.repository, job!.id)).rejects.toThrow("AI 分析超时");
    const failed = await context.repository.getImportJob(job!.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.errorStage).toBe("ai");
    expect(failed?.errorRetryable).toBe(true);
    expect(failed?.errorCode).toBe("provider_unavailable");
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
    expect(text).not.toContain("stream-error");
    expect(text).toContain("stream-idle");
  });

  it("marks OCR cancellation as requested, keeps quota active, and skips later finalization", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_pro", name: "Pro", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_pro" });
    const form = new FormData();
    form.set("file", new File(["image"], "receipt.jpg", { type: "image/jpeg" }));
    const env = { ...context.env, ALEPH_AI_TEST_CLIENT: aiClientWithImportedRecord() };

    const uploaded = await context.app.request(
      `/books/${book.id}/imports`,
      { method: "POST", headers: authHeaders(user), body: form },
      env,
    );
    const uploadedBody = await uploaded.json<any>();
    const job = await context.repository.getImportJob(uploadedBody.job.id);
    expect(job?.status).toBe("ocr_processing");

    const cancelled = await context.app.request(
      `/imports/${job!.id}/cancel`,
      { method: "POST", headers: authHeaders(user) },
      env,
    );
    const body = await cancelled.json<any>();

    expect(cancelled.status).toBe(200);
    expect(body.job.status).toBe("cancel_requested");
    expect(body.job.cancelable).toBe(false);
    expect(await context.repository.countActiveImageOcrJobs(user.id, currentShanghaiRange())).toBe(1);

    context.alephTools.jobStatus[job!.ocrJobId!] = {
      jobId: job!.ocrJobId,
      status: "ready",
      resultAvailable: true,
      progress: 100,
    };
    await finalizeAlephOcrJob(env, context.repository, job!.id);

    expect((await context.repository.getImportJob(job!.id))?.status).toBe("cancel_requested");
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(0);
    expect(context.db.rows.image_ocr_usage).toHaveLength(0);
  });

  it("does not let later OCR failures overwrite cancellation intent", async () => {
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
    const job = await context.repository.getImportJob(uploadedBody.job.id);

    await context.app.request(
      `/imports/${job!.id}/cancel`,
      { method: "POST", headers: authHeaders(user) },
      context.env,
    );
    await failAlephOcrJob(context.repository, job!.id, "provider failed after cancel");

    const afterFailure = await context.repository.getImportJob(job!.id);
    expect(afterFailure?.status).toBe("cancel_requested");
    expect(afterFailure?.errorMessage).toBeFalsy();
    expect(await context.repository.listImportedRecords(job!.id)).toHaveLength(0);
  });

  it("rejects deleting active import jobs", async () => {
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

    const deleted = await context.app.request(
      `/imports/${uploadedBody.job.id}`,
      { method: "DELETE", headers: authHeaders(user) },
      context.env,
    );
    const body = await deleted.json<any>();

    expect(deleted.status).toBe(409);
    expect(body.error).toBe("请先取消或等待任务完成后再删除");
    expect(await context.repository.getImportJob(uploadedBody.job.id)).toBeTruthy();
  });

  it("soft deletes terminal import jobs and their pending records", async () => {
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
    await context.repository.updateImportJob(job.id, "pending_confirmation");
    await context.repository.createImportedRecords(job.id, [
      {
        type: "expense",
        amount: 12,
        occurredAt: "2026-06-28",
        note: "早餐",
        confidence: 0.95,
        warnings: [],
      },
    ]);

    const deleted = await context.app.request(
      `/imports/${job.id}`,
      { method: "DELETE", headers: authHeaders(user) },
      context.env,
    );

    expect(deleted.status).toBe(204);
    expect(await context.repository.getImportJob(job.id)).toBeNull();
    expect(await context.repository.listImportedRecords(job.id)).toHaveLength(0);
    expect(context.db.rows.import_jobs[0].deleted_by_user_id).toBe(user.id);
    expect(context.db.rows.imported_records[0].deleted_by_user_id).toBe(user.id);
  });
});

function currentShanghaiRange() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
