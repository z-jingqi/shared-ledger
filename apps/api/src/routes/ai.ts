import type { Hono } from "hono";
import type { AiChatMessage } from "@shared-ledger/ai";
import { getLedgerSkill, listLedgerSkills } from "@shared-ledger/ledger-skills";
import { z } from "zod";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import { aiErrorBody, aiErrorStatus, runtimeAiProvider } from "../services/ai";
import {
  cancelAiToolConfirmation,
  confirmAiTool,
  executeAiTool,
  type AiToolRepository,
} from "../services/ai-tools";
import type { MemoryLedgerStore } from "../store";
import type { Env, LedgerUser } from "../types";

type AiRequestBody = {
  message: string;
  bookId?: string;
  page?: string;
  timeZone?: string;
  attachments: File[];
};

const sessionPatchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  bookId: z.string().trim().min(1).nullable().optional(),
});

function testMemoryEnabled(context: any, store?: MemoryLedgerStore) {
  return Boolean(
    store && context.env?.APP_ENV === "test" && context.req.header("x-ai-test-memory") === "true",
  );
}

function aiRepository(context: any, store?: MemoryLedgerStore): AiToolRepository | undefined {
  if (context.env.DB) return new D1LedgerRepository(context.env.DB);
  return testMemoryEnabled(context, store) ? store : undefined;
}

function requireAiRepository(context: any, store?: MemoryLedgerStore) {
  const repository = aiRepository(context, store);
  return repository ?? jsonError(context, "AI 需要 D1 运行时或测试内存运行时", 503);
}

export function registerAiRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.post("/ai/sessions", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = (await context.req.json().catch(() => ({}))) as { bookId?: string; title?: string };
    if (body.bookId) {
      const denied = await requireMember(context, store, body.bookId, user);
      if (denied) return denied;
    }
    const session =
      repository instanceof D1LedgerRepository
        ? await repository.createAiSession(user.id, body.bookId, body.title?.trim() || "新会话")
        : createMemorySession(repository, user.id, body.bookId, body.title?.trim() || "新会话");
    return context.json({ session }, 201);
  });

  app.get("/ai/sessions", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const sessions =
      repository instanceof D1LedgerRepository
        ? await repository.listAiSessions(user.id)
        : memorySessions(repository, user.id);
    return context.json({ sessions });
  });

  app.get("/ai/sessions/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const session =
      repository instanceof D1LedgerRepository
        ? await repository.getAiSession(user.id, context.req.param("id"))
        : memorySession(repository, user.id, context.req.param("id"));
    return session ? context.json({ session }) : jsonError(context, "会话不存在", 404);
  });

  app.patch("/ai/sessions/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const parsed = sessionPatchSchema.safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(context, "会话数据不合法");
    const session =
      repository instanceof D1LedgerRepository
        ? await repository.updateAiSession(user.id, context.req.param("id"), parsed.data)
        : updateMemorySession(repository, user.id, context.req.param("id"), parsed.data);
    return session ? context.json({ session }) : jsonError(context, "会话不存在", 404);
  });

  app.delete("/ai/sessions/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    if (repository instanceof D1LedgerRepository)
      await repository.deleteAiSession(user.id, context.req.param("id"));
    else deleteMemorySession(repository, user.id, context.req.param("id"));
    return context.body(null, 204);
  });

  app.post("/ai/sessions/:id/messages", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = await readAiRequest(context);
    try {
      const result = await runAiMessage(context, store, repository, user, context.req.param("id"), body);
      if (result instanceof Response) return result;
      return context.json(result);
    } catch (error) {
      return context.json(aiErrorBody(error), aiErrorStatus(error));
    }
  });

  app.post("/ai/sessions/:id/messages/stream", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = await readAiRequest(context);
    const encoder = new TextEncoder();
    const signal = context.req.raw.signal;
    const sendEvent = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      event: string,
      data: unknown,
    ) => {
      if (!signal.aborted)
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const result = await runAiMessage(context, store, repository, user, context.req.param("id"), body, {
            onEvent: (event, data) => sendEvent(controller, event, data),
            signal,
          });
          if (!(result instanceof Response)) sendEvent(controller, "done", result);
        } catch (error) {
          const body = aiErrorBody(error);
          sendEvent(controller, "error", {
            message: body.error,
            code: body.code,
            requestId: body.requestId,
            details: body.details,
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });

  app.post("/ai/confirmations/:id/confirm", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const runtime = {
      env: context.env,
      repository,
      store,
      user,
      sessionId: "confirmation",
      prompt: "",
      today: today(),
      timeZone: "Asia/Shanghai",
      origin: new URL(context.req.url).origin,
      attachments: [],
    };
    const result = await confirmAiTool(runtime, context.req.param("id"));
    return "error" in result.body
      ? jsonError(context, result.body.error ?? "确认失败", result.status)
      : context.json(result.body, result.status as 200);
  });

  app.post("/ai/confirmations/:id/cancel", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const result = await cancelAiToolConfirmation(repository, user.id, context.req.param("id"));
    return "error" in result.body
      ? jsonError(context, result.body.error ?? "取消确认失败", result.status)
      : context.json(result.body, result.status as 200);
  });
}

