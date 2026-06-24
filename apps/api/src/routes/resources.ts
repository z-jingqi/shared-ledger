import { categorySchema, tagSchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireMember, requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

type ResourcePath = "categories" | "tags";

export function registerResourceRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  registerResource(app, store, "categories", categorySchema);
  registerResource(app, store, "tags", tagSchema);
}

function registerResource(
  app: Hono<{ Bindings: Env }>,
  store: MemoryLedgerStore | undefined,
  path: ResourcePath,
  schema: any,
) {
  app.get(`/books/:bookId/${path}`, async (context) => {
    const bookId = context.req.param("bookId");
    const denied = await requireMember(context, store, bookId);
    if (denied) return denied;
    const values = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).listSimple(path, bookId)
      : (store?.[path].filter((item) => item.bookId === bookId) ?? []);
    return context.json({ [path]: values });
  });
  app.post(`/books/:bookId/${path}`, async (context) => {
    const bookId = context.req.param("bookId");
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const denied = await requireMember(context, store, bookId, user);
    if (denied) return denied;
    const body = await parseJson(context, schema);
    if (!body) return jsonError(context, "数据不合法");
    const value = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).createSimple(path, bookId, body)
      : store?.createSimple(path, bookId, body);
    return value
      ? context.json({ [path.slice(0, -1)]: value }, 201)
      : jsonError(context, "D1 运行时不可用", 503);
  });
  app.patch(`/${path}/:id`, async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const entity = repository
      ? await repository.getSimple(path, context.req.param("id"))
      : store?.[path].find((item) => item.id === context.req.param("id"));
    if (!entity) return jsonError(context, "资源不存在", 404);
    const denied = await requireMember(context, store, entity.bookId);
    if (denied) return denied;
    const body = await parseJson(context, schema);
    if (!body) return jsonError(context, "数据不合法");
    const updated = repository
      ? await repository.updateSimple(path, entity.id, body)
      : Object.assign(entity, body);
    return context.json({ [path.slice(0, -1)]: updated });
  });
  app.delete(`/${path}/:id`, async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const entity = repository
      ? await repository.getSimple(path, context.req.param("id"))
      : store?.[path].find((item) => item.id === context.req.param("id"));
    if (!entity) return jsonError(context, "资源不存在", 404);
    const denied = await requireMember(context, store, entity.bookId);
    if (denied) return denied;
    if (repository) await repository.deleteSimple(path, entity.id);
    else if (store) store[path] = store[path].filter((item) => item.id !== entity.id) as never;
    return context.body(null, 204);
  });
}
