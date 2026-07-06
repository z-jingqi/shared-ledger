import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

describe("D1 Aleph Tools diagnostics", () => {
  it("requires a signed-in user", async () => {
    const context = createD1TestApp();

    const response = await context.app.request("/diagnostics/aleph-tools", undefined, context.env);
    const body = await response.json<any>();

    expect(response.status).toBe(401);
    expect(body.error).toBe("请先登录");
    expect(context.alephTools.requests).toHaveLength(0);
  });

  it("does not expose diagnostics in production", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });

    const response = await context.app.request(
      "/diagnostics/aleph-tools",
      { headers: authHeaders(user) },
      { ...context.env, APP_ENV: "prod" },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(404);
    expect(body.error).toBe("诊断接口不可用");
    expect(context.alephTools.requests).toHaveLength(0);
  });

  it("proxies Aleph Tools platform diagnostics through the service binding", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });

    const response = await context.app.request(
      "/diagnostics/aleph-tools",
      { headers: authHeaders(user) },
      context.env,
    );
    const body = await response.json<any>();
    const request = context.alephTools.requests[0];

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.data.checks.auth.ok).toBe(true);
    expect(body.data.checks.storage.ok).toBe(true);
    expect(body.data.checks.processing.ok).toBe(true);
    expect(body.data.checks.googleVision.ok).toBe(true);
    expect(body.data.checks.imageConversion.ok).toBe(true);
    expect(body.data.job).toBeUndefined();
    expect(request?.url).toBe("https://aleph-tools.internal/v1/platform/check");
    expect(request?.headers.get("Authorization")).toBe("Bearer test-tools-key");
  });

  it("rejects raw Aleph OCR job ids from user-facing diagnostics", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });

    const response = await context.app.request(
      "/diagnostics/aleph-tools?jobId=ocr_external",
      { headers: authHeaders(user) },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(400);
    expect(body.error).toBe("请使用 importJobId 诊断导入任务");
    expect(context.alephTools.requests).toHaveLength(0);
  });

  it("resolves import job ownership before checking an Aleph OCR job", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });
    const book = seedBook(context.db, user, { id: "book_diag" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: user.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/receipt.jpg",
    });
    await context.repository.attachOcrJob(job.id, "ocr_from_import");
    context.alephTools.jobStatus.ocr_from_import = {
      jobId: "ocr_from_import",
      status: "processing",
      progress: 20,
      stage: "reading_source",
      resultAvailable: false,
    };

    const response = await context.app.request(
      `/diagnostics/aleph-tools?importJobId=${job.id}`,
      { headers: authHeaders(user) },
      context.env,
    );
    const body = await response.json<any>();
    const request = context.alephTools.requests[0];

    expect(response.status).toBe(200);
    expect(body.data.job).toMatchObject({
      found: true,
      storage: { sourceAvailable: true },
      snapshot: { jobId: "ocr_from_import" },
    });
    expect(request?.url).toBe("https://aleph-tools.internal/v1/platform/check?jobId=ocr_from_import");
  });

  it("does not allow diagnosing another user's import job", async () => {
    const context = createD1TestApp();
    const owner = seedUser(context.db, { id: "user_owner", name: "Owner", plan: "pro" });
    const viewer = seedUser(context.db, { id: "user_viewer", name: "Viewer", plan: "pro" });
    const book = seedBook(context.db, owner, { id: "book_owner" });
    const job = await context.repository.createImportJob({
      bookId: book.id,
      userId: owner.id,
      fileName: "receipt.jpg",
      fileType: "image/jpeg",
      r2Key: "imports/receipt.jpg",
    });
    await context.repository.attachOcrJob(job.id, "ocr_owner");

    const response = await context.app.request(
      `/diagnostics/aleph-tools?importJobId=${job.id}`,
      { headers: authHeaders(viewer) },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(403);
    expect(body.error).toBe("不能诊断其他用户的导入任务");
    expect(context.alephTools.requests).toHaveLength(0);
  });
});
