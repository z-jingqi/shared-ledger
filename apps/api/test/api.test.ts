import { describe, expect, it } from "vitest";
import { AlephAIError, type AlephAIClient, type InvokeRequest } from "@shared-ledger/ai";
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

function recordingAlephClient(options?: {
  invokeOutput?: unknown | ((request: any) => unknown);
  invokeError?: Error;
  streamText?: string;
  streamError?: Error;
  usage?: Awaited<ReturnType<AlephAIClient["getUserUsage"]>>;
}) {
  const requests: any[] = [];
  const client: AlephAIClient = {
    async invoke<TOutput = unknown>(request: InvokeRequest) {
      requests.push(request);
      if (options?.invokeError) throw options.invokeError;
      const output =
        typeof options?.invokeOutput === "function"
          ? options.invokeOutput(request)
          : (options?.invokeOutput ?? defaultAiInvokeOutput(request));
      return {
        requestId: "test-invoke",
        status: "ok",
        route: "test-route",
        provider: "test",
        model: "test-model",
        usage: { inputTokens: 1, outputTokens: 1, creditsCharged: 1 },
        output: output as TOutput,
      };
    },
    async *stream(request: InvokeRequest) {
      requests.push(request);
      if (options?.streamError) throw options.streamError;
      yield {
        type: "route",
        requestId: "test-stream",
        route: { id: "test-route", name: "test-route", provider: "test", model: "test-model" },
      };
      for (const char of options?.streamText ?? "Aleph says hi")
        yield { type: "delta", requestId: "test-stream", delta: char };
      yield {
        type: "usage",
        requestId: "test-stream",
        usage: { inputTokens: 1, outputTokens: 1, creditsCharged: 1 },
      };
      yield { type: "done", requestId: "test-stream" };
    },
    async getUserUsage(params: { project: string; userId: string; plan?: string; env?: string }) {
      return (
        options?.usage ?? {
          project: params.project,
          userId: params.userId,
          plan: params.plan ?? "free",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-07-01T00:00:00.000Z",
          credits: { used: 3, limit: 100, remaining: 97 },
          requests: { used: 2, limit: 30, remaining: 28 },
        }
      );
    },
  };
  return { client, requests };
}

