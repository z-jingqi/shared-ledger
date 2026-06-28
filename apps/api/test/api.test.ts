import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
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

async function createAiSession(app: ReturnType<typeof createApp>, bookId = "book_home") {
  const response = await app.request(
    "/ai/sessions",
    { method: "POST", body: JSON.stringify({ bookId, title: "新会话" }), headers: aiHeaders },
    { APP_ENV: "test" },
  );
  expect(response.status).toBe(201);
  return (await response.json<any>()).session as { id: string; title: string };
}

async function sendAiMessage(app: ReturnType<typeof createApp>, sessionId: string, message: string, bookId = "book_home") {
  const response = await app.request(
    `/ai/sessions/${sessionId}/messages`,
    { method: "POST", body: JSON.stringify({ bookId, message, page: "test" }), headers: aiHeaders },
    { APP_ENV: "test" },
  );
  expect(response.status).toBe(200);
  return response.json<any>();
}

describe("Hono REST API", () => {
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
    expect(renamedBody.user).toMatchObject({ id: "user_demo", name: "SoundOnly", email: "soundonly@example.com" });
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
    expect((await createApp().request("/imports/status-stream?ids=import_test", undefined, { APP_ENV: "test" })).status).toBe(401);
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
    const fetched = await app.request(`/ai/sessions/${session.id}`, { headers: aiHeaders }, { APP_ENV: "test" });
    const deleted = await app.request(`/ai/sessions/${session.id}`, { method: "DELETE", headers: aiHeaders }, { APP_ENV: "test" });

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
    expect(store.transactions.some((transaction) => transaction.note === "打车" && transaction.amount === 38)).toBe(true);
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
      tagIds: [],
      items: [],
    });
    const search = await app.request(
      "/ai/search/transactions",
      {
        method: "POST",
        body: JSON.stringify({ bookId: "book_home", query: "金额小于30的数据", baseFilters: { sort: "latest" } }),
        headers: aiHeaders,
      },
      { APP_ENV: "test" },
    );
    const searchBody = await search.json<any>();
    expect(search.status).toBe(200);
    expect(searchBody.filters).toMatchObject({ maxAmount: 30, maxStrict: true, sort: "date_desc" });
    expect(searchBody.results.map((item: any) => item.id)).toEqual(["tx_small_expense"]);

    const analysis = await sendAiMessage(app, session.id, "在你看来有什么不合理的支出吗？");
    expect(analysis.parts.some((part: any) => part.type === "analysis-card")).toBe(true);
    expect(JSON.stringify(analysis.parts)).not.toContain("我可以帮你记账、搜索、分析或邀请成员");

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
    const inviteConfirmationId = invite.parts.find((part: any) => part.type === "confirmation-card").confirmation.id;
    expect(store.invitations).toHaveLength(0);
    const confirmed = await app.request(`/ai/confirmations/${inviteConfirmationId}/confirm`, { method: "POST", headers: aiHeaders }, { APP_ENV: "test" });
    expect(confirmed.status).toBe(200);
    expect(store.invitations).toHaveLength(1);

    await sendAiMessage(app, session.id, "创建一个支出分类 医疗");
    const deleteCategory = await sendAiMessage(app, session.id, "删除分类 医疗");
    const deleteConfirmationId = deleteCategory.parts.find((part: any) => part.type === "confirmation-card").confirmation.id;
    const cancelled = await app.request(`/ai/confirmations/${deleteConfirmationId}/cancel`, { method: "POST", headers: aiHeaders }, { APP_ENV: "test" });
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
      { method: "POST", body: JSON.stringify({ bookId: "book_home", message: "讲个笑话" }), headers: aiHeaders },
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
      expect(output).toContain("event: tool_call");
      expect(output).toContain("event: message_delta");
      expect(output).toContain("event: done");
    } finally {
      await reader?.cancel();
    }
  });
});
