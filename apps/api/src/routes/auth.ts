import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { currentUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.post("/auth/register", async (context) => {
    const body = await context.req.json<{ name?: string; email?: string }>();
    if (!body.name || !body.email) return jsonError(context, "姓名和邮箱不能为空");

    const user = store.createUser(body.name, body.email);
    return context.json({ user, token: user.id }, 201);
  });

  app.post("/auth/login", async (context) => {
    const body = await context.req.json<{ email?: string }>();
    const user = store.users.find((item) => item.email === body.email) ?? store.users[0];
    return context.json({ user, token: user.id });
  });

  app.post("/auth/logout", (context) => context.body(null, 204));
  app.get("/auth/me", (context) => context.json({ user: currentUser(context, store) }));
}
