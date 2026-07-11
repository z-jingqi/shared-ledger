import { createTransactionSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import { canUserMutateTransaction } from "../services/transaction-permissions";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerTransactionRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/books/:bookId/transactions", async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const book = repository
      ? await repository.getBook(bookId)
      : store?.books.find((item) => item.id === bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    const transactions = repository
      ? await repository.listTransactions(bookId)
      : (store?.transactions.filter((item) => item.bookId === bookId) ?? []);
    return context.json({
      transactions: book.incomeEnabled
        ? transactions
        : transactions.filter((item) => item.type === "expense"),
    });
  });

  app.post("/books/:bookId/transactions", async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const book = repository
      ? await repository.getBook(bookId)
      : store?.books.find((item) => item.id === bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    const body = await parseJson(context, createTransactionSchema);
    if (!body) return jsonError(context, "记录数据不合法，检查金额与明细总额");
    if (!book.incomeEnabled && body.type === "income") {
      return jsonError(context, "当前账本未启用收入记录", 400);
    }
    if (!context.env.DB && store && !memoryCategoriesBelongToUser(store, user.id, body as any)) {
      return jsonError(context, "分类不存在或不属于当前用户", 400);
    }
    let transaction;
    try {
      transaction = repository
        ? await repository.createTransaction(bookId, user.id, body as any)
        : store?.createTransaction(bookId, user.id, body as any);
    } catch (error) {
      if (error instanceof Error && error.message.includes("分类不存在"))
        return jsonError(context, error.message, 400);
      throw error;
    }
    return transaction ? context.json({ transaction }, 201) : jsonError(context, "D1 运行时不可用", 503);
  });

  app.get("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, transaction.bookId, user);
    if (denied) return denied;
    if (!(await incomeVisible(context, store, transaction))) return jsonError(context, "记录不存在", 404);
    const canEdit = await canUserMutateTransaction({
      repository,
      store,
      bookId: transaction.bookId,
      actorId: user.id,
      createdByUserId: transaction.createdByUserId,
    });
    return context.json({ transaction, permissions: { canEdit, canDelete: canEdit } });
  });

  app.patch("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, transaction.bookId, user);
    if (denied) return denied;
    if (
      !(await canUserMutateTransaction({
        repository,
        store,
        bookId: transaction.bookId,
        actorId: user.id,
        createdByUserId: transaction.createdByUserId,
      }))
    )
      return jsonError(context, "没有权限修改这条记录", 403);
    const body = await context.req.json<Record<string, unknown>>();
    const candidate = createTransactionSchema.safeParse({ ...transaction, ...body });
    if (!candidate.success) return jsonError(context, "记录数据不合法，检查金额与明细总额");
    if (!(await incomeVisible(context, store, { ...transaction, type: candidate.data.type }))) {
      return jsonError(context, "当前账本未启用收入记录", 400);
    }
    if (
      !repository &&
      store &&
      !memoryCategoriesBelongToUser(store, transaction.createdByUserId, candidate.data as any)
    ) {
      return jsonError(context, "分类不存在或不属于当前用户", 400);
    }
    let updated;
    try {
      updated = repository
        ? await repository.updateTransaction(transaction.id, candidate.data as any, user.id)
        : Object.assign(transaction, candidate.data);
    } catch (error) {
      if (error instanceof Error && error.message.includes("分类不存在"))
        return jsonError(context, error.message, 400);
      throw error;
    }
    return context.json({ transaction: updated });
  });

  app.delete("/transactions/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const transaction = repository
      ? await repository.getTransaction(context.req.param("id"))
      : store?.transactions.find((item) => item.id === context.req.param("id"));
    if (!transaction) return jsonError(context, "记录不存在", 404);
    if (!(await incomeVisible(context, store, transaction))) return jsonError(context, "记录不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, transaction.bookId, user);
    if (denied) return denied;
    if (
      !(await canUserMutateTransaction({
        repository,
        store,
        bookId: transaction.bookId,
        actorId: user.id,
        createdByUserId: transaction.createdByUserId,
      }))
    )
      return jsonError(context, "没有权限删除这条记录", 403);
    if (repository) await repository.deleteTransaction(transaction.id, user.id);
    else if (store) store.transactions = store.transactions.filter((item) => item.id !== transaction.id);
    return context.body(null, 204);
  });
}

async function incomeVisible(
  context: { env: Env },
  store: MemoryLedgerStore | undefined,
  transaction: { bookId: string; type: "income" | "expense" },
) {
  if (transaction.type !== "income") return true;
  const book = context.env.DB
    ? await new D1LedgerRepository(context.env.DB).getBook(transaction.bookId)
    : store?.books.find((item) => item.id === transaction.bookId);
  return Boolean(book?.incomeEnabled);
}

function memoryCategoriesBelongToUser(
  store: MemoryLedgerStore,
  userId: string,
  input: { categoryId?: string; items?: Array<{ categoryId?: string }> },
) {
  const categoryIds = new Set(
    [input.categoryId, ...(input.items ?? []).map((item) => item.categoryId)].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (!categoryIds.size) return true;
  return [...categoryIds].every((categoryId) =>
    store.categories.some((category) => category.id === categoryId && category.userId === userId),
  );
}
