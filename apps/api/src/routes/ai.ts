import { createAiProvider } from "@shared-ledger/ai";
import { canUseAi } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerAiRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.post("/ai/chat", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    if (!context.env.DB) return jsonError(context, "AI 对话需要 D1 运行时", 503);
    const body = await context.req.json<{
      message?: string;
      bookId?: string;
      page?: string;
      conversationId?: string;
    }>();
    if (!body.message?.trim()) return jsonError(context, "请输入问题");
    const repository = new D1LedgerRepository(context.env.DB);
    const conversationId = body.conversationId
      ? (await repository.getConversation(user.id, body.conversationId))?.id
      : (await repository.createConversation(user.id, body.bookId, body.message.trim().slice(0, 60))).id;
    if (!conversationId) return jsonError(context, "对话不存在", 404);
    try {
      await repository.appendMessage(conversationId, "user", body.message.trim());
      const message = await createAiProvider(context.env.AI).chat({
        userId: user.id,
        bookId: body.bookId ?? "",
        page: body.page,
        text: body.message.trim(),
      });
      await repository.appendMessage(conversationId, "assistant", message);
      return context.json({ conversationId, message });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "AI 服务暂时不可用", 503);
    }
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
