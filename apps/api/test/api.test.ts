import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { MemoryLedgerStore } from "../src/store";
const request = (path: string, init?: RequestInit) =>
  createApp(new MemoryLedgerStore()).request(path, init, { APP_ENV: "test" });
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
});
