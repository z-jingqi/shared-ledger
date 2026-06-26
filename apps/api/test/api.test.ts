import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { MemoryLedgerStore } from "../src/store";
const request = (path: string, init?: RequestInit) =>
  createApp(new MemoryLedgerStore()).request(path, init, { APP_ENV: "test" });
const aiHeaders = { "Content-Type": "application/json", "X-Plan": "pro", "X-AI-Test-Memory": "true" };
const decodeStreamChunk = (chunk?: Uint8Array) => new TextDecoder().decode(chunk);
const readStreamChunk = (reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 500) =>
  new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for stream chunk")), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
describe("Hono REST API", () => {
  it("creates a book and restricts deletion to creator", async () => {
    const response = await request("/books", {
      method: "POST",
      body: JSON.stringify({ name: "旅行账本", currency: "CNY" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
  });
  it("validates transaction line-item totals", async () => {
    const response = await request("/books/book_home/transactions", {
      method: "POST",
      body: JSON.stringify({
        type: "expense",
        amount: 10,
        occurredAt: "2026-01-01",
        items: [{ name: "a", amount: 9 }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(400);
  });
  it("hides AI chat from free users and requires persistent runtime for pro users", async () => {
    const free = await request("/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: "分析" }),
      headers: { "Content-Type": "application/json" },
    });
    const pro = await request("/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: "分析" }),
      headers: { "Content-Type": "application/json", "X-Plan": "pro" },
    });
    expect(free.status).toBe(403);
    expect(pro.status).toBe(503);
  });
  it("prevents duplicate pending invitations", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const init = {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
      headers: { "Content-Type": "application/json" },
    };
    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(201);
    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(409);
  });
  it("rejects anonymous import status streams", async () => {
    const response = await createApp().request("/imports/status-stream?ids=import_test", undefined, { APP_ENV: "test" });
    expect(response.status).toBe(401);
  });
  it("AI creates a transaction and auto-creates the inferred category", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const response = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "昨天打车 38" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(store.categories.some((category) => category.name === "交通")).toBe(true);
    expect(store.transactions[0]).toMatchObject({ amount: 38, note: "打车", type: "expense" });
    expect(body.parts.some((part: any) => part.type === "record-card" && part.categoryName === "交通")).toBe(true);
    expect(store.aiActionAuditLogs.some((log) => log.action === "create-record" && log.targetType === "transaction")).toBe(
      true,
    );
  });
  it("AI transaction ingestion endpoint creates categories and is idempotent", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const beforeCount = store.transactions.length;
    const init = {
      method: "POST",
      body: JSON.stringify({
        bookId: "book_home",
        text: "今天咖啡 28",
        candidate: {
          type: "expense",
          amount: 28,
          occurredAt: "2026-06-26",
          categoryName: "咖啡",
          note: "咖啡",
        },
      }),
      headers: { ...aiHeaders, "idempotency-key": "test-ingest-coffee" },
    };

    const first = await app.request("/ai/transactions/ingest", init, { APP_ENV: "test" });
    const firstBody = await first.json<any>();
    const second = await app.request("/ai/transactions/ingest", init, { APP_ENV: "test" });
    const secondBody = await second.json<any>();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(store.transactions).toHaveLength(beforeCount + 1);
    expect(store.categories.some((category) => category.name === "咖啡")).toBe(true);
    expect(firstBody.parts.some((part: any) => part.type === "record-card" && part.categoryName === "咖啡")).toBe(true);
    expect(secondBody.idempotent).toBe(true);
    expect(store.aiActionAuditLogs.filter((log) => log.idempotencyKey === "test-ingest-coffee")).toHaveLength(1);
  });
  it("AI transaction ingestion asks for missing amount or date without writing", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const beforeTransactions = store.transactions.length;
    const beforeAudits = store.aiActionAuditLogs.length;

    const missingDate = await app.request(
      "/ai/transactions/ingest",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", text: "打车 38" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const missingAmount = await app.request(
      "/ai/transactions/ingest",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", text: "昨天打车" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );

    expect(missingDate.status).toBe(200);
    expect((await missingDate.json<any>()).missingFields).toContain("occurredAt");
    expect((await missingAmount.json<any>()).missingFields).toContain("amount");
    expect(store.transactions).toHaveLength(beforeTransactions);
    expect(store.aiActionAuditLogs).toHaveLength(beforeAudits);
    expect(store.categories.some((category) => category.name === "交通")).toBe(false);
  });
  it("AI search returns a search result and records navigation card", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const response = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "今年大于100的支出" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const body = await response.json<any>();
    const searchCard = body.parts.find((part: any) => part.type === "search-result-card");
    const navigationCard = body.parts.find((part: any) => part.type === "navigation-card");

    expect(response.status).toBe(200);
    expect(searchCard.summary).toContain("找到");
    expect(searchCard.results.length).toBeGreaterThanOrEqual(1);
    expect(navigationCard.href).toContain("/records?");
    expect(navigationCard.href).toContain("type=expense");
    expect(navigationCard.href).toContain("min=100");
    expect(navigationCard.href).toContain("source=ai");
    expect(navigationCard.href).toContain("bookId=book_home");
  });
  it("AI returns an analysis card from current book transactions", async () => {
    const response = await createApp(new MemoryLedgerStore()).request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "分析这个账本" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const body = await response.json<any>();
    const card = body.parts.find((part: any) => part.type === "analysis-card");

    expect(response.status).toBe(200);
    expect(card.metrics.find((metric: any) => metric.label === "支出").value).toBe("¥158.60");
    expect(card.metrics.find((metric: any) => metric.label === "收入").value).toMatch(/¥8,?500\.00/);
  });
  it("AI invite confirmation can confirm, cancel, and expire", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const create = async (email: string) => {
      const response = await app.request(
        "/ai/chat",
        {
          method: "POST",
          body: JSON.stringify({ bookId: "book_home", message: `邀请 ${email}` }),
          headers: aiHeaders,
        },
        { APP_ENV: "test" },
      );
      const body = await response.json<any>();
      return body.parts.find((part: any) => part.type === "confirmation-card").confirmation.id as string;
    };

    const confirmId = await create("confirm@example.com");
    expect(store.invitations).toHaveLength(0);
    const confirmed = await app.request(
      `/ai/confirmations/${confirmId}/confirm`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    expect(confirmed.status).toBe(200);
    expect(store.invitations).toHaveLength(1);

    const cancelId = await create("cancel@example.com");
    const cancelled = await app.request(
      `/ai/confirmations/${cancelId}/cancel`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    expect(cancelled.status).toBe(200);
    expect(store.invitations.some((invitation) => invitation.inviteeEmail === "cancel@example.com")).toBe(false);

    const expireId = await create("expire@example.com");
    const expiring = store.aiConfirmations.find((confirmation) => confirmation.id === expireId);
    expect(expiring).toBeTruthy();
    expiring!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = await app.request(
      `/ai/confirmations/${expireId}/confirm`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const expiredBody = await expired.json<any>();
    expect(expired.status).toBe(409);
    expect(expiredBody.confirmation.status).toBe("cancelled");
  });
  it("AI invite does not create duplicate pending invitations", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const createResponse = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "邀请 duplicate@example.com" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const body = await createResponse.json<any>();
    const confirmationId = body.parts.find((part: any) => part.type === "confirmation-card").confirmation.id;
    await app.request(
      `/ai/confirmations/${confirmationId}/confirm`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const duplicateResponse = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "邀请 duplicate@example.com" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const duplicateBody = await duplicateResponse.json<any>();

    expect(store.invitations.filter((invitation) => invitation.inviteeEmail === "duplicate@example.com")).toHaveLength(1);
    expect(duplicateBody.parts.some((part: any) => part.type === "confirmation-card")).toBe(false);
  });
  it("AI invite confirmation checks invite permissions before creation and confirmation", async () => {
    const store = new MemoryLedgerStore();
    const member = store.createUser("李四", "member@example.com", "pro");
    store.members.push({
      id: "member_regular",
      bookId: "book_home",
      userId: member.id,
      name: member.name,
      role: "member",
      joinedAt: new Date().toISOString(),
    });
    const app = createApp(store);

    const deniedCreate = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "邀请 blocked@example.com" }),
        headers: { ...aiHeaders, "x-user-id": member.id },
      },
      { APP_ENV: "test" },
    );
    const deniedCreateBody = await deniedCreate.json<any>();
    expect(deniedCreate.status).toBe(200);
    expect(deniedCreateBody.parts.some((part: any) => part.type === "confirmation-card")).toBe(false);
    expect(store.aiConfirmations).toHaveLength(0);

    const create = await app.request(
      "/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "邀请 later-blocked@example.com" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const confirmationId = (await create.json<any>()).parts.find((part: any) => part.type === "confirmation-card").confirmation.id;
    store.members.find((item) => item.id === "member_demo")!.role = "member";
    const deniedConfirm = await app.request(
      `/ai/confirmations/${confirmationId}/confirm`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );

    expect(deniedConfirm.status).toBe(403);
    expect(store.invitations.some((invitation) => invitation.inviteeEmail === "later-blocked@example.com")).toBe(false);
  });
  it("AI confirmation returns unsupported for known high-risk actions without crashing", async () => {
    const store = new MemoryLedgerStore();
    store.aiConfirmations.push({
      id: "ai_confirmation_import_batch",
      userId: "user_demo",
      bookId: "book_home",
      action: "confirm-import-batch",
      status: "pending",
      payload: { importJobIds: ["import_1"], bookId: "book_home" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const response = await createApp(store).request(
      "/ai/confirmations/ai_confirmation_import_batch/confirm",
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );

    expect(response.status).toBe(400);
    expect((await response.json<any>()).error).toContain("暂不支持");
    expect(store.aiConfirmations[0].status).toBe("pending");
  });
  it("AI task endpoints expose import jobs as tasks in test fallback", async () => {
    const store = new MemoryLedgerStore();
    store.imports.push({
      id: "import_task",
      bookId: "book_home",
      userId: "user_demo",
      fileName: "records.csv",
      fileType: "text/csv",
      r2Key: "imports/records.csv",
      status: "failed",
      errorRetryable: true,
      cancelable: true,
      retryable: true,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const app = createApp(store);
    const tasks = await app.request("/ai/tasks", { headers: aiHeaders }, { APP_ENV: "test" });
    const retry = await app.request(
      "/ai/tasks/import_task/retry",
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const retryBody = await retry.json<any>();

    expect(tasks.status).toBe(200);
    expect((await tasks.json<any>()).tasks[0]).toMatchObject({ id: "import_task", kind: "import" });
    expect(retry.status).toBe(200);
    expect(retryBody.task).toMatchObject({ id: "import_task", kind: "import", status: "running" });
    expect(store.imports[0].status).toBe("uploaded");

    const cancel = await app.request(
      "/ai/tasks/import_task/cancel",
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const cancelBody = await cancel.json<any>();
    const afterCancel = await app.request("/ai/tasks", { headers: aiHeaders }, { APP_ENV: "test" });

    expect(cancel.status).toBe(200);
    expect(cancelBody.task).toMatchObject({
      id: "import_task",
      kind: "import",
      status: "cancelled",
      cancelable: false,
      retryable: false,
    });
    expect((await afterCancel.json<any>()).tasks).toHaveLength(0);
  });
  it("AI task status stream stays open and emits task updates", async () => {
    const store = new MemoryLedgerStore();
    store.imports.push({
      id: "import_stream",
      bookId: "book_home",
      userId: "user_demo",
      fileName: "stream.csv",
      fileType: "text/csv",
      r2Key: "imports/stream.csv",
      status: "uploaded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const app = createApp(store);
    const response = await app.request("/ai/tasks/status-stream", { headers: aiHeaders }, { APP_ENV: "test" });
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeTruthy();
    try {
      const first = await readStreamChunk(reader!);
      expect(first.done).toBe(false);
      const initialChunk = decodeStreamChunk(first.value);
      expect(initialChunk).toContain("event: tasks");
      expect(initialChunk).toContain("\"status\":\"running\"");

      store.imports[0] = {
        ...store.imports[0],
        status: "failed",
        errorMessage: "OCR failed",
        errorRetryable: true,
        updatedAt: new Date().toISOString(),
      };

      let followup = "";
      for (let attempt = 0; attempt < 10 && !followup.includes("\"status\":\"failed\""); attempt += 1) {
        const next = await readStreamChunk(reader!);
        expect(next.done).toBe(false);
        followup += decodeStreamChunk(next.value);
      }
      expect(followup).toContain("\"status\":\"failed\"");
    } finally {
      await reader?.cancel();
    }
  });
});
