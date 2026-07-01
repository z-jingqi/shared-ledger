import { createApp } from "./app";
import { D1LedgerRepository } from "./repository";
import type { Env } from "./types";

export { createApp } from "./app";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (!env.DB) return;
    context.waitUntil(new D1LedgerRepository(env.DB).cleanupExpiredImportJobs());
  },
} satisfies ExportedHandler<Env>;
