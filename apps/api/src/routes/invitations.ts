import { canInvite, inviteSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository, type InvitationDetail } from "../repository";
import { bookRole, requireMember, requireUser } from "../services/access";
import type { Invitation, MemoryLedgerStore } from "../store";
import type { Env, LedgerUser } from "../types";

export function registerInvitationRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/invitations", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const invitations = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).listInvitationDetailsForUser(user.id)
      : listMemoryInvitationDetailsForUser(store, user);
    return context.json({ invitations });
  });

  app.get("/invitations/received", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const invitations = context.env.DB
      ? (await new D1LedgerRepository(context.env.DB).listInvitationDetailsForUser(user.id)).filter(
          (item) => item.direction === "received",
        )
      : listMemoryInvitationDetailsForUser(store, user).filter((item) => item.direction === "received");
    return context.json({ invitations });
  });

  app.get("/books/:bookId/invitations", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const invitations = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).listInvitationDetailsForBook(bookId, user.id)
      : listMemoryInvitationDetailsForBook(store, bookId, user);
    return context.json({ invitations });
  });

  app.post("/books/:bookId/invitations", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!canInvite((await bookRole(context, store, bookId, user)) ?? "member"))
      return jsonError(context, "没有邀请成员的权限", 403);
    const body = await parseJson(context, inviteSchema);
    if (!body) return jsonError(context, "请先搜索并选择要邀请的用户", 400);

    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const target = repository
      ? await repository.getUserSummary(body.userId)
      : store?.users.find((item) => item.id === body.userId);
    if (!target) return jsonError(context, "没有找到该用户，请先搜索并选择", 404);
    if (target.id === user.id) return jsonError(context, "不能邀请自己", 400);
    const existingRole = repository ? await repository.role(bookId, target.id) : store?.role(bookId, target.id);
    if (existingRole) return jsonError(context, "该用户已经在账本中", 409);
    const blocked = repository
      ? await repository.isInviteBlocked(target.id, user.id)
      : isMemoryInviteBlocked(store, target.id, user.id);
    if (blocked) return jsonError(context, "对方暂不接受你的邀请", 403);

    const duplicate = repository
      ? await repository.findPendingInvitation(bookId, undefined, undefined, target.id)
      : store?.invitations.find(
          (item) =>
            item.bookId === bookId &&
            item.status === "pending" &&
            item.inviteeUserId === target.id &&
            !isMemoryInvitationDeleted(item),
        );
    if (duplicate) return jsonError(context, "该成员已有待处理邀请", 409);

    const invitation = repository
      ? await repository.createInvitation({
          bookId,
          inviterUserId: user.id,
          inviteeUserId: target.id,
          role: body.role,
        })
      : createMemoryInvitation(store, {
          bookId,
          inviterUserId: user.id,
          inviteeUserId: target.id,
          role: body.role,
        });
    return context.json({ invitation }, 201);
  });

  app.post("/invitations/:id/accept", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id") && !isMemoryInvitationDeleted(item));
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expiresAt) < new Date())
      return jsonError(context, "邀请不可接受", 400);
    if (!invitationBelongsToUser(invitation, user)) return jsonError(context, "这不是发给你的邀请", 403);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { status: "accepted", inviteeUserId: user.id }, user.id)
      : Object.assign(invitation, {
          status: "accepted" as const,
          inviteeUserId: user.id,
          updatedAt: new Date().toISOString(),
        });
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

  app.post("/invitations/:id/decline", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id") && !isMemoryInvitationDeleted(item));
    if (!invitation || invitation.status !== "pending" || !invitationBelongsToUser(invitation, user))
      return jsonError(context, "邀请不可拒绝", 400);
    const body = await optionalJson<{ blockInviter?: boolean }>(context);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { status: "declined" }, user.id)
      : Object.assign(invitation, { status: "declined" as const, updatedAt: new Date().toISOString() });
    if (body.blockInviter) {
      if (repository) await repository.blockInvites(user.id, invitation.inviterUserId);
      else blockMemoryInvites(store, user.id, invitation.inviterUserId);
    }
    return context.json({ invitation: updated });
  });

  app.post("/invitations/:id/revoke", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id") && !isMemoryInvitationDeleted(item));
    if (!invitation || invitation.status !== "pending" || invitation.inviterUserId !== user.id)
      return jsonError(context, "邀请不可撤回", 400);
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { status: "revoked" }, user.id)
      : Object.assign(invitation, { status: "revoked" as const, updatedAt: new Date().toISOString() });
    return context.json({ invitation: updated });
  });

  app.delete("/invitations/:id", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id") && !isMemoryInvitationDeleted(item));
    if (!invitation) return jsonError(context, "邀请不存在", 404);
    const canDelete = invitation.inviterUserId === user.id || invitationBelongsToUser(invitation, user);
    if (!canDelete) return jsonError(context, "没有删除该邀请的权限", 403);
    if (invitation.status === "pending") return jsonError(context, "进行中的邀请不能删除", 400);
    if (repository) await repository.deleteInvitation(invitation.id, user.id);
    else Object.assign(invitation, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return context.body(null, 204);
  });

  app.post("/invitations/:id/remind", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const invitation = repository
      ? await repository.getInvitation(context.req.param("id"))
      : store?.invitations.find((item) => item.id === context.req.param("id") && !isMemoryInvitationDeleted(item));
    if (!invitation || invitation.status !== "pending" || invitation.inviterUserId !== user.id)
      return jsonError(context, "邀请不可提醒", 400);
    if (invitation.lastRemindedAt && Date.now() - new Date(invitation.lastRemindedAt).getTime() < 86400000)
      return jsonError(context, "提醒过于频繁", 429);
    const remindedAt = new Date().toISOString();
    const updated = repository
      ? await repository.updateInvitation(invitation.id, { lastRemindedAt: remindedAt }, user.id)
      : Object.assign(invitation, { lastRemindedAt: remindedAt, updatedAt: remindedAt });
    return context.json({ invitation: updated });
  });
}

