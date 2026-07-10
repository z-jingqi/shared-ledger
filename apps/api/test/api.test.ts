import { describe, expect, it } from "vitest";
import { LedgerAIError, type LedgerAiTestClient } from "@shared-ledger/ai";
import { structureForConfirmation } from "@shared-ledger/import";
import worker, { createApp } from "../src/index";
import { runtimeAiProvider } from "../src/services/ai";
import { MemoryLedgerStore } from "../src/store";

const jsonHeaders = { "Content-Type": "application/json" };
const aiHeaders = { ...jsonHeaders, "X-AI-Test-Memory": "true" };
const request = (path: string, init?: RequestInit) =>
  createApp(new MemoryLedgerStore()).request(path, init, { APP_ENV: "test" });
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

type TestObjectRequest = Parameters<LedgerAiTestClient["generateObject"]>[0];

function recordingAiClient(options?: {
  objectOutput?: unknown | ((request: TestObjectRequest) => unknown);
  objectError?: Error;
  streamText?: string;
  streamError?: Error;
}) {
  const requests: TestObjectRequest[] = [];
  const client: LedgerAiTestClient = {
    async generateObject<TOutput = unknown>(request: TestObjectRequest) {
      requests.push(request);
      if (options?.objectError) throw options.objectError;
      const output =
        typeof options?.objectOutput === "function"
          ? options.objectOutput(request)
          : (options?.objectOutput ?? defaultAiObjectOutput(request));
      return output as TOutput;
    },
    async *streamText() {
      if (options?.streamError) throw options.streamError;
      for (const char of options?.streamText ?? "AI says hi") yield char;
    },
    async generateText() {
      return options?.streamText ?? "AI says hi";
    },
  };
  return { client, requests };
}

function defaultAiObjectOutput(request: TestObjectRequest) {
  if (request.schemaName === "import_receipt_summary")
    return {
      type: "expense",
      amount: 1,
      occurredAt: "2026-06-28",
      confidence: 0.9,
      warnings: [],
    };
  if (request.schemaName === "import_items_chunk") return { items: [], confidence: 0.9, warnings: [] };
  if (request.schemaName === "ledger_skill_selection") return { skillName: "general.chat", confidence: 1 };
  if (request.schemaName === "ledger_skill_step")
    return {
      skillName: "general.chat",
      toolName: "chat",
      args: {},
      userMessage: "ok",
      confidence: 1,
      requiresConfirmation: false,
    };
  return { records: [] };
}

function responseFormatName(request: TestObjectRequest | undefined) {
  return request?.schemaName;
}

function requestPayload(request: TestObjectRequest) {
  return JSON.parse(request.prompt) as Record<string, unknown>;
}

async function createAiSession(app: ReturnType<typeof createApp>, bookId = "book_home") {
  const response = await app.request(
    "/ai/sessions",
    { method: "POST", body: JSON.stringify({ bookId, title: "新会话" }), headers: aiHeaders },
    { APP_ENV: "test" },
  );
  expect(response.status).toBe(201);
  return (await response.json<any>()).session as { id: string; title: string };
}

async function sendAiMessage(
  app: ReturnType<typeof createApp>,
  sessionId: string,
  message: string,
  bookId = "book_home",
) {
  const response = await app.request(
    `/ai/sessions/${sessionId}/messages`,
    { method: "POST", body: JSON.stringify({ bookId, message, page: "test" }), headers: aiHeaders },
    { APP_ENV: "test" },
  );
  expect(response.status).toBe(200);
  return response.json<any>();
}

async function searchWithAgent(
  app: ReturnType<typeof createApp>,
  query: string,
  env: Record<string, unknown> = { APP_ENV: "test" },
) {
  return app.request(
    "/ai/records/search",
    {
      method: "POST",
      body: JSON.stringify({ bookId: "book_home", query, page: "records" }),
      headers: aiHeaders,
    },
    env,
  );
}

async function readSse(response: Response) {
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();
  let output = "";
  try {
    for (
      let attempt = 0;
      attempt < 80 && !output.includes("event: done") && !output.includes("event: error");
      attempt += 1
    ) {
      const chunk = await readStreamChunk(reader!, 1000);
      if (chunk.done) break;
      output += decodeStreamChunk(chunk.value);
    }
  } finally {
    await reader?.cancel();
  }
  return output;
}

