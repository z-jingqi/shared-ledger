import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore } from "../store";

export function persistStore(store: MemoryLedgerStore) {
  return async (context: any, next: () => Promise<void>) => {
    const repository = context.env?.DB ? new D1LedgerRepository(context.env.DB) : undefined;
    if (repository) await repository.hydrate(store);

    await next();

    if (repository && !["GET", "OPTIONS"].includes(context.req.method)) {
      await repository.persist(store);
    }
  };
}
