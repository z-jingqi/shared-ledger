import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

let plan: "free" | "pro" = "free";
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
describe("shared ledger mobile UI", () => {
  beforeEach(() => {
    plan = "free";
    window.history.pushState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | Request) => {
        const path = typeof input === "string" ? input : input.url;
        if (path.includes("/auth/me"))
          return Promise.resolve(
            json({ user: { id: "user_test", name: "测试用户", email: "test@example.com", plan } }),
          );
        if (path.includes("/books/book_test/transactions"))
          return Promise.resolve(json({ transactions: [] }));
        if (path.includes("/books/book_test/imports")) return Promise.resolve(json({ imports: [] }));
        if (path.includes("/books/book_test"))
          return Promise.resolve(json({ book: { id: "book_test", name: "家庭账本", currency: "CNY" } }));
        if (path.includes("/books"))
          return Promise.resolve(json({ books: [{ id: "book_test", name: "家庭账本", currency: "CNY" }] }));
        return Promise.resolve(json({}));
      }),
    );
  });
  it("loads a real book response and hides AI for a free user", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "我的账本" })).toBeInTheDocument();
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
  });
  it("shows AI controls for a pro session", async () => {
    plan = "pro";
    render(<App />);
    expect(await screen.findByLabelText("打开 AI 助手")).toBeInTheDocument();
  });
  it("navigates from a live book to the add record form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("家庭账本"));
    await user.click(await screen.findByText("记一笔"));
    expect(await screen.findByRole("heading", { name: "记一笔" })).toBeInTheDocument();
  });
});
