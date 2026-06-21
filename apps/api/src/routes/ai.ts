import { createAiProvider } from "@shared-ledger/ai";
import { canUseAi } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { currentUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerAiRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.post("/ai/chat", async (context) => {
    const user = currentUser(context, store);
    if (!canUseAi(user.plan)) return jsonError(context, "AI 助手仅对订阅用户开放", 403);

    const body = await context.req.json<{ message?: string; bookId?: string; page?: string }>();
    if (!body.message) return jsonError(context, "请输入问题");

    const message = await createAiProvider(context.env.AI_PROVIDER).chat({
      userId: user.id,
      bookId: body.bookId ?? "book_home",
      page: body.page,
      text: body.message,
    });
    return context.json({ message });
  });

  app.get("/ai/conversations", (context) => {
    if (!canUseAi(currentUser(context, store).plan)) {
      return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    }
    return context.json({ conversations: [] });
  });

  app.get("/ai/conversations/:id", (context) => {
    if (!canUseAi(currentUser(context, store).plan)) {
      return jsonError(context, "AI 助手仅对订阅用户开放", 403);
    }
    return context.json({ conversation: { id: context.req.param("id"), messages: [] } });
  });
}