function createMemoryInvitation(
  store: MemoryLedgerStore | undefined,
  input: Pick<Invitation, "bookId" | "inviterUserId" | "inviteeUserId" | "role">,
) {
  const timestamp = new Date().toISOString();
  const invitation: Invitation = {
    ...input,
    id: crypto.randomUUID(),
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store?.invitations.push(invitation);
  return invitation;
}

function listMemoryInvitationDetailsForUser(store: MemoryLedgerStore | undefined, user: LedgerUser) {
  return (
    store?.invitations
      .filter((item) => !isMemoryInvitationDeleted(item))
      .filter((item) => item.inviterUserId === user.id || invitationBelongsToUser(item, user))
      .map((item) => mapMemoryInvitationDetail(store, item, user.id))
      .filter((item): item is InvitationDetail => Boolean(item)) ?? []
  );
}

function listMemoryInvitationDetailsForBook(
  store: MemoryLedgerStore | undefined,
  bookId: string,
  user: LedgerUser,
) {
  return (
    store?.invitations
      .filter((item) => item.bookId === bookId && !isMemoryInvitationDeleted(item))
      .map((item) => mapMemoryInvitationDetail(store, item, user.id))
      .filter((item): item is InvitationDetail => Boolean(item)) ?? []
  );
}

function mapMemoryInvitationDetail(
  store: MemoryLedgerStore | undefined,
  invitation: Invitation,
  viewerUserId: string,
): InvitationDetail | undefined {
  const book = store?.books.find((item) => item.id === invitation.bookId);
  const inviter = store?.users.find((item) => item.id === invitation.inviterUserId);
  if (!book || !inviter) return undefined;
  const invitee = invitation.inviteeUserId
    ? store?.users.find((item) => item.id === invitation.inviteeUserId)
    : undefined;
  return {
    ...invitation,
    book: { id: book.id, name: book.name, currency: book.currency },
    direction: invitation.inviterUserId === viewerUserId ? "sent" : "received",
    inviter: userSummary(inviter),
    ...(invitee ? { invitee: userSummary(invitee) } : {}),
  };
}

function blockMemoryInvites(
  store: MemoryLedgerStore | undefined,
  blockerUserId: string,
  blockedUserId: string,
) {
  if (!store || isMemoryInviteBlocked(store, blockerUserId, blockedUserId)) return;
  const timestamp = new Date().toISOString();
  store.inviteBlocks.push({
    id: crypto.randomUUID(),
    blockerUserId,
    blockedUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function isMemoryInviteBlocked(
  store: MemoryLedgerStore | undefined,
  blockerUserId: string,
  blockedUserId: string,
) {
  return Boolean(
    store?.inviteBlocks.some(
      (item) => item.blockerUserId === blockerUserId && item.blockedUserId === blockedUserId && !item.deletedAt,
    ),
  );
}

function isMemoryInvitationDeleted(invitation: Invitation & { deletedAt?: string }) {
  return Boolean(invitation.deletedAt);
}

function invitationBelongsToUser(
  invitation: { inviteeUserId?: string; inviteeEmail?: string; inviteePhone?: string },
  user: { id: string; email?: string; phone?: string },
) {
  return Boolean(
    (invitation.inviteeUserId && invitation.inviteeUserId === user.id) ||
      (invitation.inviteeEmail && sameValue(invitation.inviteeEmail, user.email)) ||
      (invitation.inviteePhone &&
        user.phone &&
        normalizePhone(invitation.inviteePhone) === normalizePhone(user.phone)),
  );
}

async function optionalJson<T>(context: { req: { json: () => Promise<T> } }) {
  try {
    return (await context.req.json()) as T;
  } catch {
    return {} as T;
  }
}

function userSummary(user: LedgerUser) {
  return {
    id: user.id,
    name: user.name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    plan: user.plan,
  };
}

function sameValue(left?: string, right?: string) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function normalizePhone(value?: string) {
  return value?.trim().replace(/[\s-]/g, "") || undefined;
}
