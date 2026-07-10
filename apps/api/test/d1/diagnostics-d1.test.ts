import { describe, expect, it } from "vitest";
import { authHeaders, createD1TestApp, seedBook, seedUser } from "./harness";

describe("D1 OCR diagnostics", () => {
  it("requires a signed-in user", async () => {
    const context = createD1TestApp();

    const response = await context.app.request("/diagnostics/ocr", undefined, context.env);
    const body = await response.json<any>();

    expect(response.status).toBe(401);
    expect(body.error).toBe("请先登录");
  });

  it("does not expose diagnostics in production", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });

    const response = await context.app.request(
      "/diagnostics/ocr",
      { headers: authHeaders(user) },
      { ...context.env, APP_ENV: "prod" },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(404);
    expect(body.error).toBe("诊断接口不可用");
  });

  it("reports Google Vision configuration state", async () => {
    const context = createD1TestApp();
    const user = seedUser(context.db, { id: "user_diag", name: "Diag", plan: "pro" });

    const response = await context.app.request(
      "/diagnostics/ocr",
      { headers: authHeaders(user) },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.googleVision).toMatchObject({ ok: true, configured: true });
  });

  it("reports import status without exposing OCR contents", async () => {
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
    await context.repository.markImportJobOcrProcessing(job.id, "ocr_with_result", "google-vision");
    const response = await context.app.request(
      `/diagnostics/ocr?importJobId=${job.id}&includeOcrRaw=1`,
      { headers: authHeaders(user) },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.importJob).toMatchObject({
      id: job.id,
      status: "ocr_processing",
      ocrJobId: "ocr_with_result",
    });
    expect(body.sharedLedgerDebug).toBeUndefined();
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
    await context.repository.markImportJobOcrProcessing(job.id, "ocr_owner", "google-vision");

    const response = await context.app.request(
      `/diagnostics/ocr?importJobId=${job.id}`,
      { headers: authHeaders(viewer) },
      context.env,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(403);
    expect(body.error).toBe("不能诊断其他用户的导入任务");
  });
});
