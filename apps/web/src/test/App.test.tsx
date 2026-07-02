import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerTransaction } from "../components/ledger/Transactions";

type MockAiPart = { type: string; text?: string; [key: string]: unknown };

import { App } from "../App";

let plan: "free" | "pro" = "free";
let authMode: "signed-in" | "signed-out" | "expired-once" = "signed-in";
let authMeCalls = 0;
let loginError = "";
let bookList: Array<{ id: string; name: string; currency: string }> = [];
let transactionsByBook: Record<string, LedgerTransaction[]> = {};
let categories: Array<{ id: string; name: string; type: "expense" | "income" }> = [];
let transactionError = "";
let transactionRequests: Array<{
  path: string;
  method: string;
  body: Record<string, unknown>;
}> = [];
let bookMutationRequests: Array<{
  path: string;
  method: string;
  body?: Record<string, unknown>;
}> = [];
let importBatchRequests: Array<{
  path: string;
  files: string[];
  autoConfirm: FormDataEntryValue | null;
}> = [];
let importCancelRequests: string[] = [];
let aiSearchRequests: Array<{
  bookId?: string;
  query?: string;
  baseFilters?: Record<string, unknown>;
  timeZone?: string;
}> = [];
let aiChatRequests: Array<{
  message?: string;
  bookId?: string;
  page?: string;
  sessionId?: string;
  attachments?: Array<{ name: string; type: string; size: number; lastModified: number }>;
}> = [];
let aiConfirmationRequests: string[] = [];
let aiSessions: Array<{ id: string; title: string; bookId?: string; createdAt: string; updatedAt: string }> =
  [];
let aiSessionMessages: Record<
  string,
  Array<{ id: string; role: "user" | "assistant"; content: string; parts: MockAiPart[] }>
> = {};
let mockUsers: Array<{
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  plan?: "free" | "pro";
}> = [];
let mockInvitations: Array<{
  id: string;
  bookId: string;
  inviterUserId: string;
  inviteeUserId?: string;
  role: "admin" | "member";
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  direction: "sent" | "received";
  book: { id: string; name: string; currency: string };
  inviter: { id: string; name: string; email?: string; plan?: "free" | "pro" };
  invitee?: { id: string; name: string; email?: string; plan?: "free" | "pro" };
}> = [];
let mockInviteBlocks: Array<{
  id: string;
  createdAt: string;
  user: { id: string; name: string; email?: string };
}> = [];
let userSearchRequests: string[] = [];
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const errorJson = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

const bookSwitcherName = (bookName: string) => new RegExp(`((切换账本，)?当前账本\\s*)?${bookName}`);
const findBookSwitcher = (bookName = "家庭账本") =>
  screen.findByRole("button", { name: bookSwitcherName(bookName) });
const queryAddOverlay = () =>
  screen.queryByRole("dialog", { name: /添加|新增|记一笔|记账方式/ }) ??
  screen.queryByRole("menu", { name: /添加|新增|记一笔|记账方式/ });
const openManualAddForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await findBookSwitcher();
  const addButton =
    screen.queryByRole("button", { name: "记一笔" }) ??
    (await screen.findByRole("button", { name: "打开添加菜单" }));
  await user.click(addButton);
  const manualItem = screen.queryByRole("menuitem", { name: /手动添加/ });
  if (manualItem) await user.click(manualItem);
  return screen.findByRole("heading", { name: "记一笔支出" });
};
const recordRow = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`.ios-transaction-row[data-transaction-id="${id}"]`);
const recordRows = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>(".ios-transaction-row"),
];
const seedAiSession = (messages: Array<{ id: string; role: "user" | "assistant"; parts: MockAiPart[] }>) => {
  const now = new Date().toISOString();
  const session = {
    id: "ai_session_test",
    title: "测试会话",
    bookId: "book_test",
    createdAt: now,
    updatedAt: now,
  };
  aiSessions = [session];
  aiSessionMessages = {
    [session.id]: messages.map((message) => ({
      ...message,
      content: message.parts.map((part) => part.text ?? "").join(" "),
    })),
  };
};

