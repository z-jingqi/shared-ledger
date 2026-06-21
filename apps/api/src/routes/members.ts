import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireBookManager, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerMemberRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/books/:bookId/members", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    return context.json({
      members: context.env.DB
        ? await new D1LedgerRepository(context.env.DB).listMembers(bookId)
        : (store?.members.filter((member) => member.bookId === bookId) ?? []),
    });
  });
  app.patch("/books/:bookId/members/:memberId/role", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireBookManager(context, store, bookId);
    if (denied) return denied;
    const body = await context.req.json<{ role?: "admin" | "member" }>();
    if (body.role !== "admin" && body.role !== "member") return jsonError(context, "成员角色不合法");
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const member = repository
      ? await repository.updateMemberRole(bookId, context.req.param("memberId"), body.role)
      : store?.members.find((item) => item.id === context.req.param("memberId") && item.bookId === bookId);
    if (!member || member.role === "creator") return jsonError(context, "成员不存在或不能修改创建者", 404);
    if (!repository) member.role = body.role;
    return context.json({ member });
  });
}
