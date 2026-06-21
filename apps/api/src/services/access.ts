import { canManageMembers } from "@shared-ledger/shared";
import { getCookie } from "hono/cookie";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore } from "../store";
import { findSessionUser } from "./auth";
import type { LedgerUser } from "../types";

/** A MemoryLedgerStore may only be supplied by tests. */
function testUser(context: any, store?: MemoryLedgerStore) {
  if (!store || context.env?.APP_ENV !== "test") return null;
  const userId = context.req.header("x-user-id");
  const found = store.users.find((user) => user.id === userId);
  const fallback = store.users[0];
  return (
    found ??
    (fallback ? { ...fallback, plan: context.req.header("x-plan") === "pro" ? "pro" : fallback.plan } : null)
  );
}

export async function currentUser(context: any, store?: MemoryLedgerStore): Promise<LedgerUser | null> {
  if (context.env?.DB) return findSessionUser(context.env.DB, getCookie(context, "ledger_session"));
  return testUser(context, store);
}

export async function requireUser(context: any, store?: MemoryLedgerStore) {
  const user = await currentUser(context, store);
  return user ?? jsonError(context, "请先登录", 401);
}

export async function bookRole(
  context: any,
  store: MemoryLedgerStore | undefined,
  bookId: string,
  user?: LedgerUser,
) {
  const actor = user ?? (await currentUser(context, store));
  if (!actor) return undefined;
  if (context.env?.DB) return new D1LedgerRepository(context.env.DB).role(bookId, actor.id);
  return store?.role(bookId, actor.id);
}

export async function requireMember(
  context: any,
  store: MemoryLedgerStore | undefined,
  bookId: string,
  user?: LedgerUser,
) {
  const actor = user ?? (await currentUser(context, store));
  if (!actor) return jsonError(context, "请先登录", 401);
  return (await bookRole(context, store, bookId, actor)) ? null : jsonError(context, "你不是该账本成员", 403);
}

export async function requireBookManager(
  context: any,
  store: MemoryLedgerStore | undefined,
  bookId: string,
  user?: LedgerUser,
) {
  const actor = user ?? (await currentUser(context, store));
  if (!actor) return jsonError(context, "请先登录", 401);
  const role = await bookRole(context, store, bookId, actor);
  return canManageMembers(role ?? "member") ? null : jsonError(context, "没有管理成员的权限", 403);
}