async function runAiMessage(
  context: any,
  store: MemoryLedgerStore | undefined,
  repository: AiToolRepository,
  user: LedgerUser,
  sessionId: string,
  body: AiRequestBody,
  stream?: { onEvent: (event: string, data: unknown) => void; signal: AbortSignal },
) {
  const session =
    repository instanceof D1LedgerRepository
      ? await repository.getAiSession(user.id, sessionId)
      : memorySession(repository, user.id, sessionId);
  if (!session) return jsonError(context, "会话不存在", 404);
  const bookId = body.bookId ?? session.bookId;
  if (bookId) {
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
  }
  const prompt = body.message.trim();
  if (!prompt && !body.attachments.length) return jsonError(context, "请输入消息或上传图片");
  await appendMessage(
    repository,
    sessionId,
    user.id,
    "user",
    prompt || "上传图片",
    undefined,
    attachmentMetadata(body.attachments),
  );
  const provider = runtimeAiProvider(context.env, user);
  const contextSnapshot = await buildModelContext(repository, user, bookId);
  const run =
    repository instanceof D1LedgerRepository
      ? await repository.createAiRun({
          sessionId,
          userId: user.id,
          bookId,
          input: { message: prompt, page: body.page, attachments: attachmentMetadata(body.attachments) },
        })
      : undefined;
  const skillSelection = await provider.selectSkill({
    text: prompt || "用户上传了附件",
    userId: user.id,
    bookId,
    page: body.page ?? "AI 助手",
    today: today(),
    timeZone: body.timeZone ?? "Asia/Shanghai",
    skills: listLedgerSkills(),
    context: contextSnapshot,
    attachments: attachmentMetadata(body.attachments),
  });
  stream?.onEvent("skill_selected", skillSelection);
  if (run && repository instanceof D1LedgerRepository) {
    await repository.updateAiRun(
      run.id,
      { status: "running", selectedSkill: skillSelection.skillName },
      user.id,
    );
    await repository.appendAiStep({
      runId: run.id,
      stepIndex: 0,
      kind: "skill_selected",
      status: "completed",
      skillName: skillSelection.skillName,
      output: skillSelection,
      actorId: user.id,
    });
  }
  const runtime = {
    env: context.env,
    repository,
    store,
    user,
    sessionId,
    bookId,
    prompt,
    today: today(),
    timeZone: body.timeZone ?? "Asia/Shanghai",
    origin: new URL(context.req.url).origin,
    attachments: body.attachments,
  };
  let parts: Array<Record<string, any>>;
  if (skillSelection.skillName === "general.chat") {
    let text = "";
    if (stream) {
      const chatStream = provider.streamChat(chatHistoryMessages(session, prompt, body.attachments), {
        bookId: bookId ?? "",
        page: body.page,
      });
      for await (const delta of chatStream.textStream) {
        if (stream.signal.aborted)
          return {
            sessionId,
            message: { id: `ai_cancelled_${crypto.randomUUID()}`, role: "assistant" as const, parts: [] },
            parts: [],
          };
        text += delta;
        stream.onEvent("message_delta", { text: delta });
      }
    } else {
      text = await provider.chat({
        bookId: bookId ?? "",
        userId: user.id,
        page: body.page,
        text: prompt || attachmentChatPrompt(body.attachments),
      });
    }
    parts = [{ type: "text" as const, text }];
  } else {
    const selectedSkill = getLedgerSkill(skillSelection.skillName);
    if (!selectedSkill) throw new Error(`未知 Skill：${skillSelection.skillName}`);
    const maxSteps = 5;
    const observations: Array<Record<string, unknown>> = [];
    parts = [];
    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
      if (stream?.signal.aborted)
        return {
          sessionId,
          message: { id: `ai_cancelled_${crypto.randomUUID()}`, role: "assistant" as const, parts },
          parts,
        };
      const step = await provider.planSkillStep({
        text: prompt || "用户上传了附件",
        userId: user.id,
        bookId,
        page: body.page ?? "AI 助手",
        today: today(),
        timeZone: body.timeZone ?? "Asia/Shanghai",
        skills: listLedgerSkills(),
        selectedSkill,
        context: contextSnapshot,
        attachments: attachmentMetadata(body.attachments),
        observations,
        stepIndex,
        maxSteps,
      });
      stream?.onEvent("step_started", { stepIndex, skillName: step.skillName, toolName: step.toolName });
      stream?.onEvent("tool_call", {
        skillName: step.skillName,
        toolName: step.toolName,
        args: step.args,
        requiresConfirmation: step.requiresConfirmation,
      });
      if (run && repository instanceof D1LedgerRepository) {
        await repository.appendAiStep({
          runId: run.id,
          stepIndex,
          kind: "tool_call",
          status: "running",
          skillName: step.skillName,
          toolName: step.toolName,
          input: { args: step.args, requiresConfirmation: step.requiresConfirmation, observations },
          actorId: user.id,
        });
      }
      const result = await executeAiTool(runtime, step);
      parts.push(...result.parts);
      const observation = {
        stepIndex,
        skillName: step.skillName,
        toolName: step.toolName,
        result: result.result,
        parts: result.parts,
        changed: result.changed,
      };
      observations.push(observation);
      stream?.onEvent("tool_result", {
        skillName: step.skillName,
        toolName: step.toolName,
        parts: result.parts,
        result: result.result,
        changed: result.changed,
      });
      if (run && repository instanceof D1LedgerRepository) {
        await repository.appendAiStep({
          runId: run.id,
          stepIndex,
          kind: "tool_result",
          status: "completed",
          skillName: step.skillName,
          toolName: step.toolName,
          output: observation,
          actorId: user.id,
        });
      }
      const confirmation = result.parts.find((part) => part.type === "confirmation-card");
      if (confirmation) stream?.onEvent("confirmation", confirmation);
      const text = result.parts
        .filter((part) => part.type === "text" || part.type === "tool-status")
        .map((part) => ("text" in part ? part.text : part.message))
        .filter(Boolean)
        .join("\n");
      if (text) await streamText(text, stream);
      if (confirmation || step.isFinal) break;
    }
  }
  const message = { id: `ai_assistant_${crypto.randomUUID()}`, role: "assistant" as const, parts };
  await appendMessage(repository, sessionId, user.id, "assistant", partsToText(parts), parts);
  if (run && repository instanceof D1LedgerRepository)
    await repository.updateAiRun(run.id, { status: "completed", finalMessageId: message.id }, user.id);
  if (repository instanceof D1LedgerRepository && session.title === "新会话" && prompt) {
    await repository.updateAiSession(user.id, sessionId, { title: prompt.slice(0, 40), bookId });
  } else if (!(repository instanceof D1LedgerRepository) && session.title === "新会话" && prompt) {
    updateMemorySession(repository, user.id, sessionId, { title: prompt.slice(0, 40), bookId });
  }
  return { sessionId, message, parts };
}