function aiSseResponse(payload: {
  sessionId: string;
  message: { id: string; role: "assistant"; parts: MockAiPart[] };
  parts: MockAiPart[];
}) {
  const encoder = new TextEncoder();
  const text = payload.parts
    .filter((part) => part.type === "text" || part.type === "tool-status")
    .map((part) => part.text ?? part.message ?? "")
    .filter(Boolean)
    .join("\n");
  const body = [
    `event: tool_call\ndata: ${JSON.stringify({ toolName: "test" })}\n\n`,
    ...(text ? [`event: message_delta\ndata: ${JSON.stringify({ text })}\n\n`] : []),
    `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
  ].join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function mockAiParts(
  message?: string,
  attachments: Array<{ name: string; type: string; size: number; lastModified: number }> = [],
): MockAiPart[] {
  if (attachments.length && message?.includes("backend-save")) {
    return [
      { type: "text", text: "已提交 1 张图片，正在处理。" },
      {
        type: "import-job-card",
        title: "图片识别",
        message: "可以在待确认/图片识别任务中查看进度。",
        jobs: [
          {
            id: "job_new",
            fileName: attachments[0].name,
            status: "ocr_processing",
            progress: 12,
            stage: "OCR 12%",
          },
        ],
      },
    ];
  }
  if (attachments.length && message?.includes("backend-ignore"))
    return [{ type: "text", text: "已忽略附件。" }];
  if (attachments.length) {
    return [
      {
        type: "confirmation-card",
        confirmation: {
          id: "local_attachment",
          action: "save-attachments",
          status: "pending",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          summary: "保存这些附件？",
          description: attachments.map((attachment) => attachment.name).join("、"),
          confirmLabel: "保存",
          cancelLabel: "取消",
        },
      },
    ];
  }
  if (message?.includes("确认动作")) {
    return [
      {
        type: "tool-status",
        tool: "analyze-records",
        status: "pending_confirmation",
        message: "请确认结算动作",
      },
      {
        type: "confirmation-card",
        confirmation: {
          id: "confirmation_generic",
          action: "close-period",
          status: "pending",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          summary: "确认结算本月账本",
          confirmLabel: "确认结算",
          cancelLabel: "取消",
        },
      },
    ];
  }
  if (message?.includes("搜索")) {
    return [
      { type: "tool-status", tool: "search-records", status: "success", message: "找到 1 条记录" },
      {
        type: "search-result-card",
        title: "搜索结果",
        summary: "找到 1 条记录",
        results: [{ id: "tx_home", title: "餐饮", description: "餐饮 · 2026-06-01", amount: 100 }],
        pageName: "记录页",
        href: "/records?bookId=book_test&source=ai",
      },
      { type: "navigation-card", pageName: "记录页", href: "/records?bookId=book_test&source=ai" },
    ];
  }
  return [
    { type: "tool-status", tool: "create-record", status: "success", message: "记录已保存" },
    {
      type: "record-card",
      title: "已记录",
      amount: 38,
      categoryName: "餐饮",
      note: message,
      occurredAt: "2026-06-25",
      pageName: "记录详情",
      href: "/records/tx_ai",
    },
  ];
}

function mockUserSummary(userId: string) {
  return mockUsers.find((user) => user.id === userId) ?? { id: userId, name: "已注册用户", plan: "free" };
}

function mockBookSummary(bookId: string) {
  return bookList.find((book) => book.id === bookId) ?? { id: bookId, name: "账本", currency: "CNY" };
}

describe("shared ledger mobile UI", () => {
  beforeEach(() => {
    localStorage.clear();
    plan = "free";
    authMode = "signed-in";
    authMeCalls = 0;
    loginError = "";
    bookList = [
      { id: "book_test", name: "家庭账本", currency: "CNY" },
      { id: "book_b", name: "旅行账本", currency: "CNY" },
    ];
    transactionsByBook = {
      book_test: [
        {
          id: "tx_home",
          type: "expense",
          amount: 100,
          note: "餐饮",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
      ],
      book_b: [{ id: "tx_travel", type: "expense", amount: 300, note: "酒店", occurredAt: "2026-06-02" }],
    };
    categories = [
      { id: "cat_food", name: "餐饮", type: "expense" },
      { id: "cat_salary", name: "工资", type: "income" },
      { id: "cat_hotel", name: "住宿", type: "expense" },
    ];
    transactionError = "";
    transactionRequests = [];
    bookMutationRequests = [];
    importBatchRequests = [];
    importCancelRequests = [];
    aiSearchRequests = [];
    aiChatRequests = [];
    aiConfirmationRequests = [];
    aiSessions = [];
    aiSessionMessages = {};
    mockUsers = [
      { id: "user_test", name: "测试用户", email: "test@example.com", plan },
      { id: "user_friend", name: "Friend", email: "friend@example.com", plan: "free" },
      { id: "user_inviter", name: "邀请人", email: "inviter@example.com", plan: "pro" },
    ];
    mockInvitations = [];
    mockInviteBlocks = [];
    userSearchRequests = [];
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
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
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | Request, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.url;
        const method = init?.method ?? (typeof input === "string" ? "GET" : input.method);
        const requestUrl = new URL(path, "http://test.local");
        const pathname = requestUrl.pathname.replace(/^\/api/, "");
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
        if (path.includes("/auth/login")) {
          authMode = "signed-in";
          return Promise.resolve(
            json({ user: { id: "user_test", name: "测试用户", email: "test@example.com", plan } }),
          );
        }
        if (path.includes("/auth/register")) {
          const body = JSON.parse(bodyText ?? "{}") as { name?: string };
          authMode = "signed-in";
          bookList = [{ id: "book_registered", name: body.name ?? "新用户", currency: "CNY" }];
          transactionsByBook = { book_registered: [] };
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { id: "user_registered", name: body.name ?? "新用户", email: "", plan },
              }),
              { status: 201, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (pathname === "/ai/sessions" && method === "GET") {
          return Promise.resolve(json({ sessions: aiSessions }));
        }
        if (pathname === "/ai/sessions" && method === "POST") {
          const body = JSON.parse(bodyText ?? "{}") as { bookId?: string; title?: string };
          const now = new Date().toISOString();
          const session = {
            id: `ai_session_${aiSessions.length + 1}`,
            title: body.title ?? "新会话",
            bookId: body.bookId,
            createdAt: now,
            updatedAt: now,
          };
          aiSessions = [session, ...aiSessions];
          aiSessionMessages[session.id] = [];
          return Promise.resolve(
            new Response(JSON.stringify({ session }), {
              status: 201,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        const aiSessionJsonMessageMatch = pathname.match(/^\/ai\/sessions\/([^/]+)\/messages$/);
        if (aiSessionJsonMessageMatch) {
          const sessionId = aiSessionJsonMessageMatch[1];
          const body = JSON.parse(bodyText ?? "{}") as {
            message?: string;
            bookId?: string;
            page?: string;
            baseFilters?: { type?: string; sort?: string };
            timeZone?: string;
          };
          if (body.page === "records") {
            aiSearchRequests.push({
              query: body.message ?? "",
              bookId: body.bookId ?? "",
              baseFilters: body.baseFilters ?? {},
              timeZone: body.timeZone ?? "",
            });
            const filters = {
              type: "expense",
              sort: body.baseFilters?.sort ?? "latest",
              start: "2026-01-01",
              end: "2026-12-31",
              min: { value: 100, strict: true },
              category: "cat_food",
            };
            const chips = [
              { key: "date", label: "时间", value: "今年" },
              { key: "type", label: "类型", value: "支出" },
              { key: "category", label: "分类", value: "餐饮" },
              { key: "amount", label: "金额", value: "金额 > 100" },
            ];
            const parts = [
              { type: "filter-result", filters, chips, href: "/records?bookId=book_test&source=ai" },
              {
                type: "search-result-card",
                title: "搜索结果",
                summary: "找到 1 条记录",
                results: [{ id: "tx_party", title: "餐饮", description: "餐饮 · 2026-06-15", amount: -120 }],
              },
            ];
            return Promise.resolve(
              json({ sessionId, message: { id: "assistant_search", role: "assistant", parts }, parts }),
            );
          }
          const parts = mockAiParts(body.message);
          return Promise.resolve(
            json({ sessionId, message: { id: "assistant_json", role: "assistant", parts }, parts }),
          );
        }
        const aiSessionMessageMatch = pathname.match(/^\/ai\/sessions\/([^/]+)\/messages\/stream$/);
        if (aiSessionMessageMatch) {
          const sessionId = aiSessionMessageMatch[1];
          const form = init?.body instanceof FormData ? init.body : new FormData();
          const message = String(form.get("message") ?? "");
          const bookId = String(form.get("bookId") ?? "");
          const page = String(form.get("page") ?? "");
          const attachments = form
            .getAll("files")
            .filter((file): file is File => file instanceof File)
            .map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              lastModified: file.lastModified,
            }));
          aiChatRequests.push({ message, bookId, page, sessionId, attachments });
          aiSessionMessages[sessionId] ??= [];
          aiSessionMessages[sessionId].push({
            id: `user_${aiSessionMessages[sessionId].length + 1}`,
            role: "user",
            content: message || `上传 ${attachments.length} 个附件`,
            parts: [{ type: "text", text: message || `上传 ${attachments.length} 个附件` }],
          });
          const parts = mockAiParts(message, attachments);
          const assistant = {
            id: `assistant_${aiSessionMessages[sessionId].length + 1}`,
            role: "assistant" as const,
            content: parts.map((part) => part.text ?? part.message ?? "").join("\n"),
            parts,
          };
          aiSessionMessages[sessionId].push(assistant);
          aiSessions = aiSessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  title: session.title === "新会话" && message ? message.slice(0, 40) : session.title,
                  updatedAt: new Date().toISOString(),
                }
              : session,
          );
          return Promise.resolve(aiSseResponse({ sessionId, message: assistant, parts }));
        }
        const aiSessionMatch = pathname.match(/^\/ai\/sessions\/([^/]+)$/);
        if (aiSessionMatch) {
          const sessionId = aiSessionMatch[1];
          const session = aiSessions.find((item) => item.id === sessionId);
          if (!session) return Promise.resolve(errorJson(404, "会话不存在"));
          if (method === "PATCH") {
            const body = JSON.parse(bodyText ?? "{}") as { title?: string };
            aiSessions = aiSessions.map((item) =>
              item.id === sessionId ? { ...item, title: body.title ?? item.title } : item,
            );
            return Promise.resolve(json({ session: aiSessions.find((item) => item.id === sessionId) }));
          }
          if (method === "DELETE") {
            aiSessions = aiSessions.filter((item) => item.id !== sessionId);
            delete aiSessionMessages[sessionId];
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return Promise.resolve(
            json({ session: { ...session, messages: aiSessionMessages[sessionId] ?? [] } }),
          );
        }
        if (path.includes("/ai/chat")) {
          const body = JSON.parse(bodyText ?? "{}") as (typeof aiChatRequests)[number];
          aiChatRequests.push(body);
          if (body.attachments?.length) {
            if (body.message?.includes("backend-save")) {
              return Promise.resolve(
                json({
                  conversationId: "conversation_test",
                  attachmentAction: { action: "save" },
                  parts: [],
                }),
              );
            }
            if (body.message?.includes("backend-ignore")) {
              return Promise.resolve(
                json({
                  conversationId: "conversation_test",
                  attachmentAction: { action: "ignore" },
                  parts: [],
                }),
              );
            }
            return Promise.resolve(
              json({
                conversationId: "conversation_test",
                parts: [
                  {
                    type: "confirmation-card",
                    confirmation: {
                      id: "local_attachment",
                      action: "save-attachments",
                      status: "pending",
                      expiresAt: new Date(Date.now() + 10_000).toISOString(),
                      summary: "保存这些附件？",
                      confirmLabel: "保存",
                      cancelLabel: "取消",
                    },
                  },
                ],
              }),
            );
          }
          if (body.message?.includes("确认动作")) {
            return Promise.resolve(
              json({
                conversationId: "conversation_test",
                message: {
                  id: "ai_generic_confirmation",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-status",
                      tool: "analyze-records",
                      status: "pending_confirmation",
                      message: "请确认结算动作",
                    },
                    {
                      type: "confirmation-card",
                      confirmation: {
                        id: "confirmation_generic",
                        action: "close-period",
                        status: "pending",
                        expiresAt: new Date(Date.now() + 10_000).toISOString(),
                        summary: "确认结算本月账本",
                        confirmLabel: "确认结算",
                        cancelLabel: "取消",
                      },
                    },
                  ],
                },
              }),
            );
          }
          if (body.message?.includes("搜索")) {
            return Promise.resolve(
              json({
                conversationId: "conversation_test",
                message: {
                  id: "ai_search",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-status",
                      tool: "search-records",
                      status: "success",
                      message: "找到 1 条记录",
                    },
                    {
                      type: "search-result-card",
                      title: "搜索结果",
                      summary: "找到 1 条记录",
                      results: [
                        { id: "tx_home", title: "餐饮", description: "餐饮 · 2026-06-01", amount: 100 },
                      ],
                      pageName: "记录页",
                      href: "/records?bookId=book_test&source=ai",
                    },
                    {
                      type: "navigation-card",
                      pageName: "记录页",
                      href: "/records?bookId=book_test&source=ai",
                    },
                  ],
                },
              }),
            );
          }
          return Promise.resolve(
            json({
              conversationId: "conversation_test",
              message: {
                id: "ai_record",
                role: "assistant",
                parts: [
                  { type: "tool-status", tool: "create-record", status: "success", message: "记录已保存" },
                  {
                    type: "record-card",
                    title: "已记录",
                    amount: 38,
                    categoryName: "餐饮",
                    note: body.message,
                    occurredAt: "2026-06-25",
                    pageName: "记录详情",
                    href: "/records/tx_ai",
                  },
                ],
              },
            }),
          );
        }
        if (path.includes("/ai/confirmations/local_attachment/confirm")) {
          aiConfirmationRequests.push(path);
          return Promise.resolve(
            json({
              parts: [
                { type: "text", text: "已提交 1 张图片，正在处理。" },
                {
                  type: "import-job-card",
                  title: "图片识别",
                  message: "可以在待确认/图片识别任务中查看进度。",
                  jobs: [
                    {
                      id: "job_new",
                      fileName: "invoice.jpg",
                      status: "ocr_processing",
                      progress: 12,
                      stage: "OCR 12%",
                    },
                  ],
                },
              ],
            }),
          );
        }
        if (path.includes("/ai/confirmations/local_attachment/cancel")) {
          aiConfirmationRequests.push(path);
          return Promise.resolve(json({ confirmation: { id: "local_attachment", status: "cancelled" } }));
        }
        if (path.includes("/ai/confirmations/confirmation_generic/confirm")) {
          aiConfirmationRequests.push(path);
          return Promise.resolve(
            json({
              parts: [
                {
                  type: "tool-status",
                  tool: "analyze-records",
                  status: "success",
                  label: "结算已确认",
                  message: "后端已完成确认动作",
                },
                {
                  type: "navigation-card",
                  pageName: "分析",
                  description: "查看结算结果",
                  href: "/analysis?bookId=book_test",
                },
              ],
            }),
          );
        }
        if (path.includes("/ai/confirmations/confirmation_generic/cancel")) {
          aiConfirmationRequests.push(path);
          return Promise.resolve(json({ confirmation: { id: "confirmation_generic", status: "cancelled" } }));
        }
        if (path.includes("/me/categories")) {
          if (method === "POST") {
            const body = JSON.parse(bodyText ?? "{}") as { name?: string; type?: "expense" | "income" };
            const category = {
              id: `cat_${categories.length + 1}`,
              name: body.name ?? "",
              type: body.type ?? "expense",
            };
            categories = [...categories, category];
            return Promise.resolve(json({ category }));
          }
          return Promise.resolve(json({ categories }));
        }
        if (path.startsWith("/categories/")) {
          const categoryId = path.split("/").pop();
          if (method === "PATCH") {
            const body = JSON.parse(bodyText ?? "{}") as { name?: string; type?: "expense" | "income" };
            categories = categories.map((category) =>
              category.id === categoryId ? { ...category, ...body } : category,
            );
            return Promise.resolve(
              json({ category: categories.find((category) => category.id === categoryId) }),
            );
          }
          if (method === "DELETE") {
            categories = categories.filter((category) => category.id !== categoryId);
            return Promise.resolve(new Response(null, { status: 204 }));
          }
        }
        if (pathname === "/users/search") {
          const query = requestUrl.searchParams.get("query")?.toLowerCase() ?? "";
          userSearchRequests.push(query);
          return Promise.resolve(
            json({
              users: mockUsers
                .filter((user) => user.id !== "user_test")
                .filter((user) => user.name.toLowerCase() === query || user.email?.toLowerCase() === query)
                .slice(0, 1),
            }),
          );
        }
        if (pathname === "/users/invite-blocks" && method === "GET") {
          return Promise.resolve(json({ blocks: mockInviteBlocks }));
        }
        const inviteBlockMatch = pathname.match(/^\/users\/([^/]+)\/invite-blocks$/);
        if (inviteBlockMatch) {
          const target = mockUserSummary(inviteBlockMatch[1]);
          if (method === "POST") {
            mockInviteBlocks = [
              ...mockInviteBlocks,
              {
                id: `block_${mockInviteBlocks.length + 1}`,
                createdAt: new Date().toISOString(),
                user: target,
              },
            ];
            return Promise.resolve(json({ block: { user: target } }));
          }
          if (method === "DELETE") {
            mockInviteBlocks = mockInviteBlocks.filter((block) => block.user.id !== target.id);
            return Promise.resolve(new Response(null, { status: 204 }));
          }
        }
        if (pathname === "/invitations" && method === "GET") {
          return Promise.resolve(json({ invitations: mockInvitations }));
        }
        const invitationActionMatch = pathname.match(
          /^\/invitations\/([^/]+)\/(accept|decline|revoke|remind)$/,
        );
        if (invitationActionMatch) {
          const [, invitationId, action] = invitationActionMatch;
          const body = JSON.parse(bodyText ?? "{}") as { blockInviter?: boolean };
          const invitation = mockInvitations.find((item) => item.id === invitationId);
          if (!invitation) return Promise.resolve(errorJson(404, "邀请不存在"));
          if (action === "accept") invitation.status = "accepted";
          if (action === "decline") {
            invitation.status = "declined";
            if (body.blockInviter && invitation.inviter)
              mockInviteBlocks = [
                ...mockInviteBlocks,
                {
                  id: `block_${mockInviteBlocks.length + 1}`,
                  createdAt: new Date().toISOString(),
                  user: invitation.inviter,
                },
              ];
          }
          if (action === "revoke") invitation.status = "revoked";
          invitation.updatedAt = new Date().toISOString();
          return Promise.resolve(json({ invitation }));
        }
        const invitationDeleteMatch = pathname.match(/^\/invitations\/([^/]+)$/);
        if (invitationDeleteMatch && method === "DELETE") {
          const invitation = mockInvitations.find((item) => item.id === invitationDeleteMatch[1]);
          if (invitation?.status === "pending")
            return Promise.resolve(errorJson(400, "进行中的邀请不能删除"));
          mockInvitations = mockInvitations.filter((item) => item.id !== invitationDeleteMatch[1]);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        const bookMembersMatch = pathname.match(/^\/books\/([^/]+)\/members$/);
        if (bookMembersMatch && method === "GET") {
          return Promise.resolve(
            json({
              members: [{ id: "member_test", userId: "user_test", name: "测试用户", role: "creator" }],
            }),
          );
        }
        const bookInvitationsMatch = pathname.match(/^\/books\/([^/]+)\/invitations$/);
        if (bookInvitationsMatch) {
          const bookId = bookInvitationsMatch[1];
          if (method === "GET") {
            return Promise.resolve(
              json({ invitations: mockInvitations.filter((invitation) => invitation.bookId === bookId) }),
            );
          }
          if (method === "POST") {
            const body = JSON.parse(bodyText ?? "{}") as { userId?: string; role?: "member" | "admin" };
            const target = body.userId ? mockUserSummary(body.userId) : undefined;
            if (!target) return Promise.resolve(errorJson(404, "没有找到该用户，请先搜索并选择"));
            const now = new Date().toISOString();
            const book = mockBookSummary(bookId);
            const invitation = {
              id: `invite_${mockInvitations.length + 1}`,
              bookId,
              inviterUserId: "user_test",
              inviteeUserId: target.id,
              role: body.role ?? "member",
              status: "pending",
              expiresAt: "2026-07-09T00:00:00.000Z",
              createdAt: now,
              updatedAt: now,
              direction: "sent" as const,
              book,
              inviter: mockUserSummary("user_test"),
              invitee: target,
            };
            mockInvitations = [invitation, ...mockInvitations];
            return Promise.resolve(
              new Response(JSON.stringify({ invitation }), {
                status: 201,
                headers: { "content-type": "application/json" },
              }),
            );
          }
        }
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
        if (path.includes("/books/book_registered/transactions"))
          return Promise.resolve(json({ transactions: transactionsByBook.book_registered ?? [] }));
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
                items: [{ id: "item_milk", name: "牛奶", amount: 100 }],
              },
            }),
          );
        if (path.includes("/books/book_test/imports/batch")) {
          const body = init?.body instanceof FormData ? init.body : new FormData();
          importBatchRequests.push({
            path,
            files: body.getAll("files").map((file) => (file instanceof File ? file.name : String(file))),
            autoConfirm: body.get("autoConfirm"),
          });
          return Promise.resolve(
            json({
              jobs: [
                {
                  id: "job_new",
                  fileName: importBatchRequests.at(-1)?.files[0] ?? "",
                  status: "ocr_processing",
                  progress: 12,
                  stage: "extracting",
                },
              ],
            }),
          );
        }
        if (path.includes("/imports/job_new/cancel")) {
          importCancelRequests.push(path);
          return Promise.resolve(json({ ok: true }));
        }
        if (path.includes("/imports/job_new"))
          return Promise.resolve(
            json({ job: { id: "job_new", fileName: "invoice.jpg", status: "pending_confirmation" } }),
          );
        if (path.includes("/books/book_test/imports")) return Promise.resolve(json({ imports: [] }));
        if (path.includes("/books/book_test") && method === "PATCH") {
          const body = JSON.parse(bodyText ?? "{}") as { name?: string; currency?: string };
          bookMutationRequests.push({ path, method, body });
          bookList = bookList.map((item) => (item.id === "book_test" ? { ...item, ...body } : item));
          return Promise.resolve(json({ book: bookList.find((item) => item.id === "book_test") }));
        }
        if (path.includes("/books/book_b") && method === "PATCH") {
          const body = JSON.parse(bodyText ?? "{}") as { name?: string; currency?: string };
          bookMutationRequests.push({ path, method, body });
          bookList = bookList.map((item) => (item.id === "book_b" ? { ...item, ...body } : item));
          return Promise.resolve(json({ book: bookList.find((item) => item.id === "book_b") }));
        }
        if (path.includes("/books/book_test") && method === "DELETE") {
          bookMutationRequests.push({ path, method });
          bookList = bookList.filter((item) => item.id !== "book_test");
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (path.includes("/books/book_b") && method === "DELETE") {
          bookMutationRequests.push({ path, method });
          bookList = bookList.filter((item) => item.id !== "book_b");
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (path.includes("/books/book_test"))
          return Promise.resolve(
            json({ book: bookList.find((item) => item.id === "book_test"), role: "creator" }),
          );
        if (path.includes("/books/book_b"))
          return Promise.resolve(
            json({ book: bookList.find((item) => item.id === "book_b"), role: "creator" }),
          );
        if (path.includes("/books/book_registered"))
          return Promise.resolve(
            json({ book: bookList.find((item) => item.id === "book_registered"), role: "creator" }),
          );
        if (path.includes("/books")) return Promise.resolve(json({ books: bookList }));
        return Promise.resolve(json({}));
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("loads a real book response and hides AI for a free user", async () => {
    render(<App />);
    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.getByText("6月净收支")).toBeInTheDocument();
    expect(screen.queryByText("6月结余")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/home/),
    );
    expect(screen.getByRole("link", { name: /流水|记录/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/records/),
    );
    expect(screen.getByRole("button", { name: "记一笔" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "分析" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/analysis/),
    );
    expect(screen.getByRole("link", { name: "我的" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/settings/),
    );
    expect(screen.queryByRole("link", { name: "账本" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("has-bottom-nav");
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
  });
  it("hides bottom navigation on book creation flow pages", async () => {
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "创建账本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("has-bottom-nav");
  });
  it("keeps create book focused on real persisted fields", async () => {
    window.history.pushState({}, "", "/books/new");
    render(<App />);

    expect(await screen.findByLabelText("账本名称")).toBeInTheDocument();
    expect(screen.getByLabelText("默认货币")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("这个账本用来记录什么？")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "多人共享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "启用预算" })).not.toBeInTheDocument();
  });
  it("shows a home empty state when there is no book", async () => {
    bookList = [];
    render(<App />);

    expect(await screen.findByText("还没有账本")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "创建账本" })).toHaveAttribute("href", "/books/new");
    expect(window.location.pathname).toBe("/home");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
  it("renders the empty recent transaction state as a full-width block on home", async () => {
    transactionsByBook = { ...transactionsByBook, book_test: [] };
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    const emptyText = await screen.findByText("还没有记录，记下第一笔吧。");
    const emptyBlock = emptyText.closest(
      ".ios-empty, .ios-empty-state, .empty-state, .ios-transaction-empty, .ios-recent-empty",
    );

    expect(emptyText.closest("p.muted")).toBeNull();
    expect(emptyBlock).toBeInTheDocument();
    expect(emptyText.closest(".ios-transaction-card")).toContainElement(emptyBlock as HTMLElement);
  });
  it("switches books from the home ledger sheet without entering book management", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    await user.click(await findBookSwitcher());
    await user.click(await screen.findByRole("button", { name: /旅行账本/ }));

    expect(window.location.pathname).toBe("/home");
    expect(window.location.search).toContain("bookId=book_b");
    expect(await findBookSwitcher("旅行账本")).toBeInTheDocument();
    expect(screen.getByText("6月净收支")).toBeInTheDocument();
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);
  });
  it("shows AI controls for a pro session", async () => {
    plan = "pro";
    render(<App />);
    expect(await screen.findByLabelText("打开 AI 助手")).toBeInTheDocument();
  });
  it("renders AI messages without times and applies user/assistant message classes", async () => {
    const user = userEvent.setup();
    plan = "pro";
    seedAiSession([
      { id: "user_message", role: "user", parts: [{ type: "text", text: "今年大于100的支出" }] },
      { id: "assistant_message", role: "assistant", parts: [{ type: "text", text: "已筛选出 12 笔记录。" }] },
    ]);
    const { container } = render(<App />);

    await user.click(await screen.findByLabelText("打开 AI 助手"));

    expect(await screen.findByRole("heading", { name: "测试会话" })).toBeInTheDocument();
    expect(screen.queryByText(/关闭后会保留当前会话/)).not.toBeInTheDocument();
    expect(screen.getByText("今年大于100的支出").closest("article")).toHaveClass("ai-message", "ai-user");
    expect(screen.getByText("已筛选出 12 笔记录。").closest("article")).toHaveClass(
      "ai-message",
      "ai-assistant",
    );
    expect(container.querySelector(".ai-message time")).toBeNull();

    const index = container.querySelector(".ai-message-index");
    expect(index).not.toHaveClass("visible");
    vi.useFakeTimers();
    fireEvent.wheel(container.querySelector(".ai-messages")!);
    expect(index).toHaveClass("visible");
    act(() => vi.advanceTimersByTime(2999));
    expect(index).toHaveClass("visible");
    act(() => vi.advanceTimersByTime(2));
    expect(index).not.toHaveClass("visible");
    vi.useRealTimers();
  });
  it("renders AI navigation parts as page-name cards instead of raw URLs", async () => {
    const user = userEvent.setup();
    plan = "pro";
    seedAiSession([
      {
        id: "assistant_message",
        role: "assistant",
        parts: [
          { type: "navigation-card", pageName: "待确认记录", href: "/records/pending?bookId=book_test" },
        ],
      },
    ]);
    render(<App />);

    await user.click(await screen.findByLabelText("打开 AI 助手"));

    expect(await screen.findByRole("button", { name: "打开待确认记录" })).toBeInTheDocument();
    expect(screen.getByText("待确认记录")).toBeInTheDocument();
    expect(screen.queryByText("/records/pending?bookId=book_test")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开待确认记录" }));
    expect(window.location.pathname).toBe("/home");
    expect(await screen.findByRole("heading", { name: "待确认记录" })).toBeInTheDocument();
  });
  it("sends AI text to the action API and renders structured response cards", async () => {
    const user = userEvent.setup();
    plan = "pro";
    render(<App />);

    await user.click(await screen.findByLabelText("打开 AI 助手"));
    await user.type(await screen.findByPlaceholderText("输入消息..."), "昨天午饭 38");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(aiChatRequests).toHaveLength(1));
    expect(aiChatRequests[0]).toMatchObject({ message: "昨天午饭 38", bookId: "book_test" });
    expect(await screen.findByText("已记录")).toBeInTheDocument();
    expect(screen.getByText("餐饮 · 昨天午饭 38 · 2026-06-25")).toBeInTheDocument();
  });
  it("renders AI search result parts as structured cards without raw links", async () => {
    const user = userEvent.setup();
    plan = "pro";
    render(<App />);

    await user.click(await screen.findByLabelText("打开 AI 助手"));
    await user.type(await screen.findByPlaceholderText("输入消息..."), "搜索餐饮");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("搜索结果")).toBeInTheDocument();
    expect(screen.getAllByText("找到 1 条记录").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "打开记录页" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("/records?bookId=book_test&source=ai")).not.toBeInTheDocument();
  });
  it("moves generic AI confirmations to the composer confirmation bar and renders confirm response parts", async () => {
    const user = userEvent.setup();
    plan = "pro";
    render(<App />);

    await user.click(await screen.findByLabelText("打开 AI 助手"));
    await user.type(await screen.findByPlaceholderText("输入消息..."), "确认动作");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const confirmation = await screen.findByLabelText("AI 操作确认");
    expect(within(confirmation).getByText("确认结算本月账本")).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "确认结算" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认" })).not.toBeInTheDocument();

    await user.click(within(confirmation).getByRole("button", { name: "确认结算" }));
    await waitFor(() =>
      expect(aiConfirmationRequests).toEqual(
        expect.arrayContaining([expect.stringContaining("/ai/confirmations/confirmation_generic/confirm")]),
      ),
    );
    expect(await screen.findByText("结算已确认")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "打开分析" })).toBeInTheDocument();
  });
  it("shows image attachment previews inside the AI composer and removes them", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, [
      new File(["image"], "receipt.jpg", { type: "image/jpeg" }),
      new File(["image"], "invoice.jpg", { type: "image/jpeg" }),
    ]);

    expect(screen.getByAltText("receipt.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("invoice.jpg")).toBeInTheDocument();
    expect(container.querySelector(".ai-composer .import-attachment-card")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "移除 receipt.jpg" }));
    expect(screen.queryByAltText("receipt.jpg")).not.toBeInTheDocument();
    expect(screen.getByAltText("invoice.jpg")).toBeInTheDocument();
  });
  it("rejects unsupported AI attachments before any save flow starts", async () => {
    const user = userEvent.setup({ applyAccept: false });
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["plain"], "notes.txt", { type: "text/plain" }));

    expect((await screen.findAllByText("当前只支持图片识别")).length).toBeGreaterThan(0);
    expect(container.querySelector(".ai-composer .import-attachment-card")).toBeNull();
    expect(importBatchRequests).toHaveLength(0);
  });
  it("shows a pending confirmation bar before saving AI attachments and calls the real import upload API", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["image"], "invoice.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "发送" }));

    const confirmation = await screen.findByLabelText("AI 操作确认");
    expect(aiChatRequests.at(-1)?.attachments?.[0]).toMatchObject({
      name: "invoice.jpg",
      type: "image/jpeg",
    });
    expect(within(confirmation).getByText("保存这些附件？")).toBeInTheDocument();
    expect(within(confirmation).getByText("invoice.jpg")).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并识别" })).not.toBeInTheDocument();
    expect(importBatchRequests).toHaveLength(0);

    await user.click(within(confirmation).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(aiConfirmationRequests).toEqual(
        expect.arrayContaining([expect.stringContaining("/ai/confirmations/local_attachment/confirm")]),
      ),
    );
    expect(importBatchRequests).toHaveLength(0);
    expect(await screen.findByText("图片识别")).toBeInTheDocument();
    expect(await screen.findByText("OCR 12%")).toBeInTheDocument();
  });
  it("uses backend save intent for AI attachments before uploading", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["image"], "invoice.jpg", { type: "image/jpeg" }));
    await user.type(await screen.findByPlaceholderText("输入消息..."), "backend-save");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(aiChatRequests.at(-1)?.attachments?.[0]).toMatchObject({ name: "invoice.jpg" }),
    );
    await screen.findByText("图片识别");
    expect(screen.queryByLabelText("AI 操作确认")).not.toBeInTheDocument();
    expect(importBatchRequests).toHaveLength(0);
  });
  it("uses backend ignore intent to remove pending AI attachments without uploading", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["image"], "invoice.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByLabelText("AI 操作确认")).toBeInTheDocument();

    await user.type(await screen.findByPlaceholderText("输入消息..."), "backend-ignore");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.queryByLabelText("AI 操作确认")).not.toBeInTheDocument());
    expect(importBatchRequests).toHaveLength(0);
    expect(container.querySelector(".ai-composer .import-attachment-card")).toBeNull();
  });
  it("cancels pending AI attachment confirmation without uploading", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["image"], "invoice.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "发送" }));

    const confirmation = await screen.findByLabelText("AI 操作确认");
    await user.click(within(confirmation).getByRole("button", { name: "取消" }));

    expect(screen.queryByLabelText("AI 操作确认")).not.toBeInTheDocument();
    expect(importBatchRequests).toHaveLength(0);
    expect(container.querySelector(".ai-composer .import-attachment-card")).toBeNull();
  });
  it("times out pending AI attachment confirmation and removes it", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const { container } = render(<App />);
    await user.click(await screen.findByLabelText("打开 AI 助手"));
    const fileInput = container.querySelector('.ai-composer input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, new File(["image"], "invoice.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByLabelText("AI 操作确认")).toBeInTheDocument();
    vi.useFakeTimers();
    act(() => {
      fireEvent.change(screen.getByPlaceholderText("输入消息..."), { target: { value: " " } });
    });
    act(() => {
      vi.advanceTimersByTime(10_500);
    });

    expect(screen.queryByLabelText("AI 操作确认")).not.toBeInTheDocument();
    expect(importBatchRequests).toHaveLength(0);
  });
  it("falls back to the first book when the last active book is unavailable", async () => {
    window.localStorage.setItem("shared-ledger:last-active-book-id:user_test", "missing_book");
    render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(window.localStorage.getItem("shared-ledger:last-active-book-id:user_test")).toBe("book_test");
  });
  it("shows the first book by default on analysis and switches by URL query", async () => {
    const user = userEvent.setup();
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_home",
          type: "expense",
          amount: 100,
          note: "餐饮",
          occurredAt: "2026-07-01",
          categoryId: "cat_food",
        },
      ],
      book_b: [
        {
          id: "tx_travel",
          type: "expense",
          amount: 300,
          note: "酒店",
          occurredAt: "2026-07-02",
        },
      ],
    };
    window.history.pushState({}, "", "/analysis");
    render(<App />);

    const ledgerButton = await findBookSwitcher();
    expect(ledgerButton).toBeInTheDocument();
    expect(ledgerButton).not.toHaveTextContent("·");
    expect((await screen.findAllByText(/100\.00/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: bookSwitcherName("家庭账本") }));
    await user.click(await screen.findByRole("button", { name: /旅行账本/ }));

    expect(window.location.pathname).toBe("/analysis");
    expect(window.location.search).toContain("bookId=book_b");
    expect(await findBookSwitcher("旅行账本")).toBeInTheDocument();
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "3 个月" }));
    expect(screen.getByRole("button", { name: "3 个月" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "本月" })).not.toHaveClass("active");
  });
  it("opens analysis directly with the requested book selected", async () => {
    transactionsByBook = {
      ...transactionsByBook,
      book_b: [
        {
          id: "tx_travel",
          type: "expense",
          amount: 300,
          note: "酒店",
          occurredAt: "2026-07-02",
        },
      ],
    };
    window.history.pushState({}, "", "/analysis?bookId=book_b");
    render(<App />);

    expect(await findBookSwitcher("旅行账本")).toBeInTheDocument();
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);
  });
  it("uses a compact top analysis AI action instead of a top bar AI button or bottom card", async () => {
    const user = userEvent.setup();
    plan = "pro";
    window.history.pushState({}, "", "/analysis?bookId=book_test");
    const { container } = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.queryByText("总支出")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
    expect(screen.queryByText("想看更细的原因？")).not.toBeInTheDocument();
    expect(container.querySelector(".ios-ai-analysis-card")).toBeNull();
    const aiAnalysisLink = await screen.findByRole("button", { name: /用 AI 做更多分析/ });
    expect(aiAnalysisLink.closest(".ios-analysis-ai-action")).toBeInTheDocument();

    await user.click(aiAnalysisLink);

    expect(window.location.pathname).toBe("/analysis");
    expect(await screen.findByRole("heading", { name: "新会话" })).toBeInTheDocument();
  });
  it("shows an empty analysis state when there are no books", async () => {
    bookList = [];
    transactionsByBook = {};
    window.history.pushState({}, "", "/analysis");
    render(<App />);

    expect(await screen.findByText("当前还没有账本")).toBeInTheDocument();
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();
    expect(screen.queryByText("收支趋势")).not.toBeInTheDocument();
  });
  it("keeps records chrome minimal and renders the redesigned settings center", async () => {
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { unmount } = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "流水" })).not.toBeInTheDocument();

    unmount();
    window.history.pushState({}, "", "/settings?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("link", { name: /管理账本/ })).toHaveAttribute("href", "/books/manage");
    expect(screen.queryByRole("heading", { name: "我的" })).not.toBeInTheDocument();
    expect(screen.getByText("批量处理 · 高级分析")).toBeInTheDocument();
    expect(screen.queryByText("AI 识别 · 批量处理 · 高级分析")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /成员与邀请/ })).toHaveAttribute(
      "href",
      "/members?bookId=book_test",
    );
    expect(screen.queryByText("导入与识别")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /切换 \/ 管理账本/ })).not.toBeInTheDocument();
  });
  it("searches users explicitly before sending an invitation and never renders user ids", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/members?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "成员管理" })).toBeInTheDocument();
    expect(await screen.findByText("家庭账本")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /邀请成员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /屏蔽名单/ })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "邀请成员" }));
    const sheet = await screen.findByRole("dialog", { name: "邀请成员" });
    const searchInput = within(sheet).getByLabelText("搜索用户");
    await user.type(searchInput, "Friend");

    expect(userSearchRequests).toEqual([]);
    await user.click(within(sheet).getByRole("button", { name: /搜索/ }));

    expect(userSearchRequests).toEqual(["friend"]);
    expect(await screen.findByText("Friend")).toBeInTheDocument();
    expect(screen.getByText("可邀请")).toBeInTheDocument();
    expect(screen.queryByText(/user_friend/)).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "发送邀请" }));

    await waitFor(() => expect(mockInvitations).toHaveLength(1));
    expect(window.location.pathname).toBe("/members");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "邀请成员" })).not.toBeInTheDocument());
    expect(screen.queryByText(/user_/)).not.toBeInTheDocument();
  });
  it("shows inviter and book for received invitations and can decline with blocking", async () => {
    const user = userEvent.setup();
    mockInvitations = [
      {
        id: "invite_received",
        bookId: "book_b",
        inviterUserId: "user_inviter",
        inviteeUserId: "user_test",
        role: "member",
        status: "pending",
        expiresAt: "2026-07-09T00:00:00.000Z",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        direction: "received",
        book: { id: "book_b", name: "旅行账本", currency: "CNY" },
        inviter: mockUserSummary("user_inviter"),
        invitee: mockUserSummary("user_test"),
      },
    ];
    window.history.pushState({}, "", "/invitations?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "邀请记录" })).toBeInTheDocument();
    expect(await screen.findByText("邀请人")).toBeInTheDocument();
    expect(screen.getByText(/旅行账本/)).toBeInTheDocument();
    expect(screen.queryByText(/user_inviter/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "拒绝" }));
    const dialog = await screen.findByRole("alertdialog", { name: "拒绝邀请" });
    await user.click(within(dialog).getByRole("button", { name: "拒绝并屏蔽" }));

    await waitFor(() => expect(mockInvitations[0].status).toBe("declined"));
    await user.click(screen.getByRole("button", { name: "屏蔽" }));
    expect(await screen.findByText("对方无法搜索到你或邀请你")).toBeInTheDocument();
  });
  it("counts sent pending or declined invitations as badge items until the invitation page is viewed", async () => {
    const user = userEvent.setup();
    mockInvitations = [
      {
        id: "invite_declined",
        bookId: "book_test",
        inviterUserId: "user_test",
        inviteeUserId: "user_friend",
        role: "member",
        status: "declined",
        expiresAt: "2026-07-09T00:00:00.000Z",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        direction: "sent",
        book: mockBookSummary("book_test"),
        inviter: mockUserSummary("user_test"),
        invitee: mockUserSummary("user_friend"),
      },
    ];
    window.history.pushState({}, "", "/settings?bookId=book_test");
    render(<App />);

    const membersLink = await screen.findByRole("link", { name: /成员与邀请/ });
    await waitFor(() => expect(within(membersLink).getByText("1")).toBeInTheDocument());

    await user.click(membersLink);
    expect(await screen.findByRole("heading", { name: "成员管理" })).toBeInTheDocument();
    expect(
      within(await screen.findByRole("link", { name: /邀请记录/ })).getByText(/查看收到/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /邀请记录/ }));
    expect(await screen.findByRole("heading", { name: "邀请记录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByRole("heading", { name: "成员管理" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回" }));

    const viewedMembersLink = await screen.findByRole("link", { name: /成员与邀请/ });
    expect(within(viewedMembersLink).queryByText("1")).not.toBeInTheDocument();
  });
  it("opens book management details from the manage list and supports rename and delete", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/books/manage?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "管理账本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /旅行账本/ }));

    expect(window.location.pathname).toBe("/books/book_b/settings");
    expect(await screen.findByRole("heading", { name: "账本设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();

    const nameInput = await screen.findByLabelText("账本名称");
    await user.clear(nameInput);
    await user.type(nameInput, "出差账本");
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() =>
      expect(bookMutationRequests).toContainEqual(
        expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ name: "出差账本" }) }),
      ),
    );
    expect(await screen.findByText("出差账本")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除账本" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除账本" });
    await user.click(within(dialog).getByRole("button", { name: "删除账本" }));

    await waitFor(() => expect(window.location.pathname).toBe("/books/manage"));
    expect(bookMutationRequests).toContainEqual(expect.objectContaining({ method: "DELETE" }));
    expect(bookList.some((item) => item.id === "book_b")).toBe(false);
  });
  it("switches books from the records page and refreshes the records list", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    await user.click(await findBookSwitcher());
    await user.click(await screen.findByRole("button", { name: /旅行账本/ }));

    expect(window.location.pathname).toBe("/records");
    expect(window.location.search).toContain("bookId=book_b");
    expect(await findBookSwitcher("旅行账本")).toBeInTheDocument();
    await waitFor(() => expect(recordRow(container, "tx_travel")).toBeInTheDocument());
    expect(recordRow(container, "tx_home")).not.toBeInTheDocument();
  });
  it("navigates from the add menu manual action to the add record form", async () => {
    const user = userEvent.setup();
    plan = "pro";
    render(<App />);

    await findBookSwitcher();
    await user.click(await screen.findByRole("button", { name: "打开添加菜单" }));
    await waitFor(() => expect(queryAddOverlay()).toBeInTheDocument());
    await user.click(screen.getByRole("menuitem", { name: /手动添加/ }));

    expect(await screen.findByRole("heading", { name: "记一笔支出" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
  });
  it("uploads supported images from the add menu and opens import history for pro users", async () => {
    const user = userEvent.setup();
    plan = "pro";
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    render(<App />);

    await findBookSwitcher();
    const input = await waitFor(() => {
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!fileInput) throw new Error("Expected upload input to be rendered");
      return fileInput;
    });
    await user.click(await screen.findByRole("button", { name: "打开添加菜单" }));
    await waitFor(() => expect(queryAddOverlay()).toBeInTheDocument());
    await user.click(screen.getByRole("menuitem", { name: /上传图片/ }));
    await user.upload(input, file);

    await waitFor(() => expect(importBatchRequests).toHaveLength(1));
    expect(importBatchRequests[0]).toMatchObject({
      path: expect.stringContaining("/books/book_test/imports/batch"),
      files: ["receipt.png"],
      autoConfirm: null,
    });
    expect(window.location.pathname).toBe("/home");
    expect(await screen.findByRole("heading", { name: "识别进度" })).toBeInTheDocument();
  });
  it("hides image upload entry from the add menu for free users", async () => {
    const user = userEvent.setup();
    plan = "free";
    render(<App />);

    await findBookSwitcher();
    await user.click(await screen.findByRole("button", { name: "记一笔" }));

    expect(await screen.findByRole("heading", { name: "记一笔支出" })).toBeInTheDocument();
    expect(queryAddOverlay()).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /上传图片/ })).not.toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="上传图片"]')).not.toBeInTheDocument();
  });
  it("does not show the old records import entry", async () => {
    window.history.pushState({}, "", "/records");
    render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.queryByText("导入与识别")).not.toBeInTheDocument();
    expect(screen.queryByText("上传图片记一笔")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择文件" })).not.toBeInTheDocument();
  });
  it("redirects old import history routes back to records", async () => {
    window.history.pushState({}, "", "/records/imports?bookId=book_test");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/records"));
    expect(screen.queryByRole("button", { name: /^拍照(\s|$)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^相册(\s|$)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^文件(\s|$)/ })).not.toBeInTheDocument();
  });
  it("keeps base record filters and sort in URL parameters", async () => {
    const user = userEvent.setup();
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_home",
          type: "expense",
          amount: 100,
          note: "早餐",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
        {
          id: "tx_salary",
          type: "income",
          amount: 8000,
          note: "工资",
          occurredAt: "2026-06-15",
          categoryId: "cat_salary",
        },
        {
          id: "tx_ride",
          type: "expense",
          amount: 30,
          note: "打车",
          occurredAt: "2026-05-20",
          categoryId: "cat_food",
        },
      ],
    };
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/books/book_test/transactions"),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(recordRow(container, "tx_home")).toBeInTheDocument());
    expect(recordRow(container, "tx_salary")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "筛选记录" }));
    let filterDialog = await screen.findByRole("dialog", { name: "筛选流水" });
    await user.click(within(filterDialog).getByRole("button", { name: "支出" }));
    await user.click(within(filterDialog).getByRole("button", { name: "金额最高" }));
    await user.type(within(filterDialog).getByLabelText("最小金额"), "20");
    await user.type(within(filterDialog).getByLabelText("最大金额"), "150");
    await user.type(within(filterDialog).getByLabelText("分类关键词"), "餐");
    await user.click(within(filterDialog).getByRole("button", { name: "应用筛选" }));
    expect(window.location.search).toContain("type=expense");
    expect(window.location.search).toContain("sort=amount_desc");
    expect(window.location.search).toContain("min=20");
    expect(window.location.search).toContain("max=150");
    expect(window.location.search).toContain("category=%E9%A4%90");
    expect(screen.getByText("已筛选")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
    await waitFor(() => expect(recordRow(container, "tx_home")).toBeInTheDocument());
    expect(recordRow(container, "tx_ride")).toBeInTheDocument();
    expect(recordRow(container, "tx_salary")).not.toBeInTheDocument();
    expect(
      recordRows(container)
        .map((row) => row.dataset.transactionId)
        .slice(0, 2),
    ).toEqual(["tx_home", "tx_ride"]);

    await user.click(screen.getByRole("button", { name: "筛选记录" }));
    filterDialog = await screen.findByRole("dialog", { name: "筛选流水" });
    await user.click(within(filterDialog).getByRole("button", { name: "重置" }));
    expect(window.location.search).not.toContain("type=");
    expect(window.location.search).not.toContain("sort=");
    expect(window.location.search).not.toContain("q=");
    await waitFor(() => expect(recordRow(container, "tx_salary")).toBeInTheDocument());
  });
  it("uses ordinary record search for free users", async () => {
    const user = userEvent.setup();
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_breakfast",
          type: "expense",
          amount: 100,
          note: "早餐",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
        {
          id: "tx_salary",
          type: "income",
          amount: 8000,
          note: "工资",
          occurredAt: "2026-06-20",
          categoryId: "cat_salary",
        },
      ],
    };
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    const searchInput = await screen.findByLabelText("搜索流水");
    const searchForm = searchInput.closest("form");

    expect(searchForm?.firstElementChild).toBe(searchInput);
    expect(searchInput).toHaveAttribute("placeholder", "搜索记录");
    expect(
      within(searchForm as HTMLElement).queryByRole("button", { name: "AI 搜索" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("打开 AI 助手")).not.toBeInTheDocument();

    await user.type(searchInput, "工资{Enter}");

    await waitFor(() => expect(window.location.search).toContain("q=%E5%B7%A5%E8%B5%84"));
    expect(window.location.search).not.toContain("source=ai");
    expect(aiSearchRequests).toHaveLength(0);
    await waitFor(() => expect(recordRow(container, "tx_salary")).toBeInTheDocument());
    expect(recordRow(container, "tx_breakfast")).not.toBeInTheDocument();
  });
  it("renders compact record rows with category names, note/type copy, and amount", async () => {
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_blank",
          type: "expense",
          amount: 500,
          occurredAt: "2026-06-27T08:00:00.000Z",
          categoryId: "cat_food",
        },
      ],
    };
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    await waitFor(() => expect(recordRow(container, "tx_blank")).toBeInTheDocument());
    const row = recordRow(container, "tx_blank");

    expect(row).toHaveAttribute("data-transaction-id", "tx_blank");
    expect(row).toHaveTextContent("餐饮");
    expect(row).toHaveTextContent("无备注");
    expect(row).toHaveTextContent("支出");
    expect(row).toHaveTextContent("-¥500.00");
    expect(row).not.toHaveTextContent("未命名记录");
    expect(row).not.toHaveTextContent("08:00");
    expect(row?.querySelector(".ios-transaction-dot")).not.toBeInTheDocument();
    expect(row?.querySelector(".ios-transaction-category-name")).toHaveTextContent("餐饮");
    expect(row?.querySelector(".ios-transaction-copy small.expense")).toHaveTextContent("支出");
  });
  it("runs natural language AI record search and persists returned filters", async () => {
    const user = userEvent.setup();
    plan = "pro";
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_breakfast",
          type: "expense",
          amount: 100,
          note: "早餐",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
        {
          id: "tx_party",
          type: "expense",
          amount: 120,
          note: "年会餐费",
          occurredAt: "2026-06-15",
          categoryId: "cat_food",
        },
        {
          id: "tx_salary",
          type: "income",
          amount: 8000,
          note: "工资",
          occurredAt: "2026-06-20",
          categoryId: "cat_salary",
        },
        {
          id: "tx_old",
          type: "expense",
          amount: 300,
          note: "去年餐费",
          occurredAt: "2025-12-31",
          categoryId: "cat_food",
        },
      ],
    };
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    const searchInput = screen.getByLabelText("搜索流水");
    const searchForm = searchInput.closest("form");
    expect(searchForm?.firstElementChild).toBe(searchInput);
    expect(within(searchForm as HTMLElement).queryByText("AI")).not.toBeInTheDocument();
    const aiSearchButton = within(searchForm as HTMLElement).getByRole("button", { name: "AI 搜索" });
    expect(aiSearchButton).toBeDisabled();
    expect(aiSearchButton.querySelector("svg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "筛选记录" }));
    const filterDialog = await screen.findByRole("dialog", { name: "筛选流水" });
    await user.click(within(filterDialog).getByRole("button", { name: "支出" }));
    await user.click(within(filterDialog).getByRole("button", { name: "金额最高" }));
    await user.click(within(filterDialog).getByRole("button", { name: "应用筛选" }));

    await user.type(screen.getByLabelText("搜索流水"), "今年大于100的餐饮支出");
    await user.click(screen.getByRole("button", { name: "AI 搜索" }));

    await waitFor(() => expect(aiSearchRequests).toHaveLength(1));
    expect(aiSearchRequests[0]).toMatchObject({
      bookId: "book_test",
      query: "今年大于100的餐饮支出",
      baseFilters: { type: "expense", sort: "amount_desc" },
    });
    expect(aiSearchRequests[0]?.timeZone).toEqual(expect.any(String));
    expect(window.location.search).toContain("source=ai");
    expect(window.location.search).toContain("q=%E4%BB%8A%E5%B9%B4%E5%A4%A7%E4%BA%8E100");
    expect(window.location.search).toContain("min=100");
    expect(window.location.search).toContain("minStrict=1");
    expect(window.location.search).toContain("category=cat_food");
    expect(screen.getByText("AI 筛选")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
    await waitFor(() => expect(recordRow(container, "tx_party")).toBeInTheDocument());
    expect(recordRow(container, "tx_breakfast")).not.toBeInTheDocument();
    expect(recordRow(container, "tx_salary")).not.toBeInTheDocument();
    expect(recordRow(container, "tx_old")).not.toBeInTheDocument();
    expect(screen.getByText("今年")).toBeInTheDocument();
  });
  it("applies AI record filters from URL parameters and renders the AI reset bar", async () => {
    const user = userEvent.setup();
    plan = "pro";
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_breakfast",
          type: "expense",
          amount: 100,
          note: "早餐",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
        {
          id: "tx_party",
          type: "expense",
          amount: 120,
          note: "年会餐费",
          occurredAt: "2026-06-15",
          categoryId: "cat_food",
        },
        {
          id: "tx_salary",
          type: "income",
          amount: 8000,
          note: "工资",
          occurredAt: "2026-06-20",
          categoryId: "cat_salary",
        },
        {
          id: "tx_old",
          type: "expense",
          amount: 300,
          note: "去年餐费",
          occurredAt: "2025-12-31",
          categoryId: "cat_food",
        },
      ],
    };
    const aiParams = new URLSearchParams({
      bookId: "book_test",
      type: "expense",
      start: "2026-01-01",
      end: "2026-12-31",
      min: "100",
      source: "ai",
      sort: "latest",
      chips: "今年|支出|金额 > 100",
      minStrict: "1",
    });
    window.history.pushState({}, "", `/records?${aiParams.toString()}`);
    const firstRender = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.getByText("AI 筛选")).toBeInTheDocument();
    expect(screen.getByText("今年")).toBeInTheDocument();
    await waitFor(() => expect(recordRow(firstRender.container, "tx_party")).toBeInTheDocument());
    expect(recordRow(firstRender.container, "tx_breakfast")).not.toBeInTheDocument();
    expect(recordRow(firstRender.container, "tx_salary")).not.toBeInTheDocument();
    expect(recordRow(firstRender.container, "tx_old")).not.toBeInTheDocument();

    firstRender.unmount();
    const secondRender = render(<App />);
    expect(await screen.findByText("AI 筛选")).toBeInTheDocument();
    await waitFor(() => expect(recordRow(secondRender.container, "tx_party")).toBeInTheDocument());
    expect(recordRow(secondRender.container, "tx_salary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "筛选记录" }));
    const filterDialog = await screen.findByRole("dialog", { name: "筛选流水" });
    await user.click(within(filterDialog).getByRole("button", { name: "重置" }));
    expect(window.location.search).toBe("?bookId=book_test");
    await waitFor(() => expect(recordRow(secondRender.container, "tx_breakfast")).toBeInTheDocument());
    expect(recordRow(secondRender.container, "tx_salary")).toBeInTheDocument();
    expect(recordRow(secondRender.container, "tx_old")).toBeInTheDocument();
    expect(screen.queryByText("AI 筛选")).not.toBeInTheDocument();
  });
  it("hides AI filter labeling from free users when old AI filter URLs are opened", async () => {
    transactionsByBook = {
      ...transactionsByBook,
      book_test: [
        {
          id: "tx_breakfast",
          type: "expense",
          amount: 100,
          note: "早餐",
          occurredAt: "2026-06-01",
          categoryId: "cat_food",
        },
        {
          id: "tx_salary",
          type: "income",
          amount: 8000,
          note: "工资",
          occurredAt: "2026-06-20",
          categoryId: "cat_salary",
        },
      ],
    };
    const aiParams = new URLSearchParams({
      bookId: "book_test",
      q: "工资",
      source: "ai",
      chips: "AI 查询",
    });
    window.history.pushState({}, "", `/records?${aiParams.toString()}`);
    const { container } = render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(screen.queryByText("AI 筛选")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 查询")).not.toBeInTheDocument();
    expect(screen.getByText("已筛选")).toBeInTheDocument();
    await waitFor(() => expect(recordRow(container, "tx_salary")).toBeInTheDocument());
    expect(recordRow(container, "tx_breakfast")).not.toBeInTheDocument();
  });
  it("renders the redesigned record form with custom keypad, category strip, and pro image control", async () => {
    const user = userEvent.setup();
    plan = "pro";
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    expect(screen.queryByLabelText("分类", { selector: "select" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存支出" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并继续" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "餐饮" })).toBeInTheDocument();
    expect(screen.getByLabelText("日期")).toHaveAttribute("type", "date");
    expect(screen.getByRole("button", { name: "图片识别" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("添加备注…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加明细" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.queryByText("成员")).not.toBeInTheDocument();
    expect(screen.queryByText("标签")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收入" }));
    expect(await screen.findByRole("heading", { name: "记一笔收入" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "工资" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存收入" })).toBeInTheDocument();
  });
  it("preserves amount and line items after returning from the line item sheet", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加明细" }));
    expect(window.location.pathname).toBe("/home");
    expect(await screen.findByText("请先输入总金额")).toBeInTheDocument();

    for (const key of ["1", "2", "8", ".", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "添加明细" }));

    expect(window.location.pathname).toBe("/home");
    expect(await screen.findByRole("heading", { name: "添加明细" })).toBeInTheDocument();
    expect(screen.getAllByText(/128\.50/).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("明细名称"), "牛奶");
    await user.type(screen.getByLabelText("明细金额"), "128.5");

    await user.click(screen.getByRole("button", { name: /保存明细/ }));

    expect(window.location.pathname).toBe("/home");
    expect(await screen.findByRole("heading", { name: "记一笔支出" })).toBeInTheDocument();
    expect(screen.getByText("128.5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加明细（1）" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "餐饮" }));
    await user.click(screen.getByRole("button", { name: "保存支出" }));
    await waitFor(() => expect(transactionRequests).toHaveLength(1));
    expect(transactionRequests[0]?.body).toMatchObject({
      amount: 128.5,
      categoryId: "cat_food",
      items: [{ name: "牛奶", amount: 128.5 }],
    });
  });
  it("starts line items empty and can add or delete rows", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    for (const key of ["1", "2", "8", ".", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "添加明细" }));
    expect(await screen.findByRole("heading", { name: "添加明细" })).toBeInTheDocument();
    expect(screen.getAllByText(/128\.50/).length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("牛奶")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("水果")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("明细名称")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "添加明细" }));
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
  it("requires a positive amount before saving a record", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("添加备注…"), "咖啡");
    await user.click(screen.getByRole("button", { name: "保存支出" }));

    expect(await screen.findByText("金额必须大于 0")).toBeInTheDocument();
    expect(transactionRequests).toHaveLength(0);
    expect(screen.getByPlaceholderText("添加备注…")).toHaveValue("咖啡");
  });
  it("saves a record and keeps entering another one", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收入" }));
    for (const key of ["2", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.type(screen.getByPlaceholderText("添加备注…"), "第一笔");
    await user.click(await screen.findByRole("button", { name: "工资" }));
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(transactionRequests).toHaveLength(1));
    expect(window.location.pathname).toBe("/home");
    expect(screen.getByRole("heading", { name: "记一笔收入" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("0", { selector: ".ios-amount-panel strong" })).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("添加备注…")).toHaveValue("");

    for (const key of ["3", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.type(screen.getByPlaceholderText("添加备注…"), "第二笔");
    await user.click(await screen.findByRole("button", { name: "工资" }));
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(transactionRequests).toHaveLength(2));
    expect(transactionRequests[0]).toMatchObject({
      body: { type: "income", amount: 20, categoryId: "cat_salary", note: "第一笔" },
    });
    expect(transactionRequests[1]).toMatchObject({
      body: { type: "income", amount: 30, categoryId: "cat_salary", note: "第二笔" },
    });
  });
  it("keeps the current draft when save and continue fails", async () => {
    const user = userEvent.setup();
    transactionError = "保存失败";
    window.history.pushState({}, "", "/home?bookId=book_test");
    render(<App />);

    expect(await openManualAddForm(user)).toBeInTheDocument();
    for (const key of ["4", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.type(screen.getByPlaceholderText("添加备注…"), "不能丢");
    await user.click(await screen.findByRole("button", { name: "餐饮" }));
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("添加备注…")).toHaveValue("不能丢");
  });
  it("does not show save and continue when editing a record", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/records?bookId=book_test");
    const { container } = render(<App />);

    await waitFor(() => expect(recordRow(container, "tx_home")).toBeInTheDocument());
    await user.click(recordRow(container, "tx_home")!);
    expect(window.location.pathname).toBe("/records");
    expect(await screen.findByRole("heading", { name: "交易详情" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByRole("heading", { name: "编辑记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并继续" })).not.toBeInTheDocument();
  });
  it("redirects anonymous users to login", async () => {
    authMode = "signed-out";
    window.history.pushState({}, "", "/records");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toContain("redirect=%2Frecords");
  });
  it("redirects signed-in users away from login", async () => {
    window.history.pushState({}, "", "/login?redirect=%2F");
    render(<App />);

    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
    expect(window.location.search).toContain("bookId=book_test");
    expect(screen.queryByRole("heading", { name: "欢迎回来" })).not.toBeInTheDocument();
  });
  it("continues to the requested redirect after successful login", async () => {
    const user = userEvent.setup();
    authMode = "signed-out";
    window.history.pushState({}, "", "/login?redirect=%2Frecords%3FbookId%3Dbook_test");
    const { container } = render(<App />);

    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("用户名"), "test");
    await user.type(screen.getByLabelText("密码"), "123456");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(window.location.pathname).toBe("/records"));
    expect(window.location.search).toContain("bookId=book_test");
    await waitFor(() => expect(recordRow(container, "tx_home")).toBeInTheDocument());
  });
  it("refreshes an expired access session before rendering protected pages", async () => {
    authMode = "expired-once";
    render(<App />);
    expect(await findBookSwitcher()).toBeInTheDocument();
    expect(authMeCalls).toBe(2);
  });
  it("enters the home page immediately after successful registration", async () => {
    const user = userEvent.setup();
    authMode = "signed-out";
    window.localStorage.setItem("shared-ledger:last-active-book-id:user_registered", "book_test");
    window.history.pushState({}, "", "/register");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "创建账号" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("用户名"), "new-user");
    await user.type(screen.getByLabelText("密码"), "123456");
    await user.type(screen.getByLabelText("确认密码"), "123456");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await findBookSwitcher("new-user")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/home");
    expect(window.location.search).toContain("bookId=book_registered");
    expect(screen.queryByText("你不是该账本成员")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("shared-ledger:last-active-book-id:user_registered")).toBe(
      "book_registered",
    );
    expect(authMeCalls).toBe(1);
  });
  it("clears the active book state on logout", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("shared-ledger:last-active-book-id:user_test", "book_test");
    window.history.pushState({}, "", "/settings?bookId=book_test");
    render(<App />);

    expect(await screen.findByRole("link", { name: /管理账本/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    const dialog = await screen.findByRole("alertdialog", { name: "退出登录" });
    await user.click(within(dialog).getByRole("button", { name: "退出登录" }));

    await waitFor(() =>
      expect(window.localStorage.getItem("shared-ledger:last-active-book-id:user_test")).toBeNull(),
    );
    expect(window.location.pathname).toBe("/login");
  });
  it("keeps login and register form state separate", async () => {
    const user = userEvent.setup();
    authMode = "signed-out";
    loginError = "用户名或密码错误";
    window.history.pushState({}, "", "/login");
    render(<App />);

    await user.type(await screen.findByLabelText("用户名"), "login-user");
    await user.type(screen.getByLabelText("密码"), "login-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("用户名或密码错误")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "立即注册" }));
    expect(document.querySelector(".ios-auth-page .field-error")).not.toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(screen.getByLabelText("确认密码")).toHaveValue("");
  });
  it("toggles password visibility on login and register forms", async () => {
    const user = userEvent.setup();
    authMode = "signed-out";
    window.history.pushState({}, "", "/login");
    render(<App />);

    const loginPassword = await screen.findByLabelText("密码");
    expect(loginPassword).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(loginPassword).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(loginPassword).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("link", { name: "立即注册" }));
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
