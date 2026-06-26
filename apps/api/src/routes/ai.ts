import { type UIMessage } from "ai";
import { canUseAi, type AiActionName, type AiIntent as ProviderAiIntent } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import {
  cancelAiConfirmation,
  confirmAiConfirmation,
  executeAiActionChat,
  importJobToTask,
  listAiTasks,
  searchAiTransactions,
} from "../services/ai-actions";
import { ingestAiTransaction } from "../services/ai-ingestion";
import { parseHeuristicIntent, type AiActionIntent, type TransactionSearchFilters } from "../services/ai-normalizer";
import { aiTaskStatusStreamTiming, createAiTaskStatusStream } from "../services/ai-tasks";
import { runtimeAiProvider } from "../services/ai";
import { cancelImportJob, retryImportJob } from "../services/imports";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const messageText = (message?: UIMessage) =>
  message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n") ?? "";

const availableActions: AiActionName[] = [
  "create-record",
  "search-records",
  "analyze-records",
  "invite-member",
  "save-attachments",
  "confirm-import-batch",
  "cancel-task",
  "retry-task",
];

const transactionSearchFiltersSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  minAmount: z.coerce.number().positive().optional(),
  maxAmount: z.coerce.number().positive().optional(),
  from: z.string().trim().min(1).max(40).optional(),
  to: z.string().trim().min(1).max(40).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
  categoryName: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).optional(),
});

const transactionSearchRouteSchema = z.object({
  bookId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(500),
  pageContext: z.string().trim().max(120).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  baseFilters: transactionSearchFiltersSchema.optional(),
  type: z.enum(["income", "expense"]).optional(),
  from: z.string().trim().min(1).max(40).optional(),
  to: z.string().trim().min(1).max(40).optional(),
  minAmount: z.coerce.number().positive().optional(),
  maxAmount: z.coerce.number().positive().optional(),
  categoryIds: z.array(z.string().trim().min(1).max(64)).optional(),
  categoryNames: z.array(z.string().trim().min(1).max(80)).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["occurredAt_desc", "occurredAt_asc", "amount_desc", "amount_asc", "date_desc", "date_asc"]).optional(),
});
type TransactionSearchRouteInput = z.infer<typeof transactionSearchRouteSchema>;

function testMemoryEnabled(context: any, store?: MemoryLedgerStore) {
  return Boolean(store && context.env?.APP_ENV === "test" && context.req.header("x-ai-test-memory") === "true");
}

function aiRepository(context: any, store?: MemoryLedgerStore) {
  if (context.env.DB) return new D1LedgerRepository(context.env.DB);
  return testMemoryEnabled(context, store) ? store : undefined;
}

function requireAiRepository(context: any, store?: MemoryLedgerStore) {
  const repository = aiRepository(context, store);
  return repository ?? jsonError(context, "AI 对话需要 D1 运行时", 503);
}

async function resolveAiIntent(
  context: any,
  store: MemoryLedgerStore | undefined,
  repository: D1LedgerRepository | MemoryLedgerStore,
  input: {
    text: string;
    bookId?: string;
    page?: string;
    today: string;
    timeZone: string;
    hasAttachments?: boolean;
  },
): Promise<AiActionIntent> {
  if (testMemoryEnabled(context, store)) return parseHeuristicIntent(input.text, input.hasAttachments);
  const categories = input.bookId
    ? repository instanceof D1LedgerRepository
      ? await repository.listSimple("categories", input.bookId)
      : repository.categories.filter((category) => category.bookId === input.bookId)
    : [];
  const tags = input.bookId
    ? repository instanceof D1LedgerRepository
      ? await repository.listSimple("tags", input.bookId)
      : repository.tags.filter((tag) => tag.bookId === input.bookId)
    : [];
  try {
    const intent = await runtimeAiProvider(context.env).parseUserIntent({
      text: input.text,
      bookId: input.bookId ?? "",
      page: input.page ?? "records",
      today: input.today,
      timeZone: input.timeZone,
      categories: categories.map((category) => ({ id: category.id, name: category.name, type: category.type })),
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
      hasAttachments: input.hasAttachments,
      availableActions,
    });
    return toActionIntent(intent);
  } catch {
    const fallback = parseHeuristicIntent(input.text, input.hasAttachments);
    if (fallback.action === "search-records" || fallback.action === "analyze-records") return fallback;
    return {
      action: "search-records",
      confidence: 0.3,
      missingFields: [],
      followUpQuestion: "AI 服务暂时不可用，暂时不能执行写操作。",
      requiresConfirmation: false,
    };
  }
}

function toActionIntent(intent: ProviderAiIntent): AiActionIntent {
  return {
    action: intent.action,
    confidence: intent.confidence,
    transaction: intent.transaction,
    search: intent.search,
    normalizedSearchFilters: intent.normalizedSearchFilters as AiActionIntent["normalizedSearchFilters"],
    invite: intent.invite,
    missingFields: intent.missingFields,
    requiresConfirmation: intent.requiresConfirmation,
    followUpQuestion: intent.followUpQuestion,
    ingestion: intent.ingestion,
  };
}

