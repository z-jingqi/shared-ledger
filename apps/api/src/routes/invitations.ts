import { canInvite, inviteSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { bookRole, requireMember, requireUser } from "../services/access";
import { findUserForInvitation } from "../services/auth";
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
            (item) =>
              item.inviteeUserId === user.id ||
              (item.inviteeEmail && sameValue(item.inviteeEmail, user.email)) ||
              (item.inviteePhone && user.phone && normalizePhone(item.inviteePhone) === normalizePhone(user.phone)),
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
    const target = await resolveInvitationTarget(context.env.DB, store, body);
    if ("error" in target) return jsonError(context, target.error ?? "邀请对象不合法", 400);
    if (target.user?.id === user.id) return jsonError(context, "不能邀请自己", 400);
    if (target.user?.id) {
      const existingRole = repository ? await repository.role(bookId, target.user.id) : store?.role(bookId, target.user.id);
      if (existingRole) return jsonError(context, "该用户已经在账本中", 409);
    }
    const duplicate = repository
      ? await repository.findPendingInvitation(bookId, target.email, target.phone, target.user?.id)
      : store?.invitations.find(
          (item) =>
            item.bookId === bookId &&
            item.status === "pending" &&
            ((target.email && sameValue(item.inviteeEmail, target.email)) ||
              (target.phone && normalizePhone(item.inviteePhone) === target.phone) ||
              (target.user?.id && item.inviteeUserId === target.user.id)),
        );
    if (duplicate) return jsonError(context, "该成员已有待处理邀请", 409);
    const invitation = repository
      ? await repository.createInvitation({
          bookId,
          inviterUserId: user.id,
          inviteeEmail: target.email,
          inviteePhone: target.phone,
          inviteeUserId: target.user?.id,
          role: body.role,
        })
      : {
          id: crypto.randomUUID(),
          bookId,
          inviterUserId: user.id,
          inviteeEmail: target.email,
          inviteePhone: target.phone,
          inviteeUserId: target.user?.id,
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
    if (!invitationBelongsToUser(invitation, user)) return jsonError(context, "这不是发给你的邀请", 403);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { status: "accepted", inviteeUserId: user.id }, user.id)
      : Object.assign(invitation, { status: "accepted" as const, inviteeUserId: user.id });
    if (repository) await repository.addMember(invitation.bookId, user.id, invitation.role, user.id);
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
      const canChange =
        action === "revoke" ? invitation?.inviterUserId === user.id : invitation ? invitationBelongsToUser(invitation, user) : false;
      if (!invitation || invitation.status !== "pending" || !canChange)
        return jsonError(context, message, 400);
      const updated = repository
        ? await repository.updateInvitation(invitation.id, {
            status: action === "decline" ? "declined" : "revoked",
          }, user.id)
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
      ? await repository.updateInvitation(invitation.id, { lastRemindedAt: new Date().toISOString() }, user.id)
      : Object.assign(invitation, { lastRemindedAt: new Date().toISOString() });
    return context.json({ invitation: updated });
  });
}

type InviteInput = {
  target?: string;
  email?: string;
  phone?: string;
  userId?: string;
};

async function resolveInvitationTarget(db: D1Database | undefined, store: MemoryLedgerStore | undefined, body: InviteInput) {
  const raw = (body.target ?? body.userId ?? body.email ?? body.phone ?? "").trim();
  if (!raw) return { error: "请输入邮箱、手机号、用户名或用户 ID" };

  const normalizedPhone = body.phone ? normalizePhone(body.phone) : looksLikePhone(raw) ? normalizePhone(raw) : undefined;
  const normalizedEmail = body.email ? body.email.trim().toLowerCase() : looksLikeEmail(raw) ? raw.toLowerCase() : undefined;
  const requestedUserId = body.userId ?? (raw.startsWith("user_") ? raw : undefined);
  const user = db ? await findUserForInvitation(db, raw) : findMemoryUser(store, raw);

  if (user) {
    return {
      user,
      email: user.email || normalizedEmail,
      phone: user.phone ? normalizePhone(user.phone) : normalizedPhone,
    };
  }
  if (requestedUserId) return { error: "没有找到该用户，请检查用户 ID" };
  if (!normalizedEmail && !normalizedPhone) return { error: "没有找到该用户，请输入有效邮箱、手机号、用户名或用户 ID" };
  return { email: normalizedEmail, phone: normalizedPhone };
}

function findMemoryUser(store: MemoryLedgerStore | undefined, value: string) {
  const target = value.trim();
  const normalizedPhone = normalizePhone(target);
  return store?.users.find(
    (user) =>
      user.id === target ||
      user.name === target ||
      sameValue(user.email, target) ||
      (user.phone && normalizePhone(user.phone) === normalizedPhone),
  );
}

function invitationBelongsToUser(invitation: { inviteeUserId?: string; inviteeEmail?: string; inviteePhone?: string }, user: { id: string; email?: string; phone?: string }) {
  return Boolean(
    (invitation.inviteeUserId && invitation.inviteeUserId === user.id) ||
      (invitation.inviteeEmail && sameValue(invitation.inviteeEmail, user.email)) ||
      (invitation.inviteePhone && user.phone && normalizePhone(invitation.inviteePhone) === normalizePhone(user.phone)),
  );
}

function sameValue(left?: string, right?: string) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function looksLikePhone(value: string) {
  return /^[+\d][\d\s-]*$/.test(value.trim());
}

function normalizePhone(value?: string) {
  return value?.trim().replace(/[\s-]/g, "") || undefined;
}