function defaultAiInvokeOutput(request: InvokeRequest) {
  const name = responseFormatName(request);
  if (name === "ledger_skill_selection") return { skillName: "general.chat", confidence: 1 };
  if (name === "ledger_skill_step")
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

function responseFormatName(request: InvokeRequest) {
  return (request.input.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema
    ?.name;
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
  const session = await createAiSession(app);
  return app.request(
    `/ai/sessions/${session.id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ bookId: "book_home", message: query, page: "records" }),
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
    const init = {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
      headers: jsonHeaders,
    };

    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(201);
    expect((await app.request("/books/book_home/invitations", init, { APP_ENV: "test" })).status).toBe(409);
    expect(
      (await createApp().request("/imports/status-stream?ids=import_test", undefined, { APP_ENV: "test" }))
        .status,
    ).toBe(401);
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

  it("routes chat streams through Aleph ledger.chat after skill selection", async () => {
    const store = new MemoryLedgerStore();
    const app = createApp(store);
    const { client, requests } = recordingAlephClient({ streamText: "来自 Aleph" });
    const env = {
      APP_ENV: "test",
      ALEPH_AI_TEST_CLIENT: client,
      AI_PROVIDER_KEYS: '{"openrouter":"legacy"}',
      AI_MODEL: "legacy-model",
      OPENROUTER_API_KEY: "legacy-key",
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
    const objectRequest = requests.find((item) => item.task === "ledger.skill_select");
    const streamRequest = requests.find((item) => item.task === "ledger.chat");

    expect(response.status).toBe(200);
    expect(output).toContain("event: message_delta");
    expect(output).toContain("来自");
    expect(objectRequest).toMatchObject({
      project: "shared-ledger",
      env: "test",
      task: "ledger.skill_select",
      mode: "object",
    });
    expect(streamRequest).toMatchObject({
      project: "shared-ledger",
      env: "test",
      task: "ledger.chat",
      mode: "stream",
    });
    expect(JSON.stringify(requests)).not.toContain("legacy-model");
    expect(JSON.stringify(requests)).not.toContain("openrouter");
    expect(objectRequest.input.model).toBeUndefined();
    expect(streamRequest.input.model).toBeUndefined();
  });

  it("routes record AI search through skill selection and skill step planning", async () => {
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
    const { client, requests } = recordingAlephClient({
      invokeOutput: (request: InvokeRequest) =>
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
      ALEPH_AI_TEST_CLIENT: client,
    });
    const selectRequest = requests.find((item) => item.task === "ledger.skill_select");
    const stepRequest = requests.find((item) => item.task === "ledger.skill_step");
    const body = await response.json<any>();
    const filterPart = body.parts.find((part: any) => part.type === "filter-result");

    expect(response.status).toBe(200);
    expect(filterPart.filters).toMatchObject({ maxAmount: 30, maxStrict: true, sort: "date_desc" });
    expect(selectRequest).toMatchObject({
      project: "shared-ledger",
      task: "ledger.skill_select",
      mode: "object",
    });
    expect(stepRequest).toMatchObject({
      project: "shared-ledger",
      task: "ledger.skill_step",
      mode: "object",
    });
    expect(responseFormatName(stepRequest)).toBe("ledger_skill_step");
    expect(stepRequest.input.model).toBeUndefined();
    expect(stepRequest.input.metadata).toBeUndefined();
  });

  it("returns Aleph usage from the current user usage endpoint", async () => {
    const app = createApp(new MemoryLedgerStore());
    const { client } = recordingAlephClient({
      usage: {
        project: "shared-ledger",
        userId: "user_demo",
        plan: "free",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        credits: { used: 8, limit: 100, remaining: 92 },
        requests: { used: 4, limit: 30, remaining: 26 },
      },
    });
    const response = await app.request(
      "/me/ai-usage",
      { headers: aiHeaders },
      { APP_ENV: "test", ALEPH_AI_TEST_CLIENT: client },
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      project: "shared-ledger",
      userId: "user_demo",
      credits: { used: 8, remaining: 92 },
    });
  });

  it("propagates Aleph quota_exceeded for JSON and SSE AI endpoints", async () => {
    const app = createApp(new MemoryLedgerStore());
    const quotaError = new AlephAIError("quota_exceeded", "额度已用完", { requestId: "aleph_quota_1" });
    const { client } = recordingAlephClient({ invokeError: quotaError });
    const env = { APP_ENV: "test", ALEPH_AI_TEST_CLIENT: client };
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
      requestId: "aleph_quota_1",
    });
    expect(output).toContain("event: error");
    expect(output).toContain("quota_exceeded");
    expect(output).toContain("aleph_quota_1");
  });

  it("routes import structuring through Aleph object planning", async () => {
    const { client, requests } = recordingAlephClient({
      invokeOutput: {
        records: [
          {
            type: "expense",
            amount: 12,
            occurredAt: "2026-06-27",
            note: "早餐",
            confidence: 0.9,
            warnings: [],
          },
        ],
      },
    });
    const ai = runtimeAiProvider(
      { APP_ENV: "test", ALEPH_AI_TEST_CLIENT: client },
      { id: "user_demo", plan: "pro" },
    );
    const records = await structureForConfirmation({
      bookId: "book_home",
      userId: "user_demo",
      normalized: { rawText: "早餐 12 元", warnings: ["OCR 置信度较低"] },
      ai,
    });
    const request = requests[0];

    expect(records[0]).toMatchObject({ type: "expense", amount: 12, warnings: ["OCR 置信度较低"] });
    expect(request).toMatchObject({
      project: "shared-ledger",
      task: "ledger.skill_step",
      mode: "object",
      user: { id: "user_demo", plan: "pro" },
    });
    expect(responseFormatName(request)).toBe("ledger_import_records");
    expect(request.input.model).toBeUndefined();
  });
});