describe("Hono REST API", () => {
  it("strips the /api prefix at the worker edge", async () => {
    const response = await worker.fetch(
      new Request("https://dev.leger.aleph-cat.com/api/health") as any,
      { APP_ENV: "test" } as any,
      {} as any,
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, environment: "test" });
  });

  it("creates a book and validates transaction line-item totals", async () => {
    const created = await request("/books", {
      method: "POST",
      body: JSON.stringify({ name: "旅行账本", currency: "CNY" }),
      headers: jsonHeaders,
    });
    const invalidTransaction = await request("/books/book_home/transactions", {
      method: "POST",
      body: JSON.stringify({
        type: "expense",
        amount: 10,
        occurredAt: "2026-01-01",
        items: [{ name: "a", amount: 9 }],
      }),
      headers: jsonHeaders,
    });

    expect(created.status).toBe(201);
    expect(invalidTransaction.status).toBe(400);
  });

  it("updates the current user's avatar in the test runtime", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const form = new FormData();
    form.set("avatar", new File(["avatar"], "avatar.png", { type: "image/png" }));

    const response = await app.request("/auth/me/avatar", { method: "PUT", body: form }, { APP_ENV: "test" });
    const body = await response.json<any>();
    const me = await app.request("/auth/me", undefined, { APP_ENV: "test" });
    const meBody = await me.json<any>();

    expect(response.status).toBe(200);
    expect(body.user.avatarUrl).toMatch(/^data:image\/png;base64,/);
    expect(store.users[0].avatarUrl).toBe(body.user.avatarUrl);
    expect(meBody.user.avatarUrl).toBe(body.user.avatarUrl);
  });

  it("updates the current user's profile and rejects duplicates in the test runtime", async () => {
    const store = new MemoryLedgerStore();
    store.users.push({ id: "user_other", name: "李四", email: "other@ledger.local", plan: "free" });
    const app = createApp(store);

    const renamed = await app.request(
      "/auth/me/profile",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "SoundOnly", email: "soundonly@example.com" }),
        headers: jsonHeaders,
      },
      { APP_ENV: "test" },
    );
    const renamedBody = await renamed.json<any>();

    expect(renamed.status).toBe(200);
    expect(renamedBody.user).toMatchObject({
      id: "user_demo",
      name: "SoundOnly",
      email: "soundonly@example.com",
    });
    expect(store.users[0]).toMatchObject({ name: "SoundOnly", email: "soundonly@example.com" });

    const duplicateName = await app.request(
      "/auth/me/profile",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "李四", email: "soundonly@example.com" }),
        headers: jsonHeaders,
      },
      { APP_ENV: "test" },
    );
    const duplicateEmail = await app.request(
      "/auth/me/profile",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "SoundOnly", email: "other@ledger.local" }),
        headers: jsonHeaders,
      },
      { APP_ENV: "test" },
    );

    expect(duplicateName.status).toBe(409);
    expect((await duplicateName.json<any>()).error).toBe("用户名已被使用");
    expect(duplicateEmail.status).toBe(409);
    expect((await duplicateEmail.json<any>()).error).toBe("邮箱已被其他用户使用");
  });

  it("accepts password changes in the test runtime and rejects anonymous password updates", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);

    const response = await app.request(
      "/auth/me/password",
      {
        method: "PUT",
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
        headers: jsonHeaders,
      },
      { APP_ENV: "test" },
    );
    const anonymous = await createApp().request(
      "/auth/me/password",
      {
        method: "PUT",
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
        headers: jsonHeaders,
      },
      { APP_ENV: "test" },
    );

    expect(response.status).toBe(204);
    expect(anonymous.status).toBe(401);
  });

  it("prevents duplicate pending invitations and rejects anonymous import status streams", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const invitee = store.createUser("Invitee", "invitee@example.com");
    const init = {
      method: "POST",
      body: JSON.stringify({ userId: invitee.id, role: "member" }),
      headers: jsonHeaders,
    };

    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(201);
    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(409);
    expect(
      (await createApp().request("/imports/status-stream?ids=import_test", undefined, { APP_ENV: "test" }))
        .status,
    ).toBe(401);
  });

  it("searches registered users, blocks invite search, and deletes handled invitation history", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const invitee = store.createUser("Target User", "target@example.com");

    const partialSearch = await app.request("/users/search?query=Target", undefined, { APP_ENV: "test" });
    expect((await partialSearch.json<any>()).users).toEqual([]);

    const search = await app.request("/users/search?query=Target%20User", undefined, { APP_ENV: "test" });
    expect(search.status).toBe(200);
    expect((await search.json<any>()).users).toEqual([
      expect.objectContaining({ id: invitee.id, name: "Target User" }),
    ]);

    const invited = await app.request(
      "/books/book_home/invitations",
      { method: "POST", body: JSON.stringify({ userId: invitee.id, role: "member" }), headers: jsonHeaders },
      { APP_ENV: "test" },
    );
    expect(invited.status).toBe(201);
    const invitation = (await invited.json<any>()).invitation;

    const pendingDelete = await app.request(
      `/invitations/${invitation.id}`,
      { method: "DELETE", headers: jsonHeaders },
      { APP_ENV: "test" },
    );
    expect(pendingDelete.status).toBe(400);

    const listed = await app.request("/invitations", undefined, { APP_ENV: "test" });
    expect((await listed.json<any>()).invitations[0]).toMatchObject({
      book: expect.objectContaining({ name: "家庭账本" }),
      invitee: expect.objectContaining({ name: "Target User" }),
      inviter: expect.objectContaining({ name: "张三" }),
      direction: "sent",
    });

    const declined = await app.request(
      `/invitations/${invitation.id}/decline`,
      {
        method: "POST",
        body: JSON.stringify({ blockInviter: true }),
        headers: { ...jsonHeaders, "x-user-id": invitee.id },
      },
      { APP_ENV: "test" },
    );
    expect(declined.status).toBe(200);
    expect(store.inviteBlocks).toContainEqual(
      expect.objectContaining({ blockerUserId: invitee.id, blockedUserId: "user_demo" }),
    );

    const hiddenAfterBlock = await app.request("/users/search?query=Target%20User", undefined, {
      APP_ENV: "test",
    });
    expect((await hiddenAfterBlock.json<any>()).users).toEqual([]);

    const blockedInvite = await app.request(
      "/books/book_home/invitations",
      { method: "POST", body: JSON.stringify({ userId: invitee.id, role: "admin" }), headers: jsonHeaders },
      { APP_ENV: "test" },
    );
    expect(blockedInvite.status).toBe(403);

    const deleted = await app.request(
      `/invitations/${invitation.id}`,
      { method: "DELETE", headers: jsonHeaders },
      { APP_ENV: "test" },
    );
    expect(deleted.status).toBe(204);
  });

  it("creates, lists, renames, reads, and deletes AI sessions for free users", async () => {
    const app = createApp(new MemoryLedgerStore());
    const session = await createAiSession(app);
    const listed = await app.request("/ai/sessions", { headers: aiHeaders }, { APP_ENV: "test" });
    const renamed = await app.request(
      `/ai/sessions/${session.id}`,
      { method: "PATCH", body: JSON.stringify({ title: "账本分析" }), headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const fetched = await app.request(
      `/ai/sessions/${session.id}`,
      { headers: aiHeaders },
      { APP_ENV: "test" },
    );
    const deleted = await app.request(
      `/ai/sessions/${session.id}`,
      { method: "DELETE", headers: aiHeaders },
      { APP_ENV: "test" },
    );

    expect(listed.status).toBe(200);
    expect((await listed.json<any>()).sessions).toHaveLength(1);
    expect((await renamed.json<any>()).session.title).toBe("账本分析");
    expect((await fetched.json<any>()).session.messages).toEqual([]);
    expect(deleted.status).toBe(204);
  });

  it("runs AI tools for transactions, search, analysis, categories, and profile updates", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const session = await createAiSession(app);

    const created = await sendAiMessage(app, session.id, "昨天打车 38");
    expect(
      store.transactions.some((transaction) => transaction.note === "打车" && transaction.amount === 38),
    ).toBe(true);
    expect(created.parts.some((part: any) => part.type === "record-card")).toBe(true);

    store.transactions.push({
      id: "tx_small_expense",
      bookId: "book_home",
      type: "expense",
      amount: 18,
      categoryId: "cat_food",
      createdByUserId: "user_demo",
      memberId: "member_demo",
      note: "早餐",
      occurredAt: "2026-06-21T08:00:00.000Z",
      items: [],
    });
    const search = await searchWithAgent(app, "金额小于30的数据");
    const searchBody = await search.json<any>();
    expect(search.status).toBe(200);
    const filterPart = searchBody.parts.find((part: any) => part.type === "filter-result");
    const resultPart = searchBody.parts.find((part: any) => part.type === "search-result-card");
    expect(filterPart.filters).toMatchObject({ maxAmount: 30, maxStrict: true, sort: "date_desc" });
    expect(resultPart.results.map((item: any) => item.id)).toEqual(["tx_small_expense"]);

    const analysis = await sendAiMessage(app, session.id, "在你看来有什么不合理的支出吗？");
    expect(analysis.parts.some((part: any) => part.type === "analysis-card")).toBe(true);
    expect(JSON.stringify(analysis.parts)).not.toContain("请告诉我你想做什么");

    const category = await sendAiMessage(app, session.id, "创建一个支出分类 医疗");
    expect(store.categories.some((item) => item.name === "医疗")).toBe(true);
    expect(category.parts[0].text).toContain("已创建分类");

    const profile = await sendAiMessage(app, session.id, "把我的用户名改成 SoundOnly2");
    expect(store.users[0].name).toBe("SoundOnly2");
    expect(profile.parts.some((part: any) => part.type === "profile-card")).toBe(true);
  });

  it("uses confirmations for destructive AI tools and invitations", async () => {
    const store = new MemoryLedgerStore();
    store.createUser("Confirm User", "confirm@example.com");
    const app = createApp(store);
    const session = await createAiSession(app);

    const invite = await sendAiMessage(app, session.id, "邀请 confirm@example.com");
    const inviteConfirmationId = invite.parts.find((part: any) => part.type === "confirmation-card")
      .confirmation.id;
    expect(store.invitations).toHaveLength(0);
    const confirmed = await app.request(
      `/ai/confirmations/${inviteConfirmationId}/confirm`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    expect(confirmed.status).toBe(200);
    expect(store.invitations).toHaveLength(1);

    await sendAiMessage(app, session.id, "创建一个支出分类 医疗");
    const deleteCategory = await sendAiMessage(app, session.id, "删除分类 医疗");
    const deleteConfirmationId = deleteCategory.parts.find((part: any) => part.type === "confirmation-card")
      .confirmation.id;
    const cancelled = await app.request(
      `/ai/confirmations/${deleteConfirmationId}/cancel`,
      { method: "POST", headers: aiHeaders },
      { APP_ENV: "test" },
    );
    expect(cancelled.status).toBe(200);
    expect(store.categories.some((item) => item.name === "医疗")).toBe(true);

    const expiring = store.aiConfirmations.find((confirmation) => confirmation.id === deleteConfirmationId);
    expect(expiring?.status).toBe("cancelled");
  });

  it("streams AI message deltas and final structured done events", async () => {
    const app = createApp(new MemoryLedgerStore());
    const session = await createAiSession(app);
    const response = await app.request(
      `/ai/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "讲个笑话" }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeTruthy();
    try {
      let output = "";
      for (let attempt = 0; attempt < 80 && !output.includes("event: done"); attempt += 1) {
        const chunk = await readStreamChunk(reader!, 1000);
        expect(chunk.done).toBe(false);
        output += decodeStreamChunk(chunk.value);
      }
      expect(output).toContain("event: skill_selected");
      expect(output).toContain("event: message_delta");
      expect(output).toContain("event: done");
    } finally {
      await reader?.cancel();
    }
  });

  it("routes chat streams through the configured AI client after skill selection", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const { client, requests } = recordingAiClient({ streamText: "来自 AI" });
    const env = {
      APP_ENV: "test",
      AI_TEST_CLIENT: client,
    } as any;
    const sessionResponse = await app.request(
      "/ai/sessions",
      { method: "POST", body: JSON.stringify({ bookId: "book_home", title: "新会话" }), headers: aiHeaders },
      env,
    );
    const session = (await sessionResponse.json<any>()).session;
    const response = await app.request(
      `/ai/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "讲个笑话" }),
        headers: aiHeaders,
      },
      env,
    );
    const output = await readSse(response);
    const objectRequest = requests.find((item) => item.schemaName === "ledger_skill_selection");

    expect(response.status).toBe(200);
    expect(output).toContain("event: message_delta");
    expect(output).toContain("来自");
    expect(objectRequest?.schemaName).toBe("ledger_skill_selection");
    expect(JSON.stringify(requests)).not.toContain("legacy-model");
    expect(JSON.stringify(requests)).not.toContain("openrouter");
  });

  it("streams tool results once without replaying tool text as message deltas", async () => {
    const store = new MemoryLedgerStore();
    store.transactions.push({
      id: "tx_dinner",
      bookId: "book_home",
      type: "expense",
      amount: 50,
      categoryId: "cat_food",
      createdByUserId: "user_demo",
      memberId: "member_demo",
      note: "吃饭",
      occurredAt: "2026-07-02T12:00:00.000Z",
      items: [],
    });
    const app = createApp(store);
    const { client } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) =>
        responseFormatName(request) === "ledger_skill_selection"
          ? { skillName: "ledger.analysis", confidence: 1 }
          : {
              skillName: "ledger.analysis",
              toolName: "analyze-records",
              args: { type: "expense", from: "2026-07-01", to: "2026-07-31" },
              confidence: 1,
              requiresConfirmation: false,
              isFinal: false,
            },
    });
    const env = { APP_ENV: "test", AI_TEST_CLIENT: client };
    const sessionResponse = await app.request(
      "/ai/sessions",
      { method: "POST", body: JSON.stringify({ bookId: "book_home", title: "新会话" }), headers: aiHeaders },
      env,
    );
    const session = (await sessionResponse.json<any>()).session;
    const response = await app.request(
      `/ai/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "我这个月的支出情况" }),
        headers: aiHeaders,
      },
      env,
    );
    const output = await readSse(response);

    expect(output.match(/event: tool_result/g)).toHaveLength(1);
    expect(output).not.toContain("event: message_delta");
    expect(output.match(/event: step_started/g)).toHaveLength(1);
    expect(output.match(/event: tool_call/g)).toHaveLength(1);
    expect(output).toContain("当前范围内支出 ¥50.00");
  });

  it("routes record AI search through one-shot skill selection and step planning without creating a session", async () => {
    const store = new MemoryLedgerStore();
    store.transactions.push({
      id: "tx_small_expense",
      bookId: "book_home",
      type: "expense",
      amount: 18,
      categoryId: "cat_food",
      createdByUserId: "user_demo",
      memberId: "member_demo",
      note: "早餐",
      occurredAt: "2026-06-21T08:00:00.000Z",
      items: [],
    });
    const app = createApp(store);
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) =>
        responseFormatName(request) === "ledger_skill_selection"
          ? { skillName: "ledger.search", confidence: 1 }
          : {
              skillName: "ledger.search",
              toolName: "search-records",
              args: { maxAmount: 30, maxStrict: true, sort: "date_desc" },
              confidence: 1,
              requiresConfirmation: false,
            },
    });
    const response = await searchWithAgent(app, "金额小于30的数据", {
      APP_ENV: "test",
      AI_TEST_CLIENT: client,
    });
    const selectRequest = requests.find((item) => item.schemaName === "ledger_skill_selection");
    const stepRequest = requests.find((item) => item.schemaName === "ledger_skill_step");
    const body = await response.json<any>();
    const filterPart = body.parts.find((part: any) => part.type === "filter-result");

    expect(response.status).toBe(200);
    expect(filterPart.filters).toMatchObject({ maxAmount: 30, maxStrict: true, sort: "date_desc" });
    expect(selectRequest?.schemaName).toBe("ledger_skill_selection");
    expect(stepRequest?.schemaName).toBe("ledger_skill_step");
    expect(responseFormatName(stepRequest)).toBe("ledger_skill_step");
    expect((store as any).aiSessions ?? []).toHaveLength(0);
    expect((store as any).aiMessages ?? []).toHaveLength(0);
  });

  it("does not run record search for casual one-shot AI search text even if skill selection is wrong", async () => {
    const app = createApp(new MemoryLedgerStore());
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) =>
        responseFormatName(request) === "ledger_skill_selection"
          ? { skillName: "ledger.search", confidence: 1 }
          : {
              skillName: "ledger.search",
              toolName: "search-records",
              args: { type: "expense" },
              confidence: 1,
              requiresConfirmation: false,
            },
    });
    const response = await searchWithAgent(app, "hi", {
      APP_ENV: "test",
      AI_TEST_CLIENT: client,
    });
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.noSearch).toBe(true);
    expect(body.parts[0].text).toContain("不是流水搜索条件");
    expect(requests.filter((item) => item.schemaName === "ledger_skill_selection")).toHaveLength(1);
    expect(requests.some((item) => item.schemaName === "ledger_skill_step")).toBe(false);
  });

  it("returns the current configured AI capability from the usage endpoint", async () => {
    const app = createApp(new MemoryLedgerStore());
    const { client } = recordingAiClient();
    const response = await app.request(
      "/me/ai-usage",
      { headers: aiHeaders },
      { APP_ENV: "test", AI_TEST_CLIENT: client },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "test",
      model: "test-model",
      quota: null,
      usage: null,
    });
  });

  it("propagates quota_exceeded for JSON and SSE AI endpoints", async () => {
    const app = createApp(new MemoryLedgerStore());
    const quotaError = new LedgerAIError("quota_exceeded", "额度已用完", { requestId: "ai_quota_1" });
    const { client } = recordingAiClient({ objectError: quotaError });
    const env = { APP_ENV: "test", AI_TEST_CLIENT: client };
    const session = await createAiSession(app);
    const json = await app.request(
      `/ai/sessions/${session.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "查一下" }),
        headers: aiHeaders,
      },
      env,
    );
    const stream = await app.request(
      `/ai/sessions/${session.id}/messages/stream`,
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", message: "讲个笑话" }),
        headers: aiHeaders,
      },
      env,
    );
    const jsonBody = await json.json<any>();
    const output = await readSse(stream);

    expect(json.status).toBe(429);
    expect(jsonBody).toMatchObject({
      error: "额度已用完",
      code: "quota_exceeded",
      requestId: "ai_quota_1",
    });
    expect(output).toContain("event: error");
    expect(output).toContain("quota_exceeded");
    expect(output).toContain("ai_quota_1");
  });

  it("routes import structuring through the configured object planner", async () => {
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) =>
        responseFormatName(request) === "import_receipt_summary"
          ? {
              type: "expense",
              amount: 12,
              occurredAt: "2026-06-27",
              note: "早餐",
              categoryName: "餐饮",
              confidence: 0.9,
              warnings: [],
            }
          : {
              items: [{ name: "豆浆", amount: 12, categoryName: "餐饮" }],
              confidence: 0.88,
              warnings: [],
            },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: { rawText: "早餐 12 元", warnings: ["OCR 置信度较低"] },
      ai,
    });
    const [summaryRequest, itemsRequest] = requests;

    expect(records[0]).toMatchObject({
      type: "expense",
      amount: 12,
      categoryName: "餐饮",
      items: [{ name: "豆浆", amount: 12, categoryName: "餐饮" }],
      warnings: ["OCR 置信度较低"],
    });
    expect(responseFormatName(summaryRequest)).toBe("import_receipt_summary");
    expect(responseFormatName(itemsRequest)).toBe("import_items_chunk");
    expect(summaryRequest?.maxOutputTokens).toBe(900);
    expect(itemsRequest?.maxOutputTokens).toBe(1800);
    expect(requestPayload(itemsRequest).receiptContext).toMatchObject({
      type: "expense",
      amount: 12,
      occurredAt: "2026-06-27",
      note: "早餐",
    });
    expect(requests.some((request) => request.maxOutputTokens === 5000)).toBe(false);
  });

  it("fills deterministic receipt fields when the model omits the merchant note", async () => {
    const { client } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) =>
        responseFormatName(request) === "import_receipt_summary"
          ? {
              type: "expense",
              amount: 99,
              occurredAt: "2026-01-01",
              confidence: 0.9,
              warnings: [],
            }
          : { items: [], confidence: 0.9, warnings: [] },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: {
        rawText: ["测试超市(演示店)欢迎您", "交易时间 2026-07-10 10:20:30", "应收 12.00", "实收 12.00"].join(
          "\n",
        ),
        warnings: [],
      },
      categories: [{ name: "购物", type: "expense" }],
      ai,
    });

    expect(records[0]).toMatchObject({
      amount: 12,
      occurredAt: "2026-07-10T10:20:30",
      note: "测试超市(演示店)",
      categoryName: "购物",
    });
    expect(records[0]?.warnings).toEqual([
      "AI 总金额与 OCR 实收金额不一致，已采用 OCR 实收金额",
      "AI 日期与 OCR 交易日期不一致，已采用 OCR 交易日期",
      "未提取到明确明细",
    ]);
  });

  it("uses generic OCR visual rows after the deterministic summary fallback", async () => {
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) => {
        if (responseFormatName(request) === "import_receipt_summary") {
          throw new LedgerAIError("provider_error", "No object generated");
        }
        return {
          items: [
            { name: "马铃薯", amount: 3.41, categoryName: "购物" },
            { name: "乐而雅卫生巾", amount: 15, categoryName: "日用品" },
          ],
          confidence: 0.88,
          warnings: [],
        };
      },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: {
        rawText: [
          "OCR markdown:",
          "OCR visual rows derived from Google Vision bounding boxes.",
          "[ROW 1] [x=100] 1234567890123 马铃薯 | [x=900] 3.77 | [x=1300] 0.904 | [x=1600] 3.41",
          "[ROW 2] [x=100] 1234567890124 乐而雅卫生巾 | [x=900] 7.50 | [x=1300] 2 | [x=1600] 15.00",
          "",
          "OCR plain text:",
          "永辉欢迎您",
          "交易时间 2026-06-24 19:36:01",
          "应收 18.41",
          "实收 18.41",
        ].join("\n"),
        warnings: [],
      },
      categories: [
        { name: "购物", type: "expense" },
        { name: "日用品", type: "expense" },
      ],
      ai,
    });

    expect(records[0]).toMatchObject({
      type: "expense",
      amount: 18.41,
      occurredAt: "2026-06-24T19:36:01",
      note: "永辉",
      categoryName: "购物",
      items: [
        { name: "马铃薯", amount: 3.41, categoryName: "购物" },
        { name: "乐而雅卫生巾", amount: 15, categoryName: "日用品" },
      ],
    });
    expect(records[0]?.warnings).toContain("AI 摘要解析失败，已使用 OCR 规则兜底");
    expect(requests.filter((request) => responseFormatName(request) === "import_items_chunk")).toHaveLength(
      1,
    );
    expect(String(requestPayload(requests[1]).text)).toContain("[ROW 1]");
    expect(String(requestPayload(requests[1]).text)).not.toContain("OCR plain text:");
  });

  it("splits long OCR imports into item chunks and deduplicates overlap", async () => {
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) => {
        const name = responseFormatName(request);
        if (name === "import_receipt_summary") {
          return {
            type: "expense",
            amount: 24,
            occurredAt: "2026-06-27",
            note: "超市",
            confidence: 0.9,
            warnings: [],
          };
        }
        const chunkIndex = Number(requestPayload(request).chunkIndex);
        return {
          items:
            chunkIndex === 1
              ? [{ name: "牛奶", amount: 12, categoryName: "食品" }]
              : [
                  { name: "牛奶", amount: 12, categoryName: "食品" },
                  { name: "面包", amount: 12, categoryName: "食品" },
                ],
          confidence: 0.85,
          warnings: [],
        };
      },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const rawText = Array.from({ length: 180 }, (_, index) => `商品 ${index + 1} 1.00`).join("\n");
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: { rawText, warnings: [] },
      ai,
    });

    expect(records[0]?.items).toEqual([
      { name: "牛奶", amount: 12, categoryName: "食品" },
      { name: "面包", amount: 12, categoryName: "食品" },
    ]);
    expect(requests.filter((request) => responseFormatName(request) === "import_items_chunk")).toHaveLength(
      2,
    );
    expect(requests.every((request) => request.maxOutputTokens !== 5000)).toBe(true);
  });

  it("bisects an import item chunk once when the model reports oversized input", async () => {
    let itemAttempts = 0;
    const { client, requests } = recordingAiClient({
      objectOutput: (request: TestObjectRequest) => {
        const name = responseFormatName(request);
        if (name === "import_receipt_summary") {
          return {
            type: "expense",
            amount: 10,
            occurredAt: "2026-06-27",
            confidence: 0.9,
            warnings: [],
          };
        }
        itemAttempts += 1;
        if (itemAttempts === 1) throw new LedgerAIError("input_too_large", "too large");
        return {
          items: [{ name: `商品${itemAttempts}`, amount: 5 }],
          confidence: 0.8,
          warnings: [],
        };
      },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: { rawText: "商品A 5\n商品B 5", warnings: [] },
      ai,
    });

    expect(records[0]?.items).toHaveLength(2);
    expect(requests.filter((request) => responseFormatName(request) === "import_items_chunk")).toHaveLength(
      3,
    );
  });
});