function routeSearchFilters(input: TransactionSearchRouteInput): TransactionSearchFilters {
  const filters: TransactionSearchFilters = { ...(input.baseFilters ?? {}) };
  if (input.type) filters.type = input.type;
  if (typeof input.minAmount === "number") filters.minAmount = input.minAmount;
  if (typeof input.maxAmount === "number") filters.maxAmount = input.maxAmount;
  if (input.from) filters.from = input.from;
  if (input.to) filters.to = input.to.includes("T") ? input.to : `${input.to}T23:59:59.999Z`;
  if (input.categoryIds?.[0]) filters.categoryId = input.categoryIds[0];
  if (input.categoryNames?.[0]) filters.categoryName = input.categoryNames[0];
  if (input.q) filters.q = input.q;
  if (input.sort === "amount_desc") filters.sort = "amount_desc";
  else if (input.sort === "amount_asc") filters.sort = "amount_asc";
  else if (input.sort === "occurredAt_asc" || input.sort === "date_asc") filters.sort = "date_asc";
  else if (input.sort === "occurredAt_desc" || input.sort === "date_desc") filters.sort = "date_desc";
  if (filters.to && !filters.to.includes("T")) filters.to = `${filters.to}T23:59:59.999Z`;
  return filters;
}

export function registerAiRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.post("/ai/chat", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = await context.req.json<{
      messages?: UIMessage[];
      message?: string;
      bookId?: string;
      page?: string;
      conversationId?: string;
      idempotencyKey?: string;
      timeZone?: string;
      hasAttachments?: boolean;
    }>();
    const messages =
      body.messages ??
      (body.message
        ? [
            {
              id: crypto.randomUUID(),
              role: "user" as const,
              parts: [{ type: "text" as const, text: body.message }],
            },
          ]
        : []);
    const prompt = messageText(messages.at(-1));
    if (!prompt.trim()) return jsonError(context, "请输入问题");
    if (body.bookId) {
      const denied = await requireMember(context, store, body.bookId, user);
      if (denied) return denied;
    }

    const conversationId =
      repository instanceof D1LedgerRepository
        ? body.conversationId
          ? (await repository.getConversation(user.id, body.conversationId))?.id
          : (await repository.createConversation(user.id, body.bookId, prompt.slice(0, 60))).id
        : body.conversationId ?? `conversation_${crypto.randomUUID()}`;
    if (!conversationId) return jsonError(context, "对话不存在", 404);

    try {
      if (repository instanceof D1LedgerRepository) await repository.appendMessage(conversationId, "user", prompt);
      const today = new Date().toISOString().slice(0, 10);
      const timeZone = body.timeZone ?? "Asia/Shanghai";
      const intent = await resolveAiIntent(context, store, repository, {
        text: prompt,
        bookId: body.bookId,
        page: body.page,
        today,
        timeZone,
        hasAttachments: body.hasAttachments,
      });
      const parts = await executeAiActionChat({
        user,
        repository,
        bookId: body.bookId,
        prompt,
        conversationId,
        idempotencyKey: body.idempotencyKey ?? context.req.header("idempotency-key"),
        intent,
        today,
        timeZone,
        page: body.page,
      });
      const text = parts
        .filter((part) => part.type === "text" || part.type === "tool-status")
        .map((part) => ("text" in part ? part.text : part.message))
        .join("\n");
      if (repository instanceof D1LedgerRepository) {
        await repository.appendMessage(conversationId, "assistant", text || JSON.stringify(parts));
      }
      return context.json({
        conversationId,
        message: { id: crypto.randomUUID(), role: "assistant", parts },
        parts,
      });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "AI 服务暂时不可用", 503);
    }
  });

  app.post("/ai/search/transactions", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = transactionSearchRouteSchema.safeParse(await context.req.json());
    if (!body.success) return jsonError(context, "搜索条件不合法");
    const query = body.data.query;
    const denied = await requireMember(context, store, body.data.bookId, user);
    if (denied) return denied;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const timeZone = body.data.timeZone ?? "Asia/Shanghai";
      const intent = await resolveAiIntent(context, store, repository, {
        text: query,
        bookId: body.data.bookId,
        page: body.data.pageContext ?? "records",
        today,
        timeZone,
      });
      const result = await searchAiTransactions({
        repository,
        bookId: body.data.bookId,
        query,
        intent,
        today,
        timeZone,
        baseFilters: routeSearchFilters(body.data),
      });
      return context.json({
        query,
        filters: result.filters,
        chips: result.chips,
        results: result.results,
        summary: result.summary,
        href: result.href,
      });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "AI 搜索失败", 503);
    }
  });

  app.post("/ai/transactions/ingest", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const body = await context.req.json<{
      bookId?: string;
      text?: string;
      message?: string;
      prompt?: string;
      candidate?: Record<string, unknown>;
      conversationId?: string;
      idempotencyKey?: string;
    }>();
    if (!body.bookId) return jsonError(context, "请先选择一个账本");
    const denied = await requireMember(context, store, body.bookId, user);
    if (denied) return denied;
    const candidate =
      body.candidate && typeof body.candidate === "object" && !Array.isArray(body.candidate)
        ? body.candidate
        : undefined;
    const text = body.text ?? body.message ?? body.prompt;
    if (!text?.trim() && !candidate) return jsonError(context, "请输入记账文本或候选记录");
    try {
      const result = await ingestAiTransaction({
        user,
        repository,
        bookId: body.bookId,
        text,
        candidate,
        conversationId: body.conversationId,
        idempotencyKey: body.idempotencyKey ?? context.req.header("idempotency-key"),
      });
      return context.json(result.body, result.status as 200);
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "AI 记账失败", 400);
    }
  });

  app.post("/ai/confirmations/:id/confirm", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const result = await confirmAiConfirmation({
      user,
      repository,
      confirmationId: context.req.param("id"),
    });
    return "error" in result.body
      ? jsonError(context, result.body.error ?? "确认失败", result.status)
      : context.json(result.body, result.status as 200);
  });

  app.post("/ai/confirmations/:id/cancel", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const result = await cancelAiConfirmation({
      user,
      repository,
      confirmationId: context.req.param("id"),
    });
    return "error" in result.body
      ? jsonError(context, result.body.error ?? "取消确认失败", result.status)
      : context.json(result.body, result.status as 200);
  });

  app.get("/ai/tasks", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    return context.json({ tasks: await listAiTasks(repository, user.id) });
  });

  app.get("/ai/tasks/status-stream", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const repository = requireAiRepository(context, store);
    if (repository instanceof Response) return repository;
    const stream = createAiTaskStatusStream({
      repository,
      userId: user.id,
      signal: context.req.raw.signal,
      ...aiTaskStatusStreamTiming(context.env.APP_ENV),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });

  app.post("/ai/tasks/:id/cancel", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const taskId = context.req.param("id").replace(/^import:/, "");
    if (context.env.DB) {
      const repository = new D1LedgerRepository(context.env.DB);
      const job = await repository.getImportJob(taskId);
      if (!job) return jsonError(context, "任务不存在", 404);
      const denied = await requireMember(context, store, job.bookId, user);
      if (denied) return denied;
      try {
        const cancelled = await cancelImportJob(context.env, repository, job);
        return context.json({ task: cancelled ? importJobToTask(cancelled) : null });
      } catch (error) {
        return jsonError(context, error instanceof Error ? error.message : "取消任务失败", 502);
      }
    }
    if (!testMemoryEnabled(context, store) || !store) return jsonError(context, "AI 对话需要 D1 运行时", 503);
    const job = store.imports.find((item) => item.id === taskId);
    if (!job) return jsonError(context, "任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    job.status = "cancelled";
    job.cancelable = false;
    job.retryable = false;
    job.errorRetryable = false;
    job.updatedAt = new Date().toISOString();
    return context.json({ task: importJobToTask(job) });
  });

  app.post("/ai/tasks/:id/retry", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    const taskId = context.req.param("id").replace(/^import:/, "");
    if (context.env.DB) {
      const repository = new D1LedgerRepository(context.env.DB);
      const job = await repository.getImportJob(taskId);
      if (!job) return jsonError(context, "任务不存在", 404);
      const denied = await requireMember(context, store, job.bookId, user);
      if (denied) return denied;
      if (job.status !== "failed" || !job.errorRetryable) return jsonError(context, "该任务当前不可重试", 409);
      try {
        const retried = await retryImportJob(context.env, repository, job, new URL(context.req.url).origin);
        const nextJob = Array.isArray(retried) ? await repository.getImportJob(job.id) : retried;
        return context.json({ task: nextJob ? importJobToTask(nextJob) : null });
      } catch (error) {
        return jsonError(context, error instanceof Error ? error.message : "重试任务失败", 502);
      }
    }
    if (!testMemoryEnabled(context, store) || !store) return jsonError(context, "AI 对话需要 D1 运行时", 503);
    const job = store.imports.find((item) => item.id === taskId);
    if (!job) return jsonError(context, "任务不存在", 404);
    const denied = await requireMember(context, store, job.bookId, user);
    if (denied) return denied;
    if (job.status !== "failed" || !job.errorRetryable) return jsonError(context, "该任务当前不可重试", 409);
    job.status = "uploaded";
    job.retryCount = (job.retryCount ?? 0) + 1;
    job.cancelable = false;
    job.retryable = false;
    job.errorRetryable = false;
    job.errorMessage = undefined;
    job.updatedAt = new Date().toISOString();
    return context.json({ task: importJobToTask(job) });
  });

  app.get("/ai/conversations", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    if (!context.env.DB) return jsonError(context, "AI 对话需要 D1 运行时", 503);
    return context.json({
      conversations: await new D1LedgerRepository(context.env.DB).listConversations(user.id),
    });
  });
  app.get("/ai/conversations/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    if (!context.env.DB) return jsonError(context, "AI 对话需要 D1 运行时", 503);
    const conversation = await new D1LedgerRepository(context.env.DB).getConversation(
      user.id,
      context.req.param("id"),
    );
    return conversation ? context.json({ conversation }) : jsonError(context, "对话不存在", 404);
  });
}
