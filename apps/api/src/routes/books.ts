import { canDeleteBook, createBookSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { bookRole, currentUser, requireBookManager, requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerBookRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  app.get("/books", (context) => {
    const user = currentUser(context, store);
    return context.json({ books: store.books.filter((book) => store.role(book.id, user.id)) });
  });

  app.post("/books", async (context) => {
    const body = await parseJson(context, createBookSchema);
    if (!body) return jsonError(context, "账本数据不合法");

    return context.json(
      { book: store.createBook(currentUser(context, store), body.name, body.currency) },
      201,
    );
  });

  app.get("/books/:id", (context) => {
    const book = store.books.find((item) => item.id === context.req.param("id"));
    if (!book) return jsonError(context, "账本不存在", 404);

    const denied = requireMember(context, store, book.id);
    return denied ?? context.json({ book, role: bookRole(context, store, book.id) });
  });

  app.patch("/books/:id", async (context) => {
    const book = store.books.find((item) => item.id === context.req.param("id"));
    if (!book) return jsonError(context, "账本不存在", 404);

    const denied = requireBookManager(context, store, book.id);
    if (denied) return denied;

    const body = await context.req.json<Partial<typeof book>>();
    Object.assign(book, {
      name: body.name ?? book.name,
      currency: body.currency ?? book.currency,
      updatedAt: new Date().toISOString(),
    });
    return context.json({ book });
  });

  app.delete("/books/:id", (context) => {
    const book = store.books.find((item) => item.id === context.req.param("id"));
    if (!book) return jsonError(context, "账本不存在", 404);
    if (!canDeleteBook(bookRole(context, store, book.id) ?? "member")) {
      return jsonError(context, "只有创建者可以删除账本", 403);
    }

    store.books = store.books.filter((item) => item.id !== book.id);
    return context.body(null, 204);
  });
}
