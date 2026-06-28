import { canMutateTransaction, createTransactionSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { currentUser, requireMember, requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerTransactionRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/books/:bookId/transactions", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    return context.json({
      transactions: context.env.DB
        ? await new D1LedgerRepository(context.env.DB).listTransactions(bookId)
        : (store?.transactions.filter((item) => item.bookId === bookId) ?? []),
    });
  });

  app.post("/books/:bookId/transactions", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const body = await parseJson(context, createTransactionSchema);
    if (!body) return jsonError(context, "记录数据不合法，检查金额与明细总额");
    const transaction = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).createTransaction(bookId, user.id, body as any)
      : store?.createTransaction(bookId, user.id, body as any);
    return transaction ? context.json({ transaction }, 201) : jsonError(context, "D1 运行时不可用", 503);
  });

  app.get("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    const denied = await requireMember(context, store, transaction.bookId);
    return denied ?? context.json({ transaction });
  });

  app.patch("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    if (!canMutateTransaction(user.id, transaction.createdByUserId))
      return jsonError(context, "只能修改自己创建的记录", 403);
    const body = await context.req.json<Record<string, unknown>>();
    const candidate = createTransactionSchema.safeParse({ ...transaction, ...body });
    if (!candidate.success) return jsonError(context, "记录数据不合法，检查金额与明细总额");
    const updated = repository
      ? await repository.updateTransaction(transaction.id, candidate.data as any, user.id)
      : Object.assign(transaction, candidate.data);
    return context.json({ transaction: updated });
  });

  app.delete("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    if (!canMutateTransaction(user.id, transaction.createdByUserId))
      return jsonError(context, "只能删除自己创建的记录", 403);
    if (repository) await repository.deleteTransaction(transaction.id, user.id);
    else if (store) store.transactions = store.transactions.filter((item) => item.id !== transaction.id);
    return context.body(null, 204);
  });
}
