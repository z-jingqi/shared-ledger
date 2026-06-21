import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { requireBookManager, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerMemberRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.get("/books/:bookId/members", (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    return denied ?? context.json({ members: store.members.filter((member) => member.bookId === bookId) });
  });

  app.patch("/books/:bookId/members/:memberId/role", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireBookManager(context, store, bookId);
    if (denied) return denied;

    const body = await context.req.json<{ role?: "admin" | "member" }>();
    const member = store.members.find(
      (item) => item.id === context.req.param("memberId") && item.bookId === bookId,
    );
    if (!member || member.role === "creator") return jsonError(context, "成员不存在或不能修改创建者", 404);

    member.role = body.role ?? member.role;
    return context.json({ member });
  });
}
