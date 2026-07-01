import { categorySchema } from "@shared-ledger/shared";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

export function registerResourceRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/me/categories", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const values = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).listCategories(user.id)
      : (store?.categories.filter((item) => item.userId === user.id) ?? []);
    return context.json({ categories: values });
  });

  app.post("/me/categories", async (context) => {
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const body = await parseJson(context, categorySchema);
    if (!body) return jsonError(context, "数据不合法");
    const value = context.env.DB
      ? await new D1LedgerRepository(context.env.DB).createCategory(user.id, body, user.id)
      : store?.createCategory(user.id, body);
    return value ? context.json({ category: value }, 201) : jsonError(context, "D1 运行时不可用", 503);
  });

  app.patch("/categories/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const entity = repository
      ? await repository.getCategory(context.req.param("id"))
      : store?.categories.find((item) => item.id === context.req.param("id"));
    if (!entity) return jsonError(context, "分类不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (entity.userId !== user.id) return jsonError(context, "不能修改其他用户的分类", 403);
    const body = await parseJson(context, categorySchema);
    if (!body) return jsonError(context, "数据不合法");
    const updated = repository
      ? await repository.updateCategory(entity.id, body, user.id)
      : Object.assign(entity, body);
    return context.json({ category: updated });
  });

  app.delete("/categories/:id", async (context) => {
    const repository = context.env.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    const entity = repository
      ? await repository.getCategory(context.req.param("id"))
      : store?.categories.find((item) => item.id === context.req.param("id"));
    if (!entity) return jsonError(context, "分类不存在", 404);
    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (entity.userId !== user.id) return jsonError(context, "不能删除其他用户的分类", 403);
    if (repository) await repository.deleteCategory(entity.id, user.id);
    else if (store) {
      store.categories = store.categories.filter((item) => item.id !== entity.id);
      for (const transaction of store.transactions) {
        if (transaction.categoryId === entity.id) delete transaction.categoryId;
        for (const item of transaction.items) {
          if (item.categoryId === entity.id) delete item.categoryId;
        }
      }
    }
    return context.body(null, 204);
  });
}
