import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

let plan: "free" | "pro" = "free";
let authMode: "signed-in" | "signed-out" | "expired-once" = "signed-in";
let authMeCalls = 0;
let loginError = "";
let bookList: Array<{ id: string; name: string; currency: string }> = [];
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const errorJson = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
describe("shared ledger mobile UI", () => {
  beforeEach(() => {
    plan = "free";
    authMode = "signed-in";
    authMeCalls = 0;
    loginError = "";
    bookList = [{ id: "book_test", name: "家庭账本", currency: "CNY" }];
    window.history.pushState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | Request) => {
        const path = typeof input === "string" ? input : input.url;
        if (path.includes("/auth/refresh")) {
          if (authMode === "expired-once") {
            authMode = "signed-in";
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return Promise.resolve(errorJson(401, "登录已过期，请重新登录"));
        }
        if (path.includes("/auth/me")) {
          authMeCalls += 1;
          if (authMode !== "signed-in") return Promise.resolve(errorJson(401, "未登录"));
          return Promise.resolve(
            json({ user: { id: "user_test", name: "测试用户", email: "test@example.com", plan } }),
          );
        }
        if (path.includes("/auth/login") && loginError) return Promise.resolve(errorJson(401, loginError));
        if (path.includes("/books/book_test/transactions"))
          return Promise.resolve(json({ transactions: [] }));
        if (path.includes("/books/book_test/imports")) return Promise.resolve(json({ imports: [] }));
        if (path.includes("/books/book_test"))
          return Promise.resolve(json({ book: { id: "book_test", name: "家庭账本", currency: "CNY" } }));
        if (path.includes("/books")) return Promise.resolve(json({ books: bookList }));
        return Promise.resolve(json({}));
      }),
    );
  });
  it("loads a real book response and hides AI for a free user", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "账本" })).toBeInTheDocument();
    expect(await screen.findByText("家庭账本")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
  });
  it("hides bottom navigation on book creation flow pages", async () => {
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "创建账本" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
  it("toggles create book options", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    const sharedToggle = await screen.findByRole("button", { name: "多人共享" });
    const budgetToggle = screen.getByRole("button", { name: "启用预算" });
    expect(sharedToggle).toHaveAttribute("aria-pressed", "false");
    expect(budgetToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(sharedToggle);
    expect(sharedToggle).toHaveAttribute("aria-pressed", "true");
    expect(budgetToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(budgetToggle);
    expect(budgetToggle).toHaveAttribute("aria-pressed", "true");
  });
  it("shows a centered empty book state without the header create action", async () => {
    bookList = [];
    render(<App />);

    expect(await screen.findByText("当前还没有账本")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "创建一个" })).toHaveAttribute("href", "/books/new");
    expect(screen.queryByRole("link", { name: "创建账本" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("创建账本")).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
  });
  it("redirects anonymous users to login", async () => {
    authMode = "signed-out";
    window.history.pushState({}, "", "/records");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "一起记" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toContain("redirect=%2Frecords");
  });
  it("refreshes an expired access session before rendering protected pages", async () => {
    authMode = "expired-once";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "账本" })).toBeInTheDocument();
    expect(authMeCalls).toBe(2);
  });
  it("keeps login and register form state separate", async () => {
    const user = userEvent.setup();
    loginError = "用户名或密码错误";
    window.history.pushState({}, "", "/login");
    render(<App />);

    await user.type(await screen.findByLabelText("用户名"), "login-user");
    await user.type(screen.getByLabelText("密码"), "login-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("用户名或密码错误")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "注册" }));
    expect(screen.queryByText("用户名或密码错误")).not.toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(screen.getByLabelText("确认密码")).toHaveValue("");
  });
  it("toggles password visibility on login and register forms", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/login");
    render(<App />);

    const loginPassword = await screen.findByLabelText("密码");
    expect(loginPassword).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(loginPassword).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(loginPassword).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("link", { name: "注册" }));
    expect(await screen.findByRole("button", { name: "创建账号" })).toBeInTheDocument();
    const registerPassword = screen.getByLabelText("密码");
    const confirmPassword = screen.getByLabelText("确认密码");
    expect(registerPassword).toHaveAttribute("type", "password");
    expect(confirmPassword).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(registerPassword).toHaveAttribute("type", "text");
    expect(confirmPassword).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "显示确认密码" }));
    expect(confirmPassword).toHaveAttribute("type", "text");
  });
});
