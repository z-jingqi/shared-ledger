import { canInvite, inviteSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { bookRole, currentUser, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerInvitationRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.get("/invitations/received", (context) => {
    const user = currentUser(context, store);
    return context.json({
      invitations: store.invitations.filter(
        (invitation) => invitation.inviteeUserId === user.id || invitation.inviteeEmail === user.email,
      ),
    });
  });

  app.get("/books/:bookId/invitations", (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    return (
      denied ?? context.json({ invitations: store.invitations.filter((item) => item.bookId === bookId) })
    );
  });

  app.post("/books/:bookId/invitations", async (context) => {
    const bookId = context.req.param("bookId");
    if (!canInvite(bookRole(context, store, bookId) ?? "member")) {
      return jsonError(context, "没有邀请成员的权限", 403);
    }

    const body = await parseJson(context, inviteSchema);
    if (!body) return jsonError(context, "邀请数据不合法");

    const duplicate = store.invitations.find(
      (item) =>
        item.bookId === bookId &&
        item.status === "pending" &&
        (item.inviteeEmail === body.email || item.inviteePhone === body.phone),
    );
    if (duplicate) return jsonError(context, "该成员已有待处理邀请", 409);

    const invitation = {
      id: crypto.randomUUID(),
      bookId,
      inviterUserId: currentUser(context, store).id,
      inviteeEmail: body.email,
      inviteePhone: body.phone,
      role: body.role,
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    store.invitations.push(invitation);
    return context.json({ invitation }, 201);
  });

  app.post("/invitations/:id/accept", (context) => {
    const invitation = store.invitations.find((item) => item.id === context.req.param("id"));
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expiresAt) < new Date()) {
      return jsonError(context, "邀请不可接受", 400);
    }

    const user = currentUser(context, store);
    invitation.status = "accepted";
    invitation.inviteeUserId = user.id;
    if (!store.role(invitation.bookId, user.id)) {
      store.members.push({
        id: crypto.randomUUID(),
        bookId: invitation.bookId,
        userId: user.id,
        name: user.name,
        role: invitation.role,
        joinedAt: new Date().toISOString(),
      });
    }
    return context.json({ invitation });
  });

  for (const [action, message] of [
    ["decline", "邀请不可拒绝"],
    ["revoke", "邀请不可撤回"],
  ] as const) {
    app.post(`/invitations/:id/${action}`, (context) => {
      const invitation = store.invitations.find((item) => item.id === context.req.param("id"));
      const isRevocable = action !== "revoke" || invitation?.inviterUserId === currentUser(context, store).id;
      if (!invitation || invitation.status !== "pending" || !isRevocable)
        return jsonError(context, message, 400);

      invitation.status = action === "decline" ? "declined" : "revoked";
      return context.json({ invitation });
    });
  }

  app.post("/invitations/:id/remind", (context) => {
    const invitation = store.invitations.find((item) => item.id === context.req.param("id"));
    if (!invitation || invitation.status !== "pending") return jsonError(context, "邀请不可提醒", 400);
    if (invitation.lastRemindedAt && Date.now() - new Date(invitation.lastRemindedAt).getTime() < 86400000) {
      return jsonError(context, "提醒过于频繁", 429);
    }

    invitation.lastRemindedAt = new Date().toISOString();
    return context.json({ invitation });
  });
}
