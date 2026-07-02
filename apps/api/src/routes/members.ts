import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { currentUser, requireBookManager, requireMember } from "../services/access";
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
    const actor = await currentUser(context, store);
    if (!actor) return jsonError(context, "请先登录", 401);
    const body = await context.req.json<{ role?: "admin" | "member" }>();
    if (body.role !== "admin" && body.role !== "member") return jsonError(context, "成员角色不合法");
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const member = repository
      ? await repository.updateMemberRole(bookId, context.req.param("memberId"), body.role, actor.id)
      : store?.members.find((item) => item.id === context.req.param("memberId") && item.bookId === bookId);
    if (!member || member.role === "creator") return jsonError(context, "成员不存在或不能修改创建者", 404);
    if (!repository) member.role = body.role;
    return context.json({ member });
  });

  app.delete("/books/:bookId/members/me", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const member = repository
      ? await repository.removeMemberByUser(bookId, user.id)
      : store?.members.find((item) => item.bookId === bookId && item.userId === user.id);
    if (!member || member.role === "creator") return jsonError(context, "创建者不能退出账本", 400);
    if (!repository && store)
      store.members = store.members.filter((item) => !(item.bookId === bookId && item.userId === user.id));
    return context.body(null, 204);
  });

  app.delete("/books/:bookId/members/:memberId", async (context) => {
    const bookId = context.req.param("bookId");
    const memberId = context.req.param("memberId");
    const denied = await requireBookManager(context, store, bookId);
    if (denied) return denied;
    const actor = await currentUser(context, store);
    if (!actor) return jsonError(context, "请先登录", 401);
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const member = repository
      ? await repository.removeMember(bookId, memberId, actor.id)
      : store?.members.find((item) => item.id === memberId && item.bookId === bookId);
    if (!member || member.role === "creator") return jsonError(context, "成员不存在或不能移除创建者", 404);
    if (!repository && store)
      store.members = store.members.filter((item) => !(item.id === memberId && item.bookId === bookId));
    return context.body(null, 204);
  });
}
