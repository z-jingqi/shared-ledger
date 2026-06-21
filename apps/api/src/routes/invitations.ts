import { canInvite, inviteSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { bookRole, requireMember, requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerInvitationRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/invitations/received", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    return context.json({
      invitations: context.env.DB
        ? await new D1LedgerRepository(context.env.DB).listReceivedInvitations(user.id)
        : (store?.invitations.filter(
            (item) => item.inviteeUserId === user.id || item.inviteeEmail === user.email,
          ) ?? []),
    });
  });
  app.get("/books/:bookId/invitations", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    return context.json({
      invitations: context.env.DB
        ? await new D1LedgerRepository(context.env.DB).listInvitations(bookId)
        : (store?.invitations.filter((item) => item.bookId === bookId) ?? []),
    });
  });
  app.post("/books/:bookId/invitations", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canInvite((await bookRole(context, store, bookId, user)) ?? "member"))
      return jsonError(context, "没有邀请成员的权限", 403);
    const body = await parseJson(context, inviteSchema);
    if (!body) return jsonError(context, "邀请数据不合法");
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const duplicate = repository
      ? await repository.findPendingInvitation(bookId, body.email, body.phone)
      : store?.invitations.find(
          (item) =>
            item.bookId === bookId &&
            item.status === "pending" &&
            (item.inviteeEmail === body.email || item.inviteePhone === body.phone),
        );
    if (duplicate) return jsonError(context, "该成员已有待处理邀请", 409);
    const invitation = repository
      ? await repository.createInvitation({
          bookId,
          inviterUserId: user.id,
          inviteeEmail: body.email,
          inviteePhone: body.phone,
          role: body.role,
        })
      : {
          id: crypto.randomUUID(),
          bookId,
          inviterUserId: user.id,
          inviteeEmail: body.email,
          inviteePhone: body.phone,
          role: body.role,
          status: "pending" as const,
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        };
    if (!repository && store) store.invitations.push(invitation);
    return context.json({ invitation }, 201);
  });
  app.post("/invitations/:id/accept", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id"));
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expiresAt) < new Date())
      return jsonError(context, "邀请不可接受", 400);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { status: "accepted", inviteeUserId: user.id })
      : Object.assign(invitation, { status: "accepted" as const, inviteeUserId: user.id });
    if (repository) await repository.addMember(invitation.bookId, user.id, invitation.role);
    else if (store && !store.role(invitation.bookId, user.id))
      store.members.push({
        id: crypto.randomUUID(),
        bookId: invitation.bookId,
        userId: user.id,
        name: user.name,
        role: invitation.role,
        joinedAt: new Date().toISOString(),
      });
    return context.json({ invitation: updated });
  });
  for (const [action, message] of [
    ["decline", "邀请不可拒绝"],
    ["revoke", "邀请不可撤回"],
  ] as const) {
    app.post(`/invitations/:id/${action}`, async (context) => {
      const user = await requireUser(context, store);
      if (user instanceof Response) return user;
      const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
      const invitation = repository
        ? await repository.getInvitation(context.req.param("id"))
        : store?.invitations.find((item) => item.id === context.req.param("id"));
      const isRevocable = action !== "revoke" || invitation?.inviterUserId === user.id;
      if (!invitation || invitation.status !== "pending" || !isRevocable)
        return jsonError(context, message, 400);
      const updated = repository
        ? await repository.updateInvitation(invitation.id, {
            status: action === "decline" ? "declined" : "revoked",
          })
        : Object.assign(invitation, { status: action === "decline" ? "declined" : "revoked" });
      return context.json({ invitation: updated });
    });
  }
  app.post("/invitations/:id/remind", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id"));
    if (!invitation || invitation.status !== "pending" || invitation.inviterUserId !== user.id)
      return jsonError(context, "邀请不可提醒", 400);
    if (invitation.lastRemindedAt && Date.now() - new Date(invitation.lastRemindedAt).getTime() < 86400000)
      return jsonError(context, "提醒过于频繁", 429);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { lastRemindedAt: new Date().toISOString() })
      : Object.assign(invitation, { lastRemindedAt: new Date().toISOString() });
    return context.json({ invitation: updated });
  });
}
