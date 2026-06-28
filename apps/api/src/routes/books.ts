import { canDeleteBook, createBookSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { bookRole, currentUser, requireBookManager, requireMember, requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerBookRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/books", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (context.env.DB)
      return context.json({ books: await new D1LedgerRepository(context.env.DB).listBooks(user.id) });
    return context.json({ books: store?.books.filter((book) => store.role(book.id, user.id)) ?? [] });
  });

  app.post("/books", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const body = await parseJson(context, createBookSchema);
    if (!body) return jsonError(context, "账本数据不合法");
    const book = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).createBook(user.id, body.name, body.currency)
      : store?.createBook(user, body.name, body.currency);
    return book ? context.json({ book }, 201) : jsonError(context, "D1 运行时不可用", 503);
  });

  app.get("/books/:id", async (context) => {
    const bookId = context.req.param("id");
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    const book = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).getBook(bookId)
      : store?.books.find((item) => item.id === bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    const denied = await requireMember(context, store, book.id, user);
    return denied ?? context.json({ book, role: await bookRole(context, store, book.id, user) });
  });

  app.get("/books/:id/export", async (context) => {
    const bookId = context.req.param("id");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    if (!context.env.DB) return jsonError(context, "D1 运行时不可用", 503);
    const payload = await new D1LedgerRepository(context.env.DB).exportBook(bookId);
    if (!payload) return jsonError(context, "账本不存在", 404);
    context.header("Content-Disposition", `attachment; filename="${bookId}-export.json"`);
    return context.json(payload);
  });

  app.patch("/books/:id", async (context) => {
    const bookId = context.req.param("id");
    const denied = await requireBookManager(context, store, bookId);
    if (denied) return denied;
    const body = await context.req.json<{ name?: string; currency?: string }>();
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    const book = repository
      ? await repository.updateBook(bookId, body, user.id)
      : store?.books.find((item) => item.id === bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    if (!repository)
      Object.assign(book, {
        name: body.name ?? book.name,
        currency: body.currency ?? book.currency,
        updatedAt: new Date().toISOString(),
      });
    return context.json({ book });
  });

  app.delete("/books/:id", async (context) => {
    const bookId = context.req.param("id");
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "请先登录", 401);
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const book = repository
      ? await repository.getBook(bookId)
      : store?.books.find((item) => item.id === bookId);
    if (!book) return jsonError(context, "账本不存在", 404);
    if (!canDeleteBook((await bookRole(context, store, bookId, user)) ?? "member"))
      return jsonError(context, "只有创建者可以删除账本", 403);
    if (repository) await repository.deleteBook(bookId, user.id);
    else if (store) store.books = store.books.filter((item) => item.id !== bookId);
    return context.body(null, 204);
  });
}
