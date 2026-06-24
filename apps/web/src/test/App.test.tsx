import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import { App } from "../App";

let plan: "free" | "pro" = "free";
let authMode: "signed-in" | "signed-out" | "expired-once" = "signed-in";
let authMeCalls = 0;
let loginError = "";
let bookList: Array<{ id: string; name: string; currency: string }> = [];
let transactionsByBook: Record<string, LedgerTransaction[]> = {};
let categoriesByBook: Record<string, Array<{ id: string; name: string; type: "expense" | "income" }>> = {};
let tagsByBook: Record<string, Array<{ id: string; name: string }>> = {};
let transactionError = "";
let transactionRequests: Array<{
  path: string;
  method: string;
  body: Record<string, unknown>;
}> = [];
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
    bookList = [
      { id: "book_test", name: "家庭账本", currency: "CNY" },
      { id: "book_b", name: "旅行账本", currency: "CNY" },
    ];
    transactionsByBook = {
      book_test: [{ id: "tx_home", type: "expense", amount: 100, note: "餐饮", occurredAt: "2026-06-01" }],
      book_b: [{ id: "tx_travel", type: "expense", amount: 300, note: "酒店", occurredAt: "2026-06-02" }],
    };
    categoriesByBook = {
      book_test: [
        { id: "cat_food", name: "餐饮", type: "expense" },
        { id: "cat_salary", name: "工资", type: "income" },
      ],
      book_b: [{ id: "cat_hotel", name: "住宿", type: "expense" }],
    };
    tagsByBook = {
      book_test: [{ id: "tag_daily", name: "日常" }],
      book_b: [],
    };
    transactionError = "";
    transactionRequests = [];
    window.history.pushState({}, "", "/");
    class MockResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 320, height: 180 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal(
      "ResizeObserver",
      MockResizeObserver,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | Request, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.url;
        const method = init?.method ?? (typeof input === "string" ? "GET" : input.method);
        const bodyText =
          typeof init?.body === "string"
            ? init.body
            : typeof input !== "string" && typeof input.body === "string"
              ? input.body
              : undefined;
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
        if (path.includes("/books/book_test/categories")) {
          if (method === "POST") {
            const body = JSON.parse(bodyText ?? "{}") as { name?: string; type?: "expense" | "income" };
            const category = {
              id: `cat_${categoriesByBook.book_test.length + 1}`,
              name: body.name ?? "",
              type: body.type ?? "expense",
            };
            categoriesByBook.book_test = [...categoriesByBook.book_test, category];
            return Promise.resolve(json({ category }));
          }
          return Promise.resolve(json({ categories: categoriesByBook.book_test ?? [] }));
        }
        if (path.includes("/books/book_b/categories"))
          return Promise.resolve(json({ categories: categoriesByBook.book_b ?? [] }));
        if (path.includes("/books/book_test/tags")) {
          if (method === "POST") {
            const body = JSON.parse(bodyText ?? "{}") as { name?: string };
            const tag = { id: `tag_${tagsByBook.book_test.length + 1}`, name: body.name ?? "" };
            tagsByBook.book_test = [...tagsByBook.book_test, tag];
            return Promise.resolve(json({ tag }));
          }
          return Promise.resolve(json({ tags: tagsByBook.book_test ?? [] }));
        }
        if (path.includes("/books/book_b/tags"))
          return Promise.resolve(json({ tags: tagsByBook.book_b ?? [] }));
        if (path.includes("/books/book_test/transactions") && method !== "GET") {
          if (transactionError) return Promise.resolve(errorJson(500, transactionError));
          transactionRequests.push({
            path,
            method,
            body: JSON.parse(bodyText ?? "{}") as Record<string, unknown>,
          });
          return Promise.resolve(json({ transaction: { id: "tx_new" } }));
        }
        if (path.includes("/books/book_test/transactions"))
          return Promise.resolve(json({ transactions: transactionsByBook.book_test ?? [] }));
        if (path.includes("/books/book_b/transactions"))
          return Promise.resolve(json({ transactions: transactionsByBook.book_b ?? [] }));
        if (path.includes("/transactions/tx_home"))
          return Promise.resolve(
            json({
              transaction: {
                id: "tx_home",
                type: "expense",
                amount: 100,
                note: "餐饮",
                occurredAt: "2026-06-01",
                categoryId: "cat_food",
                tagIds: [],
                items: [],
              },
            }),
          );
        if (path.includes("/books/book_test/imports")) return Promise.resolve(json({ imports: [] }));
        if (path.includes("/books/book_test"))
          return Promise.resolve(json({ book: { id: "book_test", name: "家庭账本", currency: "CNY" } }));
        if (path.includes("/books/book_b"))
          return Promise.resolve(json({ book: { id: "book_b", name: "旅行账本", currency: "CNY" } }));
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
    expect(screen.getByRole("main")).toHaveClass("has-bottom-nav");
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
  });
  it("hides bottom navigation on book creation flow pages", async () => {
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "创建账本" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("has-bottom-nav");
  });
  it("toggles create book options", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    const sharedToggle = await screen.findByRole("switch", { name: "多人共享" });
    const budgetToggle = screen.getByRole("switch", { name: "启用预算" });
    expect(sharedToggle).toHaveAttribute("aria-checked", "false");
    expect(budgetToggle).toHaveAttribute("aria-checked", "false");

    await user.click(sharedToggle);
    expect(sharedToggle).toHaveAttribute("aria-checked", "true");
    expect(budgetToggle).toHaveAttribute("aria-checked", "false");

    await user.click(budgetToggle);
    expect(budgetToggle).toHaveAttribute("aria-checked", "true");
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
  it("shows the first book by default on analysis and switches by URL query", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/analysis");
    render(<App />);

    expect(await screen.findByRole("button", { name: /当前账本\s*家庭账本/ })).toBeInTheDocument();
    expect((await screen.findAllByText(/100\.00/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /当前账本\s*家庭账本/ }));
    await user.click(await screen.findByRole("button", { name: "旅行账本" }));

    expect(window.location.pathname).toBe("/analysis");
    expect(window.location.search).toContain("bookId=book_b");
    expect(await screen.findByRole("button", { name: /当前账本\s*旅行账本/ })).toBeInTheDocument();
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);
  });
  it("opens analysis directly with the requested book selected", async () => {
    window.history.pushState({}, "", "/analysis?bookId=book_b");
    render(<App />);

    expect(await screen.findByRole("button", { name: /当前账本\s*旅行账本/ })).toBeInTheDocument();
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);
  });
  it("shows an empty analysis state when there are no books", async () => {
    bookList = [];
    transactionsByBook = {};
    window.history.pushState({}, "", "/analysis");
    render(<App />);

    expect(await screen.findByText("当前还没有账本")).toBeInTheDocument();
    expect(screen.queryByText("收支趋势")).not.toBeInTheDocument();
  });
  it("navigates from a live book to the add record form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("家庭账本"));
    await user.click(await screen.findByText("记一笔"));
    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
  });
  it("renders the redesigned record form without native category and date fields", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(screen.getByRole("main")).not.toHaveClass("has-bottom-nav");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const form = main.querySelector("form.transaction-form");
    expect(form).toBeInTheDocument();
    const footer = form?.querySelector(".record-form-footer");
    expect(footer).toBeInTheDocument();
    const actions = footer?.querySelector(".record-form-actions");
    expect(actions).toBeInTheDocument();
    expect(actions).toContainElement(screen.getByRole("button", { name: "保存记录" }));
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("button", { name: /类型\s*支出/ })).toBeInTheDocument();
    expect(screen.queryByText("成员")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /类型\s*支出/ }));
    expect(await screen.findByRole("dialog", { name: "选择类型" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收入" }));
    expect(screen.getByRole("button", { name: /类型\s*收入/ })).toBeInTheDocument();

    expect(screen.queryByLabelText("分类", { selector: "select" })).not.toBeInTheDocument();
    const categoryButton = screen.getByRole("button", { name: /分类\s*请选择分类/ });
    expect(categoryButton).toHaveTextContent("请选择分类");
    await user.click(categoryButton);
    expect(await screen.findByRole("dialog", { name: "选择分类" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "餐饮" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工资" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "餐饮" }));

    expect(screen.queryByLabelText("时间", { selector: 'input[type="date"]' })).not.toBeInTheDocument();
    const dateButton = screen.getByRole("button", { name: /时间\s*\d{4}-\d{2}-\d{2}/ });
    expect(dateButton.textContent).toMatch(/\d+月\d+日/);
    await user.click(dateButton);
    expect(await screen.findByRole("dialog", { name: "选择时间" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "昨天" })).toBeInTheDocument();
  });
  it("keeps line items disabled until an amount is entered and preserves the amount after returning", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    const addDetailsButton = screen.getByRole("button", { name: /添加明细（选填）/ });
    expect(addDetailsButton).toBeDisabled();

    await user.click(addDetailsButton);
    expect(window.location.pathname).toBe("/records/new");
    expect(screen.queryByText("请先输入总金额")).not.toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "128.5");
    await waitFor(() => expect(addDetailsButton).toBeEnabled());
    await user.click(addDetailsButton);

    expect(window.location.pathname).toBe("/records/new/items");
    expect(window.location.search).toContain("total=128.5");
    expect(await screen.findByRole("heading", { name: "添加明细" })).toBeInTheDocument();
    expect(screen.getAllByText(/128\.50/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "保存明细" }));

    expect(window.location.pathname).toBe("/records/new");
    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(128.5);
  });
  it("starts line items empty and can add or delete rows", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records/new/items?total=128.5");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "添加明细" })).toBeInTheDocument();
    expect(screen.getAllByText(/128\.50/).length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("牛奶")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("水果")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("明细名称")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /新增明细|添加一项/ }));
    expect(screen.getAllByLabelText("明细名称")).toHaveLength(2);

    await user.type(screen.getAllByLabelText("明细名称")[0], "咖啡");
    await user.click(screen.getAllByRole("button", { name: "删除明细" })[1]);
    expect(screen.getAllByLabelText("明细名称")).toHaveLength(1);
    expect(screen.getByDisplayValue("咖啡")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除明细" }));
    expect(screen.getAllByLabelText("明细名称")).toHaveLength(1);
    expect(screen.queryByDisplayValue("咖啡")).not.toBeInTheDocument();
    expect(screen.queryByText("按分类拆分")).not.toBeInTheDocument();
  });
  it("keeps the current record draft when creating the first category from the picker", async () => {
    const user = userEvent.setup();
    categoriesByBook.book_test = [];
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /类型\s*支出/ }));
    await user.click(await screen.findByRole("button", { name: "收入" }));
    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "88.50");
    await user.type(screen.getByPlaceholderText("可填写备注信息（选填）"), "项目报销");
    const originalDateLabel = screen.getByRole("button", { name: /时间\s*\d{4}-\d{2}-\d{2}/ }).textContent;

    await user.click(screen.getByRole("button", { name: /分类\s*请选择分类/ }));
    expect(await screen.findByText(/暂无分类|还没有分类|没有可用分类/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("新分类名称"), "报销");
    await user.click(screen.getByRole("button", { name: "添加分类" }));

    expect(screen.getByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /分类\s*报销/ })).toHaveTextContent("报销");
    expect(screen.getByRole("button", { name: /时间\s*\d{4}-\d{2}-\d{2}/ }).textContent).toBe(originalDateLabel);
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(88.5);
    expect(screen.getByPlaceholderText("可填写备注信息（选填）")).toHaveValue("项目报销");

    await user.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(transactionRequests).toHaveLength(1));
    expect(transactionRequests[0]).toMatchObject({
      method: "POST",
      body: {
        type: "income",
        amount: 88.5,
        categoryId: expect.any(String),
        note: "项目报销",
      },
    });
    expect(transactionRequests[0]?.body).not.toHaveProperty("memberId");
    expect(transactionRequests[0]?.body).not.toHaveProperty("accountId");
    expect(transactionRequests[0]?.body.occurredAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("adds a tag from the picker without losing the record draft", async () => {
    const user = userEvent.setup();
    tagsByBook.book_test = [];
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "12");
    await user.type(screen.getByPlaceholderText("可填写备注信息（选填）"), "咖啡");

    await user.click(screen.getByRole("button", { name: /标签\s*请选择标签/ }));
    expect(await screen.findByRole("dialog", { name: "选择标签" })).toBeInTheDocument();
    expect(await screen.findByText("暂无标签，先添加一个。")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("新标签名称"), "工作");
    await user.click(screen.getByRole("button", { name: "添加标签" }));

    expect(screen.getByRole("button", { name: /标签\s*工作/ })).toHaveTextContent("工作");
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(12);
    expect(screen.getByPlaceholderText("可填写备注信息（选填）")).toHaveValue("咖啡");
  });
  it("saves a record and keeps entering another one", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /类型\s*支出/ }));
    await user.click(await screen.findByRole("button", { name: "收入" }));
    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "20");
    await user.type(screen.getByPlaceholderText("可填写备注信息（选填）"), "第一笔");
    const originalDateLabel = screen.getByRole("button", { name: /时间\s*\d{4}-\d{2}-\d{2}/ }).textContent;

    await user.click(screen.getByRole("button", { name: /分类\s*请选择分类/ }));
    await user.click(await screen.findByRole("button", { name: "餐饮" }));
    await user.click(screen.getByRole("button", { name: /标签\s*请选择标签/ }));
    await user.click(await screen.findByRole("button", { name: "日常" }));
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(transactionRequests).toHaveLength(1));
    expect(window.location.pathname).toBe("/records/new");
    expect(screen.getByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /类型\s*收入/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /时间\s*\d{4}-\d{2}-\d{2}/ }).textContent).toBe(originalDateLabel);
    expect(screen.getByRole("button", { name: /分类\s*请选择分类/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /标签\s*请选择标签/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(null));
    expect(screen.getByPlaceholderText("可填写备注信息（选填）")).toHaveValue("");

    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "30");
    await user.type(screen.getByPlaceholderText("可填写备注信息（选填）"), "第二笔");
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(transactionRequests).toHaveLength(2));
    expect(transactionRequests[0]).toMatchObject({
      body: { type: "income", amount: 20, categoryId: "cat_food", tagIds: ["tag_daily"], note: "第一笔" },
    });
    expect(transactionRequests[1]).toMatchObject({
      body: { type: "income", amount: 30, tagIds: [], note: "第二笔" },
    });
  });
  it("keeps the current draft when save and continue fails", async () => {
    const user = userEvent.setup();
    transactionError = "保存失败";
    window.history.pushState({}, "", "/records/new?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新增记录" })).toBeInTheDocument();
    await user.type(screen.getByRole("spinbutton", { name: "金额" }), "45");
    await user.type(screen.getByPlaceholderText("可填写备注信息（选填）"), "不能丢");
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(45);
    expect(screen.getByPlaceholderText("可填写备注信息（选填）")).toHaveValue("不能丢");
  });
  it("does not show save and continue when editing a record", async () => {
    window.history.pushState({}, "", "/records/tx_home/edit?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "编辑记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存记录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并继续" })).not.toBeInTheDocument();
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