function chatHistoryMessages(
  session: { messages?: Array<Record<string, unknown>> },
  prompt: string,
  attachments: File[],
): AiChatMessage[] {
  const history = (session.messages ?? [])
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
    )
    .slice(-20)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: String(message.content),
    }));
  return [
    ...history,
    {
      role: "user",
      content: prompt || attachmentChatPrompt(attachments),
    },
  ];
}

function attachmentChatPrompt(attachments: File[]) {
  if (!attachments.length) return "你好";
  const names = attachments
    .map((file) => `${file.name || "未命名文件"} (${file.type || "未知类型"}, ${file.size} bytes)`)
    .join("、");
  return `用户上传了附件：${names}。如果需要读取文件内容或执行应用操作，请根据可用工具处理；如果只是普通聊天，请说明你能基于当前可见信息回答。`;
}

async function readAiRequest(context: any): Promise<AiRequestBody> {
  const contentType = context.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await context.req.formData();
    const attachments = [
      ...form.getAll("files"),
      ...form.getAll("file"),
      ...form.getAll("attachments"),
    ].filter((value): value is File => value instanceof File && Boolean(value.name));
    return {
      message: String(form.get("message") ?? ""),
      bookId: stringOrUndefined(form.get("bookId")),
      page: stringOrUndefined(form.get("page")),
      timeZone: stringOrUndefined(form.get("timeZone")),
      attachments,
    };
  }
  const json = (await context.req.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    message: typeof json.message === "string" ? json.message : "",
    bookId: typeof json.bookId === "string" ? json.bookId : undefined,
    page: typeof json.page === "string" ? json.page : undefined,
    timeZone: typeof json.timeZone === "string" ? json.timeZone : undefined,
    attachments: [],
  };
}

