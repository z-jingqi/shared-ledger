import { memberEditConsentSchema } from "@shared-ledger/shared";
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

  app.patch("/books/:bookId/members/me/preferences", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const body = memberEditConsentSchema.safeParse(await optionalJson(context));
    if (!body.success) return jsonError(context, "编辑授权设置不合法", 400);
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const member = repository
      ? await repository.updateMemberEditConsent(bookId, user.id, body.data.allowAdminEdit)
      : store?.findMember(bookId, user.id);
    if (!member || member.role === "creator") return jsonError(context, "创建者无需设置该权限", 400);
    if (!repository) member.allowAdminEdit = body.data.allowAdminEdit;
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
    const target = repository
      ? (await repository.listMembers(bookId)).find((item) => item.id === memberId)
      : store?.members.find((item) => item.id === memberId && item.bookId === bookId);
    if (!target || target.role === "creator") return jsonError(context, "成员不存在或不能移除创建者", 404);
    if (target.userId === actor.id) return jsonError(context, "请使用退出账本操作", 400);
    const member = repository ? await repository.removeMember(bookId, memberId, actor.id) : target;
    if (!member) return jsonError(context, "成员不存在", 404);
    if (!repository && store)
      store.members = store.members.filter((item) => !(item.id === memberId && item.bookId === bookId));
    return context.body(null, 204);
  });
}

async function optionalJson(context: { req: { json: () => Promise<unknown> } }) {
  try {
    return await context.req.json();
  } catch {
    return {};
  }
}
