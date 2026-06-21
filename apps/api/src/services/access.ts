import { canManageMembers } from "@shared-ledger/shared";
import type { MemoryLedgerStore } from "../store";
import type { LedgerUser } from "../types";
import { jsonError } from "../lib/http";

export function currentUser(context: any, store: MemoryLedgerStore): LedgerUser {
  const userId = context.req.header("x-user-id");
  const found = store.users.find((user) => user.id === userId);
  const fallback = store.users[0];
  return found ?? { ...fallback, plan: context.req.header("x-plan") === "pro" ? "pro" : fallback.plan };
}

export function bookRole(context: any, store: MemoryLedgerStore, bookId: string) {
  return store.role(bookId, currentUser(context, store).id);
}

export function requireMember(context: any, store: MemoryLedgerStore, bookId: string) {
  return bookRole(context, store, bookId) ? null : jsonError(context, "你不是该账本成员", 403);
}

export function requireBookManager(context: any, store: MemoryLedgerStore, bookId: string) {
  return canManageMembers(bookRole(context, store, bookId) ?? "member")
    ? null
    : jsonError(context, "没有管理成员的权限", 403);
}
