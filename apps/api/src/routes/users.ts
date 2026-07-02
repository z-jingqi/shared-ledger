import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env, LedgerUser } from "../types";

export function registerUserRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/users/search", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const query = context.req.query("query")?.trim() ?? "";
    if (query.length < 1) return context.json({ users: [] });
    try {
      if (context.env.DB) {
        const users = await new D1LedgerRepository(context.env.DB).searchUsersForInvitation(query, user.id);
        return context.json({ users });
      }
      return context.json({ users: searchMemoryUsers(store, query, user) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("user_invite_blocks")) {
        return jsonError(context, "邀请功能数据库未初始化，请先运行最新 D1 迁移", 503);
      }
      return jsonError(context, "用户搜索失败", 500);
    }
  });

  app.get("/users/invite-blocks", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (context.env.DB) {
      const blocks = await new D1LedgerRepository(context.env.DB).listInviteBlocks(user.id);
      return context.json({ blocks });
    }
    return context.json({ blocks: listMemoryInviteBlocks(store, user.id) });
  });

  app.post("/users/:userId/invite-blocks", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const blockedUserId = context.req.param("userId");
    if (blockedUserId === user.id) return jsonError(context, "不能屏蔽自己", 400);
    if (context.env.DB) {
      const repository = new D1LedgerRepository(context.env.DB);
      const blockedUser = await repository.getUserSummary(blockedUserId);
      if (!blockedUser) return jsonError(context, "用户不存在", 404);
      await repository.blockInvites(user.id, blockedUserId);
      return context.json({ block: { user: blockedUser } }, 201);
    }
    const blockedUser = store?.users.find((item) => item.id === blockedUserId);
    if (!blockedUser) return jsonError(context, "用户不存在", 404);
    if (!store?.inviteBlocks.some((item) => item.blockerUserId === user.id && item.blockedUserId === blockedUserId && !item.deletedAt)) {
      const timestamp = new Date().toISOString();
      store?.inviteBlocks.push({
        id: crypto.randomUUID(),
        blockerUserId: user.id,
        blockedUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    return context.json({ block: { user: userSummary(blockedUser) } }, 201);
  });

  app.delete("/users/:userId/invite-blocks", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const blockedUserId = context.req.param("userId");
    if (context.env.DB) await new D1LedgerRepository(context.env.DB).unblockInvites(user.id, blockedUserId);
    else if (store) {
      const timestamp = new Date().toISOString();
      store.inviteBlocks = store.inviteBlocks.map((item) =>
        item.blockerUserId === user.id && item.blockedUserId === blockedUserId && !item.deletedAt
          ? { ...item, deletedAt: timestamp, updatedAt: timestamp }
          : item,
      );
    }
    return context.body(null, 204);
  });
}

function searchMemoryUsers(store: MemoryLedgerStore | undefined, query: string, actor: LedgerUser) {
  const normalized = query.trim().toLowerCase();
  return (
    store?.users
      .filter((user) => user.id !== actor.id)
      .filter((user) => {
        if (isMemoryInviteBlocked(store, user.id, actor.id)) return false;
        return (
          user.name.toLowerCase() === normalized ||
          user.email?.toLowerCase() === normalized ||
          user.phone?.toLowerCase() === normalized
        );
      })
      .slice(0, 1)
      .map(userSummary) ?? []
  );
}

function listMemoryInviteBlocks(store: MemoryLedgerStore | undefined, blockerUserId: string) {
  return (
    store?.inviteBlocks
      .filter((block) => block.blockerUserId === blockerUserId && !block.deletedAt)
      .map((block) => {
        const user = store.users.find((item) => item.id === block.blockedUserId);
        return user
          ? {
              id: block.id,
              createdAt: block.createdAt,
              user: userSummary(user),
            }
          : undefined;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)) ?? []
  );
}

function isMemoryInviteBlocked(store: MemoryLedgerStore | undefined, blockerUserId: string, blockedUserId: string) {
  return Boolean(
    store?.inviteBlocks.some(
      (item) => item.blockerUserId === blockerUserId && item.blockedUserId === blockedUserId && !item.deletedAt,
    ),
  );
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
