import type { Hono } from "hono";
import { currentUser } from "../services/access";
import { aiErrorBody, aiErrorStatus, getRuntimeAiUsage } from "../services/ai";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";
import { jsonError } from "../lib/http";

export function registerMeRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/me/ai-usage", async (context) => {
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "未登录", 401);
    try {
      return context.json(await getRuntimeAiUsage(context.env, user));
    } catch (error) {
      return context.json(aiErrorBody(error), aiErrorStatus(error));
    }
  });
}
