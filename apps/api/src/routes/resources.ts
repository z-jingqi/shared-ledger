import { accountSchema, categorySchema, tagSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { requireMember } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

type ResourcePath = "categories" | "tags" | "accounts";

export function registerResourceRoutes(app: Hono<{ Bindings: Env }>, store: MemoryLedgerStore) {
  registerResource(app, store, "categories", categorySchema);
  registerResource(app, store, "tags", tagSchema);
  registerResource(app, store, "accounts", accountSchema);
}

function registerResource(
  app: Hono<{ Bindings: Env }>,
  store: MemoryLedgerStore,
  path: ResourcePath,
  schema: any,
) {
  app.get(`/books/:bookId/${path}`, (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    return denied ?? context.json({ [path]: store[path].filter((item) => item.bookId === bookId) });
  });

  app.post(`/books/:bookId/${path}`, async (context) => {
    const bookId = context.req.param("bookId");
    const denied = requireMember(context, store, bookId);
    if (denied) return denied;

    const body = await parseJson(context, schema);
    if (!body) return jsonError(context, "数据不合法");
    return context.json({ [path.slice(0, -1)]: store.createSimple(path, bookId, body) }, 201);
  });

  app.patch(`/${path}/:id`, async (context) => {
    const entity = store[path].find((item) => item.id === context.req.param("id"));
    if (!entity) return jsonError(context, "资源不存在", 404);

    const denied = requireMember(context, store, entity.bookId);
    if (denied) return denied;
    Object.assign(entity, await context.req.json());
    return context.json({ [path.slice(0, -1)]: entity });
  });

  app.delete(`/${path}/:id`, (context) => {
    const index = store[path].findIndex((item) => item.id === context.req.param("id"));
    if (index < 0) return jsonError(context, "资源不存在", 404);

    const entity = store[path][index];
    const denied = requireMember(context, store, entity.bookId);
    if (denied) return denied;
    store[path].splice(index, 1);
    return context.body(null, 204);
  });
}
