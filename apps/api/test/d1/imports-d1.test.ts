import { describe, expect, it } from "vitest";
import type { AlephAIClient, InvokeRequest } from "@shared-ledger/ai";
import { failAlephOcrJob, finalizeAlephOcrJob } from "../../src/services/imports";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

function aiClientWithImportedRecord(): AlephAIClient {
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
              confidence: 0.95,
              warnings: [],
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
