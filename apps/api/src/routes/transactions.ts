import { canMutateTransaction, createTransactionSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { currentUser, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerTransactionRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.get("/books/:bookId/transactions", (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    return (
      denied ?? context.json({ transactions: store.transactions.filter((item) => item.bookId === bookId) })
    );
  });

  app.post("/books/:bookId/transactions", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    if (denied) return denied;

    const body = await parseJson(context, createTransactionSchema);
    if (!body) return jsonError(context, "记录数据不合法，检查金额与明细总额");

    return context.json(
      { transaction: store.createTransaction(bookId, currentUser(context, store).id, body) },
      201,
    );
  });

  app.get("/transactions/:id", (context) => {
    const transaction = store.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);

    const denied = requireMember(context, store, transaction.bookId);
    return denied ?? context.json({ transaction });
  });

  app.patch("/transactions/:id", async (context) => {
    const transaction = store.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    if (!canMutateTransaction(currentUser(context, store).id, transaction.createdByUserId)) {
      return jsonError(context, "只能修改自己创建的记录", 403);
    }

    const body = await context.req.json<Record<string, unknown>>();
    if (body.items || body.amount || body.type || body.occurredAt) {
      const candidate = createTransactionSchema.safeParse({ ...transaction, ...body });
      if (!candidate.success) return jsonError(context, "记录数据不合法");
      Object.assign(transaction, candidate.data);
    } else {
      Object.assign(transaction, body);
    }
    return context.json({ transaction });
  });

  app.delete("/transactions/:id", (context) => {
    const transaction = store.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    if (!canMutateTransaction(currentUser(context, store).id, transaction.createdByUserId)) {
      return jsonError(context, "只能删除自己创建的记录", 403);
    }

    store.transactions = store.transactions.filter((item) => item.id !== transaction.id);
    return context.body(null, 204);
  });
}