async function buildModelContext(repository: AiToolRepository, user: LedgerUser, bookId?: string) {
  const books =
    repository instanceof D1LedgerRepository
      ? await repository.listBooks(user.id)
      : repository.books.filter((book) => repository.role(book.id, user.id));
  const resolvedBookId = bookId ?? books[0]?.id;
  if (!resolvedBookId) return { user: publicUser(user), books };
  const [book, transactions, categories, members, imports] =
    repository instanceof D1LedgerRepository
      ? await Promise.all([
          repository.getBook(resolvedBookId),
          repository.listTransactions(resolvedBookId),
          repository.listCategories(user.id),
          repository.listMembers(resolvedBookId),
          repository.listImportJobs(resolvedBookId),
        ])
      : [
          repository.books.find((item) => item.id === resolvedBookId),
          repository.transactions.filter((item) => item.bookId === resolvedBookId),
          repository.categories.filter((item) => item.userId === user.id),
          repository.members.filter((item) => item.bookId === resolvedBookId),
          repository.imports.filter((item) => item.bookId === resolvedBookId),
        ];
  return {
    user: publicUser(user),
    books,
    currentBook: book,
    categories,
    members,
    recentTransactions: transactions.slice(0, 20),
    recentImportJobs: imports.slice(0, 10),
  };
}

async function appendMessage(
  repository: AiToolRepository,
  sessionId: string,
  actorId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  parts?: unknown[],
  attachments?: unknown[],
) {
  if (repository instanceof D1LedgerRepository)
    return repository.appendAiMessage(sessionId, actorId, role, content, { parts, attachments });
  const memory = ensureMemoryAi(repository);
  const session = memory.aiSessions!.find((item) => item.id === sessionId);
  if (!session) return;
  memory.aiMessages!.push({
    id: `ai_message_${crypto.randomUUID()}`,
    sessionId,
    role,
    content,
    parts,
    attachments,
    createdAt: new Date().toISOString(),
  });
  session.updatedAt = new Date().toISOString();
}

async function streamText(
  text: string,
  stream?: { onEvent: (event: string, data: unknown) => void; signal: AbortSignal },
) {
  if (!stream) return;
  for (const chunk of splitGraphemes(text)) {
    if (stream.signal.aborted) return;
    stream.onEvent("message_delta", { text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function splitGraphemes(text: string) {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const char = text.codePointAt(cursor);
    const width = char && char > 0xffff ? 2 : 1;
    chunks.push(text.slice(cursor, cursor + width));
    cursor += width;
  }
  return chunks;
}

function partsToText(parts: Array<Record<string, any>>) {
  return parts
    .map((part) => (part.type === "text" ? part.text : part.type === "tool-status" ? part.message : ""))
    .filter(Boolean)
    .join("\n");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function publicUser(user: LedgerUser) {
  return { id: user.id, name: user.name, email: user.email, plan: user.plan };
}

function attachmentMetadata(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
  }));
}

function stringOrUndefined(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

type MemoryAiSession = {
  id: string;
  userId: string;
  bookId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
type MemoryAiMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  parts?: unknown[];
  attachments?: unknown[];
  createdAt: string;
};

function ensureMemoryAi(store: MemoryLedgerStore) {
  const value = store as MemoryLedgerStore & {
    aiSessions?: MemoryAiSession[];
    aiMessages?: MemoryAiMessage[];
  };
  value.aiSessions ??= [];
  value.aiMessages ??= [];
  return value;
}

function createMemorySession(
  store: MemoryLedgerStore,
  userId: string,
  bookId: string | undefined,
  title: string,
) {
  const value = ensureMemoryAi(store);
  const timestamp = new Date().toISOString();
  const session = {
    id: `ai_session_${crypto.randomUUID()}`,
    userId,
    bookId,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  value.aiSessions!.unshift(session);
  return session;
}

function memorySessions(store: MemoryLedgerStore, userId: string) {
  return ensureMemoryAi(store)
    .aiSessions!.filter((session) => session.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function memorySession(store: MemoryLedgerStore, userId: string, sessionId: string) {
  const value = ensureMemoryAi(store);
  const session = value.aiSessions!.find((item) => item.id === sessionId && item.userId === userId);
  if (!session) return null;
  return { ...session, messages: value.aiMessages!.filter((message) => message.sessionId === sessionId) };
}

function updateMemorySession(
  store: MemoryLedgerStore,
  userId: string,
  sessionId: string,
  input: { title?: string; bookId?: string | null },
) {
  const session = ensureMemoryAi(store).aiSessions!.find(
    (item) => item.id === sessionId && item.userId === userId,
  );
  if (!session) return null;
  if (input.title) session.title = input.title;
  if (input.bookId !== undefined) session.bookId = input.bookId ?? undefined;
  session.updatedAt = new Date().toISOString();
  return memorySession(store, userId, sessionId);
}

function deleteMemorySession(store: MemoryLedgerStore, userId: string, sessionId: string) {
  const value = ensureMemoryAi(store);
  value.aiSessions = value.aiSessions!.filter((item) => !(item.id === sessionId && item.userId === userId));
  value.aiMessages = value.aiMessages!.filter((item) => item.sessionId !== sessionId);
}
