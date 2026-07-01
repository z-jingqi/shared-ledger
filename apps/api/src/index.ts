import { createApp } from "./app";
import { D1LedgerRepository } from "./repository";
import type { Env } from "./types";

export { createApp } from "./app";

const app = createApp();

function stripApiPrefix(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);
  else return request;
  return new Request(url.toString(), request);
}

export default {
  fetch(request, env, context) {
    return app.fetch(stripApiPrefix(request), env, context);
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (!env.DB) return;
    context.waitUntil(new D1LedgerRepository(env.DB).cleanupExpiredImportJobs());
  },
} satisfies ExportedHandler<Env>;
